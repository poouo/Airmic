import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  PROTOCOL_VERSION,
  WS_CLOSE_CODES,
  WS_HEARTBEAT_INTERVAL_MS,
  type ClientMessage,
  type LogCategory,
  type LogLevel,
  type OnlineUser,
  type PeerInfo,
  type PeerStatePatch,
  type RoomSnapshot,
  type ServerMessage,
  type SignalPayload,
  type UserSelf,
  type WsErrorCode,
} from "@airmic/shared";
import type { RawData, WebSocket } from "ws";
import { getClientIp } from "../lib/http.js";
import { verifyJwt } from "../lib/jwt.js";
import { globalRateLimiter } from "../lib/rate-limit.js";
import { nowIso } from "../lib/time.js";
import { AuthService } from "../services/auth.js";
import type { RoomRow } from "../services/rooms.js";
import type { Services } from "../types.js";
import type { HubLike } from "./contracts.js";
import { extractClientMessageType, parseClientMessage, type ParsedClientMessage } from "./schemas.js";

/** 未认证 / 被新连接替换时使用的关闭码（协议文档约定 4001） */
const CLOSE_CODE_UNAUTHORIZED = 4001;
/** 封禁 / 服务器满员等"被服务端拒绝"场景的关闭码（协议文档约定 4003） */
const CLOSE_CODE_REJECTED = 4003;
/** 服务器内部错误时的关闭码（1011 Internal Error） */
const CLOSE_CODE_INTERNAL_ERROR = 1011;

const STATE_RATE_LIMIT = { limit: 25, windowMs: 1_000 } as const;
const CHAT_RATE_LIMIT = { limit: 5, windowMs: 5_000 } as const;
const SIGNAL_RATE_LIMIT = { limit: 120, windowMs: 10_000 } as const;

/** 关闭连接后等待对端确认的最长时间，超时后强制 terminate，避免僵尸连接残留在线列表 */
const CLOSE_WATCHDOG_MS = 2_000;

/** 心跳：连续两次收不到 pong 后强制断开 */
const HEARTBEAT_MAX_MISSED = 2;

export interface HubLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface HubOptions {
  /** 心跳间隔（毫秒），默认使用协议常量；测试可通过环境变量缩短 */
  heartbeatIntervalMs?: number;
  logger?: HubLogger;
}

interface PeerPresenceState {
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  screenSharing: boolean;
  forceMuted: boolean;
}

interface ClientConnection {
  readonly id: string;
  readonly socket: WebSocket;
  readonly userId: number;
  readonly sessionId: string;
  /** 用户信息快照，refreshUser 时更新 */
  user: UserSelf;
  readonly ip: string;
  roomId: number | null;
  joinedAt: string | null;
  state: PeerPresenceState;
  missedHeartbeats: number;
  /** 上一次心跳 ping 的发送时间，用于收到 pong 时算 RTT */
  pingSentAt: number | null;
  /** 最近一次测得的往返延迟（毫秒） */
  rttMs: number | null;
  closed: boolean;
  closeTimer: NodeJS.Timeout | null;
}

/**
 * WebSocket 实时信令 Hub：连接认证、房间成员管理、聊天/信令/状态广播、
 * 以及供 REST 管理接口调用的 HubLike 能力。所有发送都做了异常与状态保护。
 */
export class Hub implements HubLike {
  private readonly connections = new Map<string, ClientConnection>();
  private readonly byUser = new Map<number, ClientConnection>();
  private readonly heartbeatIntervalMs: number;
  private readonly logger: HubLogger | undefined;
  private heartbeatTimer: NodeJS.Timeout | null;
  private peakOnline = 0;
  private closing = false;

  constructor(
    private readonly services: Services,
    options: HubOptions = {},
  ) {
    this.heartbeatIntervalMs = Math.max(20, Math.floor(options.heartbeatIntervalMs ?? WS_HEARTBEAT_INTERVAL_MS));
    this.logger = options.logger;
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  // ============================================================
  // 连接生命周期
  // ============================================================

  /** @fastify/websocket 的 /ws 路由入口 */
  handleConnection(socket: WebSocket, request: FastifyRequest): void {
    if (this.closing) {
      this.log("warn", "ws", "服务器正在关闭，拒绝 WebSocket 连接", { reason: "shutdown" }, null, {
        ip: getClientIp(request),
      });
      closeSocketWithWatchdog(socket, WS_CLOSE_CODES.shutdown, "服务器正在关闭");
      return;
    }
    try {
      this.processConnection(socket, request);
    } catch (error) {
      this.log(
        "error",
        "ws",
        "WebSocket 连接处理异常",
        { reason: describeError(error).slice(0, 500) },
        null,
        { ip: getClientIp(request) },
      );
      this.logError("处理 WebSocket 连接时出错", error);
      closeSocketWithWatchdog(socket, CLOSE_CODE_INTERNAL_ERROR, "服务器内部错误");
    }
  }

  private processConnection(socket: WebSocket, request: FastifyRequest): void {
    const ip = getClientIp(request);
    const token = AuthService.extractTokenFromCookieHeader(request.headers.cookie);
    if (!token) {
      this.log("warn", "security", "WebSocket 认证失败", { reason: "缺少登录凭证", ip }, null, { ip });
      closeSocketWithWatchdog(socket, CLOSE_CODE_UNAUTHORIZED, "请先登录");
      return;
    }

    const auth = this.services.auth.authenticate(token);
    if (!auth) {
      const ban = this.detectBan(token, ip);
      if (ban) {
        this.log("warn", "security", "封禁用户尝试连接", { reason: ban.reason || "账号或 IP 已被封禁", ip }, null, {
          ip,
        });
        closeSocketWithWatchdog(socket, CLOSE_CODE_REJECTED, "账号已被封禁" + (ban.reason ? "：" + ban.reason : ""));
      } else {
        this.log("warn", "security", "WebSocket 认证失败", { reason: "登录凭证无效或已过期", ip }, null, { ip });
        closeSocketWithWatchdog(socket, CLOSE_CODE_UNAUTHORIZED, "请先登录");
      }
      return;
    }

    const ban = this.services.bans.findActive(auth.user.id, ip);
    if (ban) {
      this.log(
        "warn",
        "security",
        "封禁用户尝试连接",
        { reason: ban.reason || "账号或 IP 已被封禁", ip },
        null,
        { userId: auth.user.id, username: auth.user.username, ip },
      );
      closeSocketWithWatchdog(socket, CLOSE_CODE_REJECTED, "账号已被封禁：" + ban.reason);
      return;
    }

    const existing = this.byUser.get(auth.user.id);
    const settings = this.services.settings.get();
    // 同一账号重连时占用原有名额，不按"新用户"判断满员
    if (!existing && settings.maxUsers > 0 && this.connections.size >= settings.maxUsers) {
      this.log(
        "warn",
        "ws",
        "服务器人数已满，拒绝 WebSocket 连接",
        { reason: "server_full", online: this.connections.size, maxUsers: settings.maxUsers, ip },
        null,
        { userId: auth.user.id, username: auth.user.username, ip },
      );
      closeSocketWithWatchdog(socket, CLOSE_CODE_REJECTED, "服务器人数已满");
      return;
    }

    const conn: ClientConnection = {
      id: randomUUID(),
      socket,
      userId: auth.user.id,
      sessionId: auth.sessionId,
      user: auth.user,
      ip,
      roomId: null,
      joinedAt: null,
      state: { muted: false, deafened: false, speaking: false, screenSharing: false, forceMuted: false },
      missedHeartbeats: 0,
      pingSentAt: null,
      rttMs: null,
      closed: false,
      closeTimer: null,
    };

    // 单账号单连接：先注册新连接，再清理旧连接；旧连接后续的 close 事件不会误删新连接
    this.connections.set(conn.id, conn);
    this.byUser.set(conn.userId, conn);

    socket.on("pong", () => {
      conn.missedHeartbeats = 0;
      const sentAt = conn.pingSentAt;
      conn.pingSentAt = null;
      if (sentAt === null) return;
      // 用服务端 ping / 客户端 pong 的往返时间作为该用户的延迟；
      // 浏览器 WebSocket 会自动回 pong，不需要客户端额外配合。
      const rttMs = Math.max(0, Math.round(Date.now() - sentAt));
      conn.rttMs = rttMs;
      if (conn.roomId !== null && !conn.closed) {
        const message: Extract<ServerMessage, { t: "peer_latency" }> = {
          t: "peer_latency",
          roomId: conn.roomId,
          userId: conn.userId,
          rttMs,
        };
        this.broadcastToRoom(conn.roomId, message);
      }
    });
    socket.on("message", (data: RawData, isBinary: boolean) => this.handleRawMessage(conn, data, isBinary));
    socket.on("close", (code: number, reason: Buffer) => this.handleSocketClose(conn, code, reason.toString()));
    socket.on("error", (error: Error) => {
      this.logWarn("WebSocket 连接错误（用户 " + conn.userId + "）：" + describeError(error));
    });

    if (existing) this.replaceConnection(existing, conn.id);

    this.peakOnline = Math.max(this.peakOnline, this.connections.size);
    this.sendHello(conn);
    this.broadcastOnlineUsers();
    this.log(
      "info",
      "ws",
      "WebSocket 已连接",
      { userId: conn.userId, username: conn.user.username, connectionId: conn.id },
      conn,
    );
  }

  /** 认证失败时尝试识别被封禁的账号/IP，用于返回更准确的关闭码 */
  private detectBan(token: string, ip: string): { reason: string } | null {
    const ipBan = this.services.bans.findActive(null, ip);
    if (ipBan) return { reason: ipBan.reason };
    const payload = verifyJwt(token, this.services.settings.getJwtSecret());
    if (!payload) return null;
    const user = this.services.users.findById(payload.sub);
    if (!user) return null;
    if (user.is_banned === 1) {
      const until = user.banned_until ? Date.parse(user.banned_until) : null;
      if (until === null || Number.isNaN(until) || until > Date.now()) {
        return { reason: user.ban_reason ?? "" };
      }
    }
    const ban = this.services.bans.activeForUser(user.id);
    return ban ? { reason: ban.reason } : null;
  }

  /** 新连接替换旧连接：清理旧连接的房间状态并关闭它 */
  private replaceConnection(existing: ClientConnection, replacedByConnectionId: string): void {
    existing.closed = true;
    this.connections.delete(existing.id);
    this.log(
      "info",
      "ws",
      "旧 WebSocket 连接被新连接替换",
      {
        userId: existing.userId,
        username: existing.user.username,
        connectionId: existing.id,
        replacedByConnectionId,
        reason: "账号已在其他地方登录",
      },
      existing,
    );
    const roomId = existing.roomId;
    if (roomId !== null) {
      const room = this.services.rooms.findById(roomId);
      existing.roomId = null;
      existing.state.screenSharing = false;
      existing.state.speaking = false;
      const peerLeft: Extract<ServerMessage, { t: "peer_left" }> = {
        t: "peer_left",
        roomId,
        userId: existing.userId,
        reason: "账号已在其他地方登录",
      };
      this.broadcastToRoom(roomId, peerLeft, existing.id);
      this.sendNoticeToRoom(roomId, "info", existing.user.displayName + " 离开了房间", existing.id);
      this.log(
        "info",
        "room",
        "离开房间",
        { userId: existing.userId, roomId, roomName: room?.name ?? null, reason: "账号已在其他地方登录" },
        existing,
      );
      this.broadcastRooms();
      this.broadcastOnlineUsers();
    }
    this.closeConnection(existing, WS_CLOSE_CODES.replaced, "账号已在其他地方登录");
  }

  private sendHello(conn: ClientConnection): void {
    const user = this.services.auth.loadUserSelf(conn.userId, conn.roomId) ?? conn.user;
    conn.user = user;
    this.send(conn, {
      t: "hello",
      user,
      server: this.services.settings.getPublic(),
      rooms: this.roomSummaries(),
      onlineUsers: this.getOnlineUsers(),
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  /** 连接关闭（含被替换、被踢、网络断开）后的统一清理 */
  private handleSocketClose(conn: ClientConnection, closeCode: number, closeReason: string): void {
    if (conn.closeTimer) {
      clearTimeout(conn.closeTimer);
      conn.closeTimer = null;
    }
    if (conn.closed) return;
    conn.closed = true;
    this.connections.delete(conn.id);
    const current = this.byUser.get(conn.userId);
    if (!current || current.id !== conn.id) return;
    this.byUser.delete(conn.userId);
    if (this.closing) {
      conn.roomId = null;
      return;
    }
    const previousRoomId = conn.roomId;
    const previousRoom = previousRoomId !== null ? this.services.rooms.findById(previousRoomId) : undefined;
    const wasInRoom = conn.roomId !== null;
    this.detachFromRoom(conn, "断开连接", conn.user.displayName + " 断开了连接");
    this.log(
      "info",
      "ws",
      "WebSocket 已断开",
      {
        userId: conn.userId,
        username: conn.user.username,
        roomId: previousRoomId,
        reason: closeReason || "连接关闭",
        closeCode,
      },
      conn,
    );
    if (wasInRoom) {
      this.log(
        "info",
        "room",
        "离开房间",
        { userId: conn.userId, roomId: previousRoomId, roomName: previousRoom?.name ?? null, reason: "连接断开" },
        conn,
      );
      this.broadcastRooms();
    }
    this.broadcastOnlineUsers();
  }

  // ============================================================
  // 客户端消息处理
  // ============================================================

  private handleRawMessage(conn: ClientConnection, data: RawData, isBinary: boolean): void {
    if (conn.closed) return;
    if (isBinary) {
      this.sendError(conn, "bad_request", "仅支持文本消息");
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(rawDataToText(data));
    } catch {
      this.sendError(conn, "bad_request", "消息格式不正确");
      return;
    }
    const requestType = extractClientMessageType(raw);
    const message = parseClientMessage(raw);
    if (!message) {
      this.sendError(conn, "bad_request", "消息内容不正确", requestType);
      return;
    }
    try {
      this.routeMessage(conn, message);
    } catch (error) {
      this.logError("处理 WebSocket 消息失败（用户 " + conn.userId + "）", error);
      this.sendError(conn, "internal", "服务器处理消息时出错", requestType);
    }
  }

  private routeMessage(conn: ClientConnection, message: ParsedClientMessage): void {
    switch (message.t) {
      case "join_room":
        this.handleJoinRoom(conn, message.roomId, message.password);
        return;
      case "leave_room":
        this.handleLeaveRoom(conn);
        return;
      case "chat":
        this.handleChat(conn, message.content);
        return;
      case "state":
        this.handleState(conn, message.state);
        return;
      case "signal":
        this.handleSignal(conn, message.to, message.payload);
        return;
      case "screen_share":
        this.handleScreenShare(conn, message.active);
        return;
      case "ping":
        this.send(conn, { t: "pong", ts: typeof message.ts === "number" ? message.ts : Date.now() });
        return;
      case "request_rooms":
        this.send(conn, { t: "rooms", rooms: this.roomSummaries() });
        return;
      case "request_online_users":
        this.send(conn, { t: "online_users", users: this.getOnlineUsers() });
        return;
    }
  }

  // ---------- 房间 ----------

  private handleJoinRoom(conn: ClientConnection, roomId: number, password?: string): void {
    const row = this.services.rooms.findById(roomId);
    if (!row) {
      this.sendError(conn, "room_not_found", "房间不存在", "join_room");
      return;
    }
    // 已在目标房间：直接重发快照（便于客户端重连后刷新），不产生成员进出广播
    if (conn.roomId === row.id) {
      this.sendRoomJoined(conn, row);
      return;
    }
    if (row.locked === 1) {
      this.sendError(conn, "room_locked", "房间已被锁定", "join_room");
      return;
    }
    if (this.services.rooms.hasPassword(row) && !password) {
      this.sendError(conn, "room_password_required", "该房间需要密码", "join_room");
      return;
    }
    if (!this.services.rooms.verifyPassword(row, password)) {
      this.sendError(conn, "room_password_invalid", "房间密码不正确", "join_room");
      return;
    }
    const maxUsers = this.services.rooms.maxUsersFor(row);
    const currentUsers = this.getRoomCounts().get(row.id) ?? 0;
    if (currentUsers >= maxUsers) {
      this.sendError(conn, "room_full", "房间人数已满", "join_room");
      return;
    }
    const settings = this.services.settings.get();
    if (settings.maxUsers > 0 && this.getOnlineCount() > settings.maxUsers) {
      this.sendError(conn, "server_full", "服务器人数已满", "join_room");
      return;
    }

    if (conn.roomId !== null) {
      const previousRoomId = conn.roomId;
      const previousRoom = this.services.rooms.findById(previousRoomId);
      this.detachFromRoom(conn, "切换房间", conn.user.displayName + " 离开了房间");
      this.log(
        "info",
        "room",
        "离开房间",
        { userId: conn.userId, roomId: previousRoomId, roomName: previousRoom?.name ?? null, reason: "切换房间" },
        conn,
      );
      this.sendRoomLeft(conn, "切换房间");
    }
    this.attachToRoom(conn, row);
  }

  private handleLeaveRoom(conn: ClientConnection): void {
    if (conn.roomId === null) {
      this.sendError(conn, "not_in_room", "你当前不在任何房间", "leave_room");
      return;
    }
    const roomId = conn.roomId;
    const room = this.services.rooms.findById(roomId);
    this.detachFromRoom(conn, "离开房间", conn.user.displayName + " 离开了房间");
    this.log(
      "info",
      "room",
      "离开房间",
      { userId: conn.userId, roomId, roomName: room?.name ?? null, reason: "用户主动离开" },
      conn,
    );
    this.sendRoomLeft(conn);
    this.broadcastRooms();
    this.broadcastOnlineUsers();
  }

  private attachToRoom(conn: ClientConnection, row: RoomRow): void {
    conn.roomId = row.id;
    conn.joinedAt = nowIso();
    conn.state.speaking = false;
    conn.state.screenSharing = false;
    this.log("info", "room", "加入房间", { userId: conn.userId, roomId: row.id, roomName: row.name }, conn);
    this.sendRoomJoined(conn, row);

    const peer = this.toPeerInfo(conn);
    const peerJoined: Extract<ServerMessage, { t: "peer_joined" }> = {
      t: "peer_joined",
      roomId: row.id,
      peer,
    };
    this.broadcastToRoom(row.id, peerJoined, conn.id);
    this.sendNoticeToRoom(row.id, "info", conn.user.displayName + " 加入了房间", conn.id);
    this.broadcastRooms();
    this.broadcastOnlineUsers();
  }

  /** 将连接移出当前房间并广播成员变化（不广播房间/在线列表，由调用方决定时机） */
  private detachFromRoom(conn: ClientConnection, peerLeftReason?: string, noticeText?: string): void {
    const roomId = conn.roomId;
    if (roomId === null) return;
    conn.roomId = null;
    conn.joinedAt = null;
    conn.state.speaking = false;
    conn.state.screenSharing = false;
    const peerLeft: Extract<ServerMessage, { t: "peer_left" }> = {
      t: "peer_left",
      roomId,
      userId: conn.userId,
    };
    if (peerLeftReason) peerLeft.reason = peerLeftReason;
    this.broadcastToRoom(roomId, peerLeft, conn.id);
    this.sendNoticeToRoom(roomId, "info", noticeText ?? conn.user.displayName + " 离开了房间", conn.id);
  }

  private sendRoomJoined(conn: ClientConnection, row: RoomRow): void {
    this.send(conn, { t: "room_joined", snapshot: this.buildRoomSnapshot(conn, row) });
  }

  private buildRoomSnapshot(conn: ClientConnection, row: RoomRow): RoomSnapshot {
    const members = this.roomConnections(row.id);
    const peers = members
      .filter((member) => member.id !== conn.id)
      .map((member) => this.toPeerInfo(member))
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    const sharer = members.find((member) => member.state.screenSharing);
    return {
      room: this.services.rooms.toDetail(row, members.length),
      peers,
      messages: this.services.rooms.listMessages(row.id, 50),
      screenSharerId: sharer ? sharer.userId : null,
    };
  }

  private sendRoomLeft(conn: ClientConnection, reason?: string): void {
    const roomLeft: Extract<ServerMessage, { t: "room_left" }> = { t: "room_left" };
    if (reason) roomLeft.reason = reason;
    this.send(conn, roomLeft);
  }

  /** 房间成员状态（麦克风/说话/共享），高频消息做限流，超出直接丢弃 */
  private handleState(conn: ClientConnection, requested: PeerStatePatch): void {
    if (!globalRateLimiter.hit("ws:state:" + conn.id, STATE_RATE_LIMIT.limit, STATE_RATE_LIMIT.windowMs)) return;
    const patch: PeerStatePatch = {};
    if (typeof requested.muted === "boolean" && requested.muted !== conn.state.muted) patch.muted = requested.muted;
    if (typeof requested.deafened === "boolean" && requested.deafened !== conn.state.deafened) {
      patch.deafened = requested.deafened;
    }
    if (typeof requested.speaking === "boolean" && requested.speaking !== conn.state.speaking) {
      patch.speaking = requested.speaking;
    }
    // 被强制静音时不允许自行解除
    if (conn.state.forceMuted && patch.muted === false) delete patch.muted;
    if (typeof requested.screenSharing === "boolean" && requested.screenSharing !== conn.state.screenSharing) {
      if (requested.screenSharing) {
        const blocked = this.screenShareBlockReason(conn);
        if (blocked) {
          this.sendError(conn, blocked.code, blocked.message, "state");
        } else {
          patch.screenSharing = true;
        }
      } else {
        patch.screenSharing = false;
      }
    }
    if (Object.keys(patch).length === 0) return;
    this.applyStatePatch(conn, patch);
    if (conn.roomId !== null) {
      this.broadcastToRoom(
        conn.roomId,
        { t: "peer_state", roomId: conn.roomId, userId: conn.userId, state: patch },
        conn.id,
      );
    }
  }

  private applyStatePatch(conn: ClientConnection, patch: PeerStatePatch): void {
    if (patch.muted !== undefined) conn.state.muted = patch.muted;
    if (patch.deafened !== undefined) conn.state.deafened = patch.deafened;
    if (patch.speaking !== undefined) conn.state.speaking = patch.speaking;
    if (patch.screenSharing !== undefined) conn.state.screenSharing = patch.screenSharing;
    if (patch.forceMuted !== undefined) conn.state.forceMuted = patch.forceMuted;
  }

  private screenShareBlockReason(conn: ClientConnection): { code: WsErrorCode; message: string } | null {
    if (conn.roomId === null) return { code: "not_in_room", message: "请先加入房间" };
    const settings = this.services.settings.get();
    if (!settings.allowScreenShare) return { code: "screen_share_disabled", message: "服务器已关闭屏幕共享" };
    const row = this.services.rooms.findById(conn.roomId);
    if (!row) return { code: "room_not_found", message: "房间不存在" };
    if (row.screen_share_enabled !== 1) {
      return { code: "screen_share_disabled", message: "当前房间未开启屏幕共享" };
    }
    const otherSharer = this.roomConnections(row.id).find(
      (member) => member.id !== conn.id && member.state.screenSharing,
    );
    if (otherSharer) return { code: "screen_share_busy", message: "房间内已有其他人在共享屏幕" };
    return null;
  }

  private handleScreenShare(conn: ClientConnection, active: boolean): void {
    if (conn.roomId === null) {
      this.sendError(conn, "not_in_room", "请先加入房间", "screen_share");
      return;
    }
    const roomId = conn.roomId;
    if (active) {
      const blocked = this.screenShareBlockReason(conn);
      if (blocked) {
        this.sendError(conn, blocked.code, blocked.message, "screen_share");
        return;
      }
      if (conn.state.screenSharing) return;
      conn.state.screenSharing = true;
      this.broadcastToRoom(
        roomId,
        { t: "peer_state", roomId, userId: conn.userId, state: { screenSharing: true } },
        conn.id,
      );
      this.sendNoticeToRoom(roomId, "info", conn.user.displayName + " 开始共享屏幕", conn.id);
      this.log("info", "voice", "开始屏幕共享", { roomId, userId: conn.userId }, conn);
    } else {
      if (!conn.state.screenSharing) return;
      conn.state.screenSharing = false;
      this.broadcastToRoom(
        roomId,
        { t: "peer_state", roomId, userId: conn.userId, state: { screenSharing: false } },
        conn.id,
      );
      this.sendNoticeToRoom(roomId, "info", conn.user.displayName + " 停止了屏幕共享", conn.id);
      this.log("info", "voice", "停止屏幕共享", { roomId, userId: conn.userId }, conn);
    }
    this.broadcastOnlineUsers();
  }

  // ---------- 聊天 ----------

  private handleChat(conn: ClientConnection, rawContent: string): void {
    if (conn.roomId === null) {
      this.sendError(conn, "not_in_room", "请先加入房间", "chat");
      return;
    }
    const settings = this.services.settings.get();
    if (!settings.allowTextChat) {
      this.sendError(conn, "chat_disabled", "服务器已关闭文字聊天", "chat");
      return;
    }
    if (conn.user.isGuest && !settings.allowGuestChat) {
      this.sendError(conn, "chat_disabled", "游客不能发送文字消息", "chat");
      return;
    }
    const content = rawContent.trim();
    if (!content) {
      this.sendError(conn, "bad_request", "消息内容不能为空", "chat");
      return;
    }
    if (content.length > settings.maxChatLength) {
      this.sendError(conn, "chat_too_long", "消息最多 " + settings.maxChatLength + " 个字符", "chat");
      return;
    }
    if (!globalRateLimiter.hit("ws:chat:" + conn.id, CHAT_RATE_LIMIT.limit, CHAT_RATE_LIMIT.windowMs)) {
      this.sendError(conn, "rate_limited", "发送消息太频繁，请稍后再试", "chat");
      return;
    }
    const roomId = conn.roomId;
    try {
      const message = this.services.rooms.addMessage(
        roomId,
        { id: conn.userId, name: conn.user.displayName, role: conn.user.role },
        content,
        "text",
      );
      this.broadcastToRoom(roomId, { t: "chat_message", roomId, message });
    } catch (error) {
      this.logError("保存聊天消息失败（房间 " + roomId + "）", error);
      this.sendError(conn, "internal", "消息发送失败", "chat");
    }
  }

  // ---------- WebRTC 信令 ----------

  private handleSignal(conn: ClientConnection, to: number, payload: SignalPayload): void {
    if (conn.roomId === null) {
      this.sendError(conn, "not_in_room", "请先加入房间", "signal");
      return;
    }
    if (!globalRateLimiter.hit("ws:signal:" + conn.id, SIGNAL_RATE_LIMIT.limit, SIGNAL_RATE_LIMIT.windowMs)) {
      this.sendError(conn, "rate_limited", "信令发送过于频繁", "signal");
      return;
    }
    if (to === conn.userId) {
      this.sendError(conn, "peer_not_found", "不能向自己发送信令", "signal");
      return;
    }
    const target = this.byUser.get(to);
    if (!target || target.closed || target.roomId !== conn.roomId) {
      this.sendError(conn, "peer_not_found", "目标用户不在当前房间", "signal");
      return;
    }
    this.send(target, { t: "signal", from: conn.userId, payload });
  }

  // ============================================================
  // HubLike 实现（供 REST 管理接口调用）
  // ============================================================

  getRoomCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const conn of this.connections.values()) {
      if (conn.roomId === null) continue;
      counts.set(conn.roomId, (counts.get(conn.roomId) ?? 0) + 1);
    }
    return counts;
  }

  getRoomIdForUser(userId: number): number | null {
    return this.byUser.get(userId)?.roomId ?? null;
  }

  getOnlineUsers(): OnlineUser[] {
    const users: OnlineUser[] = [];
    for (const conn of this.connections.values()) {
      const room = conn.roomId !== null ? this.services.rooms.findById(conn.roomId) : undefined;
      users.push({
        userId: conn.userId,
        username: conn.user.username,
        displayName: conn.user.displayName,
        role: conn.user.role,
        isGuest: conn.user.isGuest,
        avatarColor: conn.user.avatarColor,
        avatarEmoji: conn.user.avatarEmoji,
        roomId: conn.roomId,
        roomName: room?.name ?? null,
        muted: conn.state.muted,
        deafened: conn.state.deafened,
        speaking: conn.state.speaking,
      });
    }
    users.sort((a, b) => a.userId - b.userId);
    return users;
  }

  getOnlineCount(): number {
    return this.connections.size;
  }

  getPeakOnline(): number {
    return Math.max(this.peakOnline, this.connections.size);
  }

  isOnline(userId: number): boolean {
    return this.byUser.has(userId);
  }

  kick(userId: number, scope: "server" | "room", reason: string): boolean {
    const conn = this.byUser.get(userId);
    if (!conn || conn.closed) return false;
    const text = reason.trim() || (scope === "server" ? "你已被管理员踢出服务器" : "你已被管理员请出房间");
    if (scope === "room") {
      const roomId = conn.roomId;
      if (roomId === null) return false;
      this.log("info", "admin", "管理员将用户移出房间", { userId, scope, reason: text, roomId }, conn);
      const room = this.services.rooms.findById(roomId);
      this.send(conn, { t: "kicked", scope: "room", reason: text });
      this.detachFromRoom(conn, text, conn.user.displayName + " 被移出了房间");
      this.log("info", "room", "被移出房间", { userId, roomId, roomName: room?.name ?? null, reason: text }, conn);
      this.sendRoomLeft(conn, text);
      this.broadcastRooms();
      this.broadcastOnlineUsers();
      return true;
    }
    this.log("info", "admin", "管理员踢出用户（服务器）", { userId, scope, reason: text, roomId: conn.roomId }, conn);
    this.send(conn, { t: "kicked", scope: "server", reason: text });
    if (conn.roomId !== null) {
      const roomId = conn.roomId;
      const room = this.services.rooms.findById(roomId);
      this.detachFromRoom(conn, text, conn.user.displayName + " 被移出了房间");
      this.log("info", "room", "被移出房间", { userId, roomId, roomName: room?.name ?? null, reason: text }, conn);
      this.broadcastRooms();
      this.broadcastOnlineUsers();
    }
    this.closeConnection(conn, WS_CLOSE_CODES.kicked, text);
    return true;
  }

  disconnectUser(userId: number, reason: string): boolean {
    const conn = this.byUser.get(userId);
    if (!conn || conn.closed) return false;
    const text = reason.trim() || "你的登录状态已失效";
    this.log("info", "admin", "管理员断开用户连接", { userId, reason: text }, conn);
    this.send(conn, { t: "session_ended", reason: text });
    if (conn.roomId !== null) {
      const roomId = conn.roomId;
      const room = this.services.rooms.findById(roomId);
      this.detachFromRoom(conn, text, conn.user.displayName + " 断开了连接");
      this.log("info", "room", "离开房间", { userId, roomId, roomName: room?.name ?? null, reason: text }, conn);
      this.broadcastRooms();
      this.broadcastOnlineUsers();
    }
    this.closeConnection(conn, WS_CLOSE_CODES.session_ended, text);
    return true;
  }

  forceMute(userId: number, muted: boolean, reason?: string): boolean {
    const conn = this.byUser.get(userId);
    if (!conn || conn.closed) return false;
    this.log(
      "info",
      "admin",
      muted ? "管理员强制静音用户" : "管理员解除用户强制静音",
      { userId, muted, reason: reason ?? null, roomId: conn.roomId },
      conn,
    );
    conn.state.forceMuted = muted;
    conn.state.muted = muted;
    const patch: PeerStatePatch = { muted, forceMuted: muted };
    if (conn.roomId !== null) {
      this.broadcastToRoom(conn.roomId, { t: "peer_state", roomId: conn.roomId, userId, state: patch });
    }
    const forceMuted: Extract<ServerMessage, { t: "force_muted" }> = { t: "force_muted", muted };
    if (reason) forceMuted.reason = reason;
    this.send(conn, forceMuted);
    const text = muted
      ? "你已被管理员强制静音" + (reason ? "：" + reason : "")
      : "管理员已解除你的强制静音";
    this.send(conn, { t: "notice", roomId: conn.roomId, level: muted ? "warn" : "info", text, createdAt: nowIso() });
    this.broadcastOnlineUsers();
    return true;
  }

  moveToRoom(userId: number, roomId: number | null): boolean {
    const conn = this.byUser.get(userId);
    if (!conn || conn.closed) return false;
    this.log(
      "info",
      "admin",
      roomId === null ? "管理员将用户移回大厅" : "管理员移动用户房间",
      { userId, roomId, scope: "room" },
      conn,
    );
    if (roomId === null) {
      if (conn.roomId === null) return true;
      const previousRoomId = conn.roomId;
      const previousRoom = this.services.rooms.findById(previousRoomId);
      this.detachFromRoom(conn, "管理员将你移出了房间", conn.user.displayName + " 离开了房间");
      this.log(
        "info",
        "room",
        "离开房间",
        { userId, roomId: previousRoomId, roomName: previousRoom?.name ?? null, reason: "管理员移出房间" },
        conn,
      );
      this.sendRoomLeft(conn, "管理员将你移出了房间");
      this.broadcastRooms();
      this.broadcastOnlineUsers();
      return true;
    }
    if (conn.roomId === roomId) return true;
    const row = this.services.rooms.findById(roomId);
    if (!row) return false;
    if (row.locked === 1) return false;
    const currentUsers = this.getRoomCounts().get(roomId) ?? 0;
    if (currentUsers >= this.services.rooms.maxUsersFor(row)) return false;
    if (conn.roomId !== null) {
      const previousRoomId = conn.roomId;
      const previousRoom = this.services.rooms.findById(previousRoomId);
      this.detachFromRoom(conn, "管理员移动了你的房间", conn.user.displayName + " 被移动到了其他房间");
      this.log(
        "info",
        "room",
        "离开房间",
        { userId, roomId: previousRoomId, roomName: previousRoom?.name ?? null, reason: "管理员移动房间" },
        conn,
      );
      this.sendRoomLeft(conn, "管理员移动了你的房间");
    }
    this.attachToRoom(conn, row);
    return true;
  }

  refreshUser(userId: number): void {
    const conn = this.byUser.get(userId);
    if (!conn || conn.closed) return;
    const user = this.services.auth.loadUserSelf(userId, conn.roomId) ?? conn.user;
    conn.user = user;
    if (conn.roomId !== null) {
      const peerUpdated: Extract<ServerMessage, { t: "peer_updated" }> = {
        t: "peer_updated",
        roomId: conn.roomId,
        peer: this.toPeerInfo(conn),
      };
      this.broadcastToRoom(conn.roomId, peerUpdated, conn.id);
    }
    this.broadcastOnlineUsers();
  }

  broadcastRooms(): void {
    this.broadcast({ t: "rooms", rooms: this.roomSummaries() });
  }

  broadcastRoomUpdate(roomId: number): void {
    const row = this.services.rooms.findById(roomId);
    if (!row) return;
    const room = this.services.rooms.toDetail(row, this.getRoomCounts().get(roomId) ?? 0);
    this.broadcastToRoom(roomId, { t: "room_updated", room });
  }

  broadcastRoomDeleted(roomId: number, reason?: string): void {
    const affected = this.roomConnections(roomId);
    if (affected.length === 0) {
      this.broadcastRooms();
      return;
    }
    const text = reason ?? "房间已被删除";
    for (const conn of affected) {
      conn.roomId = null;
      conn.joinedAt = null;
      conn.state.speaking = false;
      conn.state.screenSharing = false;
      this.log("info", "room", "离开房间", { userId: conn.userId, roomId, reason: text }, conn);
      this.send(conn, { t: "room_deleted", roomId });
      this.sendRoomLeft(conn, text);
    }
    this.broadcastRooms();
    this.broadcastOnlineUsers();
  }

  broadcastOnlineUsers(): void {
    this.broadcast({ t: "online_users", users: this.getOnlineUsers() });
  }

  broadcastServerSettings(): void {
    this.broadcast({ t: "server_settings", server: this.services.settings.getPublic() });
  }

  shutdown(): void {
    if (this.closing) return;
    this.closing = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const conn of [...this.connections.values()]) {
      conn.closed = true;
      if (conn.closeTimer) {
        clearTimeout(conn.closeTimer);
        conn.closeTimer = null;
      }
      try {
        if (conn.socket.readyState === conn.socket.OPEN) {
          conn.socket.close(WS_CLOSE_CODES.shutdown, "服务器正在关闭");
        } else {
          conn.socket.terminate();
        }
      } catch {
        /* 关闭过程中的异常无需处理 */
      }
    }
    this.connections.clear();
    this.byUser.clear();
  }

  // ============================================================
  // 心跳
  // ============================================================

  private heartbeatTick(): void {
    if (this.closing) return;
    for (const conn of [...this.connections.values()]) {
      if (conn.closed) continue;
      if (conn.missedHeartbeats >= HEARTBEAT_MAX_MISSED) {
        conn.missedHeartbeats += 1;
        this.terminateSocket(conn);
        continue;
      }
      conn.missedHeartbeats += 1;
      try {
        conn.pingSentAt = Date.now();
        conn.socket.ping();
      } catch {
        this.terminateSocket(conn);
      }
    }
  }

  private terminateSocket(conn: ClientConnection): void {
    try {
      conn.socket.terminate();
    } catch (error) {
      this.logWarn("终止 WebSocket 连接失败（用户 " + conn.userId + "）：" + describeError(error));
    }
  }

  // ============================================================
  // 发送 / 视图辅助
  // ============================================================

  private send(conn: ClientConnection, message: ServerMessage): void {
    try {
      if (conn.socket.readyState !== conn.socket.OPEN) return;
      conn.socket.send(JSON.stringify(message));
    } catch (error) {
      this.logWarn("发送 WebSocket 消息失败（用户 " + conn.userId + "）：" + describeError(error));
    }
  }

  private sendError(
    conn: ClientConnection,
    code: WsErrorCode,
    message: string,
    request?: ClientMessage["t"],
  ): void {
    if (request) {
      this.send(conn, { t: "error", code, message, request });
    } else {
      this.send(conn, { t: "error", code, message });
    }
    // 客户端错误写入运行日志（rate_limited 属于预期内的高频反馈，不记录；其余做频率上限避免刷屏）
    if (code !== "rate_limited" && globalRateLimiter.hit("ws:error-log:" + conn.id, 30, 60_000)) {
      this.log(
        "warn",
        "ws",
        "客户端操作失败：" + message,
        { code, request: request ?? null, userId: conn.userId, roomId: conn.roomId },
        conn,
      );
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const conn of [...this.connections.values()]) this.send(conn, message);
  }

  private broadcastToRoom(roomId: number, message: ServerMessage, exceptConnectionId?: string): void {
    for (const conn of [...this.connections.values()]) {
      if (conn.roomId !== roomId) continue;
      if (exceptConnectionId !== undefined && conn.id === exceptConnectionId) continue;
      this.send(conn, message);
    }
  }

  private sendNoticeToRoom(
    roomId: number,
    level: "info" | "warn" | "error",
    text: string,
    exceptConnectionId?: string,
  ): void {
    this.broadcastToRoom(roomId, { t: "notice", roomId, level, text, createdAt: nowIso() }, exceptConnectionId);
  }

  private closeConnection(conn: ClientConnection, code: number, reason: string): void {
    try {
      if (conn.socket.readyState === conn.socket.OPEN || conn.socket.readyState === conn.socket.CONNECTING) {
        conn.socket.close(code, truncateCloseReason(reason));
      }
    } catch {
      try {
        conn.socket.terminate();
      } catch {
        /* ignore */
      }
    }
    if (conn.closeTimer) return;
    const timer = setTimeout(() => {
      conn.closeTimer = null;
      try {
        if (conn.socket.readyState !== conn.socket.CLOSED) conn.socket.terminate();
      } catch {
        /* ignore */
      }
    }, CLOSE_WATCHDOG_MS);
    timer.unref();
    conn.closeTimer = timer;
  }

  private roomConnections(roomId: number): ClientConnection[] {
    const members: ClientConnection[] = [];
    for (const conn of this.connections.values()) {
      if (conn.roomId === roomId) members.push(conn);
    }
    return members;
  }

  private roomSummaries(): ReturnType<Services["rooms"]["list"]> {
    return this.services.rooms.list(this.getRoomCounts());
  }

  private toPeerInfo(conn: ClientConnection): PeerInfo {
    return {
      userId: conn.userId,
      username: conn.user.username,
      displayName: conn.user.displayName,
      role: conn.user.role,
      isGuest: conn.user.isGuest,
      avatarColor: conn.user.avatarColor,
      avatarEmoji: conn.user.avatarEmoji,
      statusText: conn.user.statusText,
      muted: conn.state.muted,
      deafened: conn.state.deafened,
      speaking: conn.state.speaking,
      screenSharing: conn.state.screenSharing,
      forceMuted: conn.state.forceMuted,
      rttMs: conn.rttMs,
      joinedAt: conn.joinedAt ?? nowIso(),
    };
  }

  /**
   * 写入运行日志（管理后台排障用）。
   * 任何异常都不能影响实时层主流程；不记录 cookie/token、聊天正文与 SDP/ICE 内容。
   * meta 中只放排障需要的标识与小字段，避免日志表膨胀。
   */
  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    meta?: unknown,
    conn?: ClientConnection | null,
    extra?: { userId?: number; username?: string; ip?: string },
  ): void {
    try {
      this.services.logs.write({
        level,
        category,
        message,
        meta,
        userId: extra?.userId ?? conn?.userId ?? null,
        username: extra?.username ?? conn?.user.username ?? null,
        ip: extra?.ip ?? conn?.ip ?? null,
      });
    } catch {
      /* 日志写入失败不影响业务 */
    }
  }

  private logWarn(message: string): void {
    this.logger?.warn(message);
  }

  private logError(message: string, error: unknown): void {
    this.logger?.error(message + "：" + describeError(error));
  }
}

/** 关闭尚未注册为 ClientConnection 的 socket，并在超时后强制 terminate */
function closeSocketWithWatchdog(socket: WebSocket, code: number, reason: string): void {
  try {
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
      socket.close(code, truncateCloseReason(reason));
    }
  } catch {
    try {
      socket.terminate();
    } catch {
      /* ignore */
    }
  }
  const timer = setTimeout(() => {
    try {
      if (socket.readyState !== socket.CLOSED) socket.terminate();
    } catch {
      /* ignore */
    }
  }, CLOSE_WATCHDOG_MS);
  timer.unref();
}

/** WebSocket close reason 最多 123 字节，按 UTF-8 安全截断 */
function truncateCloseReason(reason: string): string {
  const maxBytes = 120;
  if (Buffer.byteLength(reason, "utf8") <= maxBytes) return reason;
  let result = "";
  for (const char of reason) {
    if (Buffer.byteLength(result + char, "utf8") > maxBytes) break;
    result += char;
  }
  return result;
}

function rawDataToText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return String(data);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

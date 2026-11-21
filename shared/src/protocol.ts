import type {
  ChatMessage,
  OnlineUser,
  PeerInfo,
  PeerStatePatch,
  RoomDetail,
  RoomDirectory,
  RoomSnapshot,
  RoomSummary,
  ServerSettingsPublic,
  SignalPayload,
  UserSelf,
} from "./types.js";

/** WebSocket 挂载路径 */
export const WS_PATH = "/ws";
/** 单条 WebSocket 消息最大字节数 */
export const WS_MAX_MESSAGE_BYTES = 256 * 1024;
/** WebSocket 心跳间隔；同时决定成员延迟的采样频率（2 秒一次，够实时又不算吵） */
export const WS_HEARTBEAT_INTERVAL_MS = 2_000;

export const WS_CLOSE_CODES = {
  normal: 1000,
  shutdown: 1001,
  replaced: 4001,
  banned: 4002,
  kicked: 4003,
  session_ended: 4004,
} as const;

export type WsErrorCode =
  | "unauthorized"
  | "bad_request"
  | "banned"
  | "rate_limited"
  | "server_full"
  | "room_not_found"
  | "room_password_required"
  | "room_password_invalid"
  | "room_code_required"
  | "room_code_invalid"
  | "room_full"
  | "room_locked"
  | "room_guests_disabled"
  | "not_in_room"
  | "peer_not_found"
  | "chat_disabled"
  | "chat_too_long"
  | "screen_share_disabled"
  | "screen_share_busy"
  | "stage_full"
  | "stage_not_allowed"
  | "stage_not_requested"
  | "forbidden"
  | "internal";

/** 客户端 -> 服务端 */
export type CodeRoomRequest =
  | { t: "create_code_room"; name: string }
  | { t: "join_code_room"; code: string; roomId?: number };

export type ClientMessage =
  | { t: "join_room"; roomId: number; password?: string }
  | CodeRoomRequest
  | { t: "leave_room" }
  | { t: "chat"; content: string }
  | { t: "state"; state: PeerStatePatch }
  | { t: "signal"; to: number; payload: SignalPayload }
  | { t: "screen_share"; active: boolean }
  | { t: "stage_request" }
  | { t: "stage_leave" }
  | { t: "stage_approve"; userId: number; approved: boolean }
  | { t: "ping"; ts?: number }
  | { t: "request_rooms" }
  | { t: "request_online_users" };

/** 服务端 -> 客户端 */
export type ServerMessage =
  | {
      t: "hello";
      user: UserSelf;
      server: ServerSettingsPublic;
      rooms: RoomSummary[];
      directory: RoomDirectory;
      onlineUsers: OnlineUser[];
      protocolVersion: number;
    }
  | { t: "rooms"; rooms: RoomSummary[] }
  | { t: "room_directory_changed" }
  | { t: "online_users"; users: OnlineUser[] }
  | { t: "room_joined"; snapshot: RoomSnapshot; request?: CodeRoomRequest["t"] }
  | { t: "room_left"; reason?: string }
  | { t: "peer_joined"; roomId: number; peer: PeerInfo }
  | { t: "peer_left"; roomId: number; userId: number; reason?: string }
  | { t: "peer_updated"; roomId: number; peer: PeerInfo }
  | { t: "peer_state"; roomId: number; userId: number; state: PeerStatePatch }
  | { t: "stage_requested"; roomId: number; userId: number }
  | { t: "stage_update"; roomId: number; userId: number; onStage: boolean; pending?: boolean }
  | { t: "peer_latency"; roomId: number; userId: number; rttMs: number | null }
  | { t: "chat_message"; roomId: number; message: ChatMessage }
  | { t: "notice"; roomId: number | null; level: "info" | "warn" | "error"; text: string; createdAt: string }
  | { t: "signal"; from: number; payload: SignalPayload }
  | { t: "room_updated"; room: RoomDetail }
  | { t: "server_settings"; server: ServerSettingsPublic }
  | { t: "room_deleted"; roomId: number }
  | { t: "kicked"; scope: "server" | "room"; reason: string }
  | { t: "force_muted"; muted: boolean; reason?: string }
  | { t: "session_ended"; reason: string }
  | { t: "error"; code: WsErrorCode; message: string; request?: ClientMessage["t"] }
  | { t: "pong"; ts: number };

export type ClientMessageType = ClientMessage["t"];
export type ServerMessageType = ServerMessage["t"];

/** 音质参数改动后是否必须重新协商 SDP（除码率外） */
export function audioChangeNeedsRenegotiation(previous: {
  channels: number;
  dtx: boolean;
  fec: boolean;
  sampleRate: number;
}, next: { channels: number; dtx: boolean; fec: boolean; sampleRate: number }): boolean {
  return (
    previous.channels !== next.channels ||
    previous.dtx !== next.dtx ||
    previous.fec !== next.fec ||
    previous.sampleRate !== next.sampleRate
  );
}

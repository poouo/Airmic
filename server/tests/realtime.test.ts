import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, SignalPayload } from "@airmic/shared";
import { PROTOCOL_VERSION, WS_CLOSE_CODES } from "@airmic/shared";
import { createTestContext, sleep, type TestClient, type TestContext } from "./helpers.js";
import { getHub } from "../src/realtime/instance.js";

// 测试环境使用更短的心跳间隔，便于覆盖心跳超时逻辑
process.env.AIRMIC_WS_HEARTBEAT_MS = "100";

const WAIT_TIMEOUT = 3000;
const TEST_OPTIONS = { timeout: 30_000 } as const;

type MessageOf<T extends ServerMessage["t"]> = Extract<ServerMessage, { t: T }>;

interface CloseInfo {
  code: number;
  reason: string;
}

interface Waiter {
  predicate: (message: ServerMessage) => boolean;
  resolve: (message: ServerMessage) => void;
  timer: NodeJS.Timeout;
}

/** 轻量 WebSocket 客户端：保留所有非匹配消息，便于按条件等待，并支持关闭码断言 */
class RawWs {
  readonly messages: ServerMessage[] = [];
  private closeInfo: CloseInfo | null = null;
  private readonly waiters: Waiter[] = [];
  private readonly closeWaiters: { resolve: (info: CloseInfo) => void; timer: NodeJS.Timeout }[] = [];
  private readonly pingWaiters: { resolve: () => void; timer: NodeJS.Timeout }[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (raw) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return;
      }
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter!.timer);
        waiter!.resolve(message);
        return;
      }
      this.messages.push(message);
    });
    socket.on("close", (code, reason) => {
      this.closeInfo = { code, reason: reason.toString() };
      for (const waiter of this.closeWaiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve(this.closeInfo);
      }
    });
    socket.on("error", () => {
      /* 连接错误由 close 事件统一处理 */
    });
    socket.on("ping", () => {
      for (const waiter of this.pingWaiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
    });
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.socket.send(text);
  }

  waitFor<T extends ServerMessage["t"]>(
    type: T,
    predicate?: (message: MessageOf<T>) => boolean,
    timeoutMs = WAIT_TIMEOUT,
  ): Promise<MessageOf<T>> {
    return this.waitForMessage((message): message is MessageOf<T> => {
      if (message.t !== type) return false;
      return predicate ? predicate(message as MessageOf<T>) : true;
    }, timeoutMs);
  }

  waitForMessage<T extends ServerMessage>(
    guard: (message: ServerMessage) => message is T,
    timeoutMs = WAIT_TIMEOUT,
  ): Promise<T> {
    const index = this.messages.findIndex(guard);
    if (index >= 0) {
      const [message] = this.messages.splice(index, 1);
      return Promise.resolve(message as T);
    }
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        predicate: guard,
        resolve: (message) => resolve(message as T),
        timer: setTimeout(() => {
          const at = this.waiters.indexOf(waiter);
          if (at >= 0) this.waiters.splice(at, 1);
          reject(new Error("等待 WebSocket 消息超时，已收到: " + this.messages.map((message) => message.t).join(", ")));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  waitForClose(timeoutMs = WAIT_TIMEOUT): Promise<CloseInfo> {
    if (this.closeInfo) return Promise.resolve(this.closeInfo);
    return new Promise<CloseInfo>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待 WebSocket 关闭超时")), timeoutMs);
      this.closeWaiters.push({ resolve, timer });
    });
  }

  waitForServerPing(timeoutMs = WAIT_TIMEOUT): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待服务端心跳 ping 超时")), timeoutMs);
      this.pingWaiters.push({ resolve, timer });
    });
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}

/** 每个用例独立的测试会话：固定先注册一名管理员，再注册普通用户 */
class Session {
  private readonly sockets: WebSocket[] = [];

  private constructor(
    readonly ctx: TestContext,
    private readonly adminClient: TestClient,
  ) {}

  static async create(): Promise<Session> {
    const ctx = await createTestContext();
    const adminClient = await ctx.registerUser("admin");
    return new Session(ctx, adminClient);
  }

  get admin(): TestClient {
    return this.adminClient;
  }

  get hub() {
    const hub = getHub();
    assert.ok(hub, "实时层 Hub 尚未初始化");
    return hub;
  }

  async registerUser(username: string): Promise<{ client: TestClient; userId: number }> {
    const client = this.ctx.newClient();
    const result = await client.register(username);
    assert.equal(result.status, 200, "注册用户失败: " + JSON.stringify(result.body));
    return { client, userId: result.body.user.id };
  }

  async connect(client: TestClient | null, options: { autoPong?: boolean } = {}): Promise<RawWs> {
    const headers: Record<string, string> = {};
    if (client) headers.cookie = client.cookieHeader();
    const socket = new WebSocket(this.ctx.wsUrl, { headers, autoPong: options.autoPong ?? true });
    this.sockets.push(socket);
    const raw = new RawWs(socket);
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        socket.off("open", onOpen);
        socket.off("error", onError);
      };
      const onOpen = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
    });
    return raw;
  }

  async connectWithHello(client: TestClient | null): Promise<{ ws: RawWs; hello: MessageOf<"hello"> }> {
    const ws = await this.connect(client);
    const hello = await ws.waitFor("hello");
    return { ws, hello };
  }

  async createRoom(payload: Record<string, unknown>): Promise<number> {
    const result = await this.admin.post<{ room: { id: number } }>("/api/rooms", payload);
    assert.equal(result.status, 200, "创建房间失败: " + JSON.stringify(result.body));
    return result.body.room.id;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    await this.ctx.close();
  }
}

async function withSession(fn: (session: Session) => Promise<void>): Promise<void> {
  const session = await Session.create();
  try {
    await fn(session);
  } finally {
    await session.close();
  }
}

async function waitUntil(condition: () => boolean, label: string, timeoutMs = WAIT_TIMEOUT): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await sleep(20);
  }
  assert.fail("等待条件超时: " + label);
}

async function joinRoom(ws: RawWs, roomId: number, password?: string): Promise<MessageOf<"room_joined">> {
  ws.send(password ? { t: "join_room", roomId, password } : { t: "join_room", roomId });
  return ws.waitFor("room_joined", (message) => message.snapshot.room.id === roomId);
}

// ============================================================
// 1. 连接认证
// ============================================================

test("未认证的 WebSocket 连接被拒绝（close 4001）", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const ws = await session.connect(null);
    const close = await ws.waitForClose();
    assert.equal(close.code, 4001);
    assert.match(close.reason, /登录/);
    assert.equal(session.hub.getOnlineCount(), 0);
  }),
);

test("hello 包含 user/server/rooms/onlineUsers/protocolVersion", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const alice = await session.registerUser("alice");
    const roomId = await session.createRoom({ name: "公告房" });
    const { hello } = await session.connectWithHello(alice.client);

    assert.equal(hello.user.id, alice.userId);
    assert.equal(hello.user.username, "alice");
    assert.equal(hello.user.role, "user");
    assert.ok(hello.server.name.length > 0);
    assert.equal(hello.server.maxUsers > 0, true);
    assert.equal(Array.isArray(hello.rooms), true);
    assert.equal(hello.rooms.length, 1);
    assert.equal(hello.rooms[0]?.id, roomId);
    assert.deepEqual(
      hello.onlineUsers.map((user) => user.userId),
      [alice.userId],
    );
    assert.equal(hello.protocolVersion, PROTOCOL_VERSION);
  }),
);

test("同一账号的新连接替换旧连接（旧连接 close 4001）", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const alice = await session.registerUser("alice");
    const first = await session.connectWithHello(alice.client);
    const second = await session.connectWithHello(alice.client);

    const close = await first.ws.waitForClose();
    assert.equal(close.code, WS_CLOSE_CODES.replaced);
    assert.match(close.reason, /其他地方登录/);
    assert.equal(session.hub.getOnlineCount(), 1);
    assert.equal(session.hub.isOnline(alice.userId), true);

    // 新连接仍然可用
    second.ws.send({ t: "ping", ts: 7 });
    const pong = await second.ws.waitFor("pong");
    assert.equal(pong.ts, 7);
  }),
);

// ============================================================
// 2. 房间加入 / 离开
// ============================================================

test("两个用户加入同一房间：快照、peer_joined、rooms 与 online_users 同步", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "同步房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");

    const aliceWs = await session.connectWithHello(alice.client);
    const joinedAlice = await joinRoom(aliceWs.ws, roomId);
    assert.equal(joinedAlice.snapshot.room.userCount, 1);
    assert.deepEqual(joinedAlice.snapshot.peers, []);
    assert.deepEqual(joinedAlice.snapshot.messages, []);
    assert.equal(joinedAlice.snapshot.screenSharerId, null);

    const bobWs = await session.connectWithHello(bob.client);
    const joinedBob = await joinRoom(bobWs.ws, roomId);
    assert.equal(joinedBob.snapshot.room.userCount, 2);
    assert.deepEqual(
      joinedBob.snapshot.peers.map((peer) => peer.userId),
      [alice.userId],
    );

    const peerJoined = await aliceWs.ws.waitFor("peer_joined", (message) => message.peer.userId === bob.userId);
    assert.equal(peerJoined.roomId, roomId);
    assert.equal(peerJoined.peer.displayName, "bob");

    const roomsMessage = await aliceWs.ws.waitFor("rooms", (message) =>
      message.rooms.some((room) => room.id === roomId && room.userCount === 2),
    );
    assert.equal(roomsMessage.rooms.find((room) => room.id === roomId)?.userCount, 2);

    const aliceOnline = await aliceWs.ws.waitFor(
      "online_users",
      (message) => message.users.length === 2 && message.users.every((user) => user.roomId === roomId),
    );
    assert.deepEqual(
      aliceOnline.users.map((user) => user.userId).sort((a, b) => a - b),
      [alice.userId, bob.userId].sort((a, b) => a - b),
    );

    const bobOnline = await bobWs.ws.waitFor(
      "online_users",
      (message) => message.users.length === 2 && message.users.every((user) => user.roomId === roomId),
    );
    assert.equal(bobOnline.users.every((user) => user.roomName === "同步房"), true);
    assert.equal(session.hub.getRoomCounts().get(roomId), 2);
    assert.ok(session.hub.getPeakOnline() >= 2);
  }),
);

test("leave_room 清理 presence 并广播，之后可重新加入", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "离开房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);
    await aliceWs.ws.waitFor("peer_joined", (message) => message.peer.userId === bob.userId);

    bobWs.ws.send({ t: "leave_room" });
    const roomLeft = await bobWs.ws.waitFor("room_left");
    assert.equal(roomLeft.reason, undefined);
    await aliceWs.ws.waitFor("peer_left", (message) => message.userId === bob.userId);
    assert.equal(session.hub.getRoomIdForUser(bob.userId), null);
    assert.equal(session.hub.getRoomCounts().get(roomId), 1);

    // 仍在连接中，可重新加入
    bobWs.ws.send({ t: "join_room", roomId });
    await bobWs.ws.waitFor("room_joined", (message) => message.snapshot.room.userCount === 2);
    await aliceWs.ws.waitFor("peer_joined", (message) => message.peer.userId === bob.userId);
    assert.equal(session.hub.getRoomIdForUser(bob.userId), roomId);
  }),
);

// ============================================================
// 3. 入房校验
// ============================================================

test("房间密码：缺少密码 / 密码错误 / 正确密码", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "密码房", password: "secret123" });
    const bob = await session.registerUser("bob");
    const bobWs = await session.connectWithHello(bob.client);

    bobWs.ws.send({ t: "join_room", roomId });
    const required = await bobWs.ws.waitFor("error", (message) => message.request === "join_room");
    assert.equal(required.code, "room_password_required");

    bobWs.ws.send({ t: "join_room", roomId, password: "wrong-password" });
    const invalid = await bobWs.ws.waitFor("error", (message) => message.request === "join_room");
    assert.equal(invalid.code, "room_password_invalid");

    const joined = await joinRoom(bobWs.ws, roomId, "secret123");
    assert.equal(joined.snapshot.room.id, roomId);
  }),
);

test("房间容量已满时返回 room_full", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "一人房", maxUsers: 1 });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);

    bobWs.ws.send({ t: "join_room", roomId });
    const error = await bobWs.ws.waitFor("error", (message) => message.request === "join_room");
    assert.equal(error.code, "room_full");
    assert.equal(session.hub.getRoomIdForUser(bob.userId), null);
    assert.equal(session.hub.getRoomCounts().get(roomId), 1);
  }),
);

test("锁定房间返回 room_locked", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "锁门房", locked: true });
    const bob = await session.registerUser("bob");
    const bobWs = await session.connectWithHello(bob.client);

    bobWs.ws.send({ t: "join_room", roomId });
    const error = await bobWs.ws.waitFor("error", (message) => message.request === "join_room");
    assert.equal(error.code, "room_locked");
  }),
);

// ============================================================
// 4. 聊天
// ============================================================

test("聊天消息广播给全房间并持久化，超长消息被拒绝", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "聊天房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);

    const content = "大家好，我是 bob！";
    bobWs.ws.send({ t: "chat", content });
    const bobChat = await bobWs.ws.waitFor("chat_message", (message) => message.message.content === content);
    assert.equal(bobChat.message.userId, bob.userId);
    assert.equal(bobChat.message.roomId, roomId);
    assert.equal(bobChat.message.kind, "text");

    const aliceChat = await aliceWs.ws.waitFor("chat_message", (message) => message.message.content === content);
    assert.equal(aliceChat.message.senderName, "bob");

    const history = await bob.client.get<{ messages: { content: string; userId: number | null }[] }>(
      "/api/rooms/" + roomId + "/messages",
    );
    assert.equal(history.status, 200);
    assert.equal(
      history.body.messages.some((message) => message.content === content && message.userId === bob.userId),
      true,
    );

    const maxChatLength = session.ctx.services.settings.get().maxChatLength;
    aliceWs.ws.send({ t: "chat", content: "x".repeat(maxChatLength + 1) });
    const tooLong = await aliceWs.ws.waitFor("error", (message) => message.request === "chat");
    assert.equal(tooLong.code, "chat_too_long");
  }),
);

test("聊天限流：超过 5 条/5 秒返回 rate_limited", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "限流房" });
    const alice = await session.registerUser("alice");
    const aliceWs = await session.connectWithHello(alice.client);
    await joinRoom(aliceWs.ws, roomId);

    for (let index = 0; index < 6; index += 1) {
      aliceWs.ws.send({ t: "chat", content: "消息 " + index });
    }
    const error = await aliceWs.ws.waitFor("error", (message) => message.request === "chat");
    assert.equal(error.code, "rate_limited");
  }),
);

// ============================================================
// 5. 信令 / 状态 / 屏幕共享
// ============================================================

test("WebRTC 信令只转发给同房间用户", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "信令房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);

    const offer: SignalPayload = { kind: "offer", sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n" };
    aliceWs.ws.send({ t: "signal", to: bob.userId, payload: offer });
    const signal = await bobWs.ws.waitFor("signal");
    assert.equal(signal.from, alice.userId);
    assert.deepEqual(signal.payload, offer);

    // 目标不存在 / 不同房间
    aliceWs.ws.send({ t: "signal", to: 999_999, payload: offer });
    const notFound = await aliceWs.ws.waitFor("error", (message) => message.request === "signal");
    assert.equal(notFound.code, "peer_not_found");

    const otherRoomId = await session.createRoom({ name: "另一个信令房" });
    const charlie = await session.registerUser("charlie");
    const charlieWs = await session.connectWithHello(charlie.client);
    await joinRoom(charlieWs.ws, otherRoomId);
    aliceWs.ws.send({ t: "signal", to: charlie.userId, payload: offer });
    const crossRoom = await aliceWs.ws.waitFor("error", (message) => message.request === "signal");
    assert.equal(crossRoom.code, "peer_not_found");
  }),
);

test("state 广播：A 静音后同房间 B 收到 peer_state", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "状态房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);

    aliceWs.ws.send({ t: "state", state: { muted: true, deafened: true, speaking: false } });
    const state = await bobWs.ws.waitFor(
      "peer_state",
      (message) => message.userId === alice.userId && message.state.muted === true,
    );
    assert.equal(state.roomId, roomId);
    assert.equal(state.state.deafened, true);
  }),
);

test("屏幕共享互斥：第二人开启返回 screen_share_busy，快照包含共享者", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "共享房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const charlie = await session.registerUser("charlie");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);

    aliceWs.ws.send({ t: "screen_share", active: true });
    await bobWs.ws.waitFor(
      "peer_state",
      (message) => message.userId === alice.userId && message.state.screenSharing === true,
    );
    await bobWs.ws.waitFor("notice", (message) => message.text.includes("共享"));

    // 新加入者快照中能看到当前共享者
    const charlieWs = await session.connectWithHello(charlie.client);
    const joined = await joinRoom(charlieWs.ws, roomId);
    assert.equal(joined.snapshot.screenSharerId, alice.userId);

    bobWs.ws.send({ t: "screen_share", active: true });
    const busy = await bobWs.ws.waitFor("error", (message) => message.request === "screen_share");
    assert.equal(busy.code, "screen_share_busy");

    aliceWs.ws.send({ t: "screen_share", active: false });
    await bobWs.ws.waitFor(
      "peer_state",
      (message) => message.userId === alice.userId && message.state.screenSharing === false,
    );
  }),
);

// ============================================================
// 6. 管理动作（REST 接口 -> HubLike）
// ============================================================

test("REST 踢出服务器：被踢者收到 kicked 并关闭 4003，房间其他人收到 peer_left", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "踢人房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);
    await aliceWs.ws.waitFor("peer_joined", (message) => message.peer.userId === bob.userId);

    const result = await session.admin.post("/api/admin/users/" + bob.userId + "/kick", {
      scope: "server",
      reason: "测试踢出",
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));

    const kicked = await bobWs.ws.waitFor("kicked");
    assert.equal(kicked.scope, "server");
    assert.equal(kicked.reason, "测试踢出");
    const close = await bobWs.ws.waitForClose();
    assert.equal(close.code, WS_CLOSE_CODES.kicked);

    await aliceWs.ws.waitFor("peer_left", (message) => message.userId === bob.userId);
    await waitUntil(() => !session.hub.isOnline(bob.userId), "bob 离线");
    assert.equal(session.hub.getRoomIdForUser(alice.userId), roomId);
  }),
);

test("REST 踢出房间：目标留在连接中但离开房间", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "请出房间" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);
    await aliceWs.ws.waitFor("peer_joined", (message) => message.peer.userId === bob.userId);

    const result = await session.admin.post("/api/admin/users/" + bob.userId + "/kick", {
      scope: "room",
      reason: "请先离开",
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));

    const kicked = await bobWs.ws.waitFor("kicked");
    assert.equal(kicked.scope, "room");
    await bobWs.ws.waitFor("room_left", (message) => message.reason === "请先离开");
    await aliceWs.ws.waitFor("peer_left", (message) => message.userId === bob.userId);
    assert.equal(session.hub.isOnline(bob.userId), true);
    assert.equal(session.hub.getRoomIdForUser(bob.userId), null);

    bobWs.ws.send({ t: "ping", ts: 11 });
    const pong = await bobWs.ws.waitFor("pong");
    assert.equal(pong.ts, 11);
  }),
);

test("REST 强制静音：目标收到 force_muted，房间收到 peer_state，且不能自行解除", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "静音房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);

    const muteResult = await session.admin.post("/api/admin/users/" + bob.userId + "/mute", {
      muted: true,
      reason: "太吵了",
    });
    assert.equal(muteResult.status, 200, JSON.stringify(muteResult.body));

    const forceMuted = await bobWs.ws.waitFor("force_muted");
    assert.equal(forceMuted.muted, true);
    assert.equal(forceMuted.reason, "太吵了");
    await bobWs.ws.waitFor("notice", (message) => message.text.includes("强制静音"));
    await aliceWs.ws.waitFor(
      "peer_state",
      (message) =>
        message.userId === bob.userId && message.state.forceMuted === true && message.state.muted === true,
    );

    // 用户自行解除静音会被忽略
    bobWs.ws.send({ t: "state", state: { muted: false } });
    await sleep(150);
    assert.equal(
      session.hub.getOnlineUsers().find((user) => user.userId === bob.userId)?.muted,
      true,
    );

    const unmuteResult = await session.admin.post("/api/admin/users/" + bob.userId + "/mute", { muted: false });
    assert.equal(unmuteResult.status, 200, JSON.stringify(unmuteResult.body));
    const unmuted = await bobWs.ws.waitFor("force_muted");
    assert.equal(unmuted.muted, false);
    await aliceWs.ws.waitFor(
      "peer_state",
      (message) => message.userId === bob.userId && message.state.forceMuted === false,
    );
  }),
);

test("REST 移动用户：目标收到 room_left + room_joined，旧/新房间成员同步", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomA = await session.createRoom({ name: "房间 A" });
    const roomB = await session.createRoom({ name: "房间 B" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomA);
    await joinRoom(bobWs.ws, roomB);

    const result = await session.admin.post("/api/admin/users/" + bob.userId + "/move", { roomId: roomA });
    assert.equal(result.status, 200, JSON.stringify(result.body));

    await bobWs.ws.waitFor("room_left");
    const joined = await bobWs.ws.waitFor(
      "room_joined",
      (message) => message.snapshot.room.id === roomA,
    );
    assert.equal(joined.snapshot.room.id, roomA);
    await aliceWs.ws.waitFor("peer_joined", (message) => message.peer.userId === bob.userId);
    assert.equal(session.hub.getRoomIdForUser(bob.userId), roomA);

    // 移动到大厅
    const toLobby = await session.admin.post("/api/admin/users/" + bob.userId + "/move", { roomId: null });
    assert.equal(toLobby.status, 200, JSON.stringify(toLobby.body));
    await bobWs.ws.waitFor("room_left");
    await waitUntil(() => session.hub.getRoomIdForUser(bob.userId) === null, "bob 回到大厅");
  }),
);

test("REST 删除房间：房间内用户收到 room_deleted + room_left", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "待删除房" });
    const alice = await session.registerUser("alice");
    const aliceWs = await session.connectWithHello(alice.client);
    await joinRoom(aliceWs.ws, roomId);

    const result = await session.admin.del("/api/rooms/" + roomId);
    assert.equal(result.status, 200, JSON.stringify(result.body));

    const deleted = await aliceWs.ws.waitFor("room_deleted");
    assert.equal(deleted.roomId, roomId);
    await aliceWs.ws.waitFor("room_left", (message) => message.reason?.includes("删除") === true);
    await waitUntil(() => session.hub.getRoomIdForUser(alice.userId) === null, "用户被移出已删除房间");

    const rooms = await alice.client.get<{ rooms: { id: number }[] }>("/api/rooms");
    assert.equal(rooms.body.rooms.some((room) => room.id === roomId), false);
  }),
);

// ============================================================
// 7. 封禁 / 会话
// ============================================================

test("封禁：在线用户被断开（session_ended + 4004），被封禁账号的新连接被拒绝（4003）", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const alice = await session.registerUser("alice");
    const aliceWs = await session.connectWithHello(alice.client);

    const banResult = await session.admin.post("/api/admin/bans", {
      userId: alice.userId,
      reason: "测试封禁",
    });
    assert.equal(banResult.status, 200, JSON.stringify(banResult.body));

    const ended = await aliceWs.ws.waitFor("session_ended");
    assert.match(ended.reason, /封禁/);
    const close = await aliceWs.ws.waitForClose();
    assert.equal(close.code, WS_CLOSE_CODES.session_ended);

    const retry = await session.connect(alice.client);
    const retryClose = await retry.waitForClose();
    assert.equal(retryClose.code, 4003);
    assert.match(retryClose.reason, /封禁/);
  }),
);

// ============================================================
// 8. 非法消息 / 快照 / 心跳
// ============================================================

test("非法消息返回 bad_request，未入房聊天返回 not_in_room", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const alice = await session.registerUser("alice");
    const { ws } = await session.connectWithHello(alice.client);

    ws.sendRaw("这不是 JSON");
    const badJson = await ws.waitFor("error");
    assert.equal(badJson.code, "bad_request");

    ws.sendRaw(JSON.stringify({ t: "unknown_type" }));
    const unknownType = await ws.waitFor("error");
    assert.equal(unknownType.code, "bad_request");

    ws.sendRaw(JSON.stringify({ t: "state", state: { muted: "yes" } }));
    const badState = await ws.waitFor("error");
    assert.equal(badState.code, "bad_request");

    ws.sendRaw(JSON.stringify({ t: "signal", to: "not-a-number", payload: { kind: "offer", sdp: "x" } }));
    const badSignal = await ws.waitFor("error");
    assert.equal(badSignal.code, "bad_request");

    ws.send({ t: "chat", content: "大家好" });
    const notInRoom = await ws.waitFor("error", (message) => message.request === "chat");
    assert.equal(notInRoom.code, "not_in_room");
  }),
);

test("request_rooms / request_online_users 返回即时快照", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "快照房" });
    const alice = await session.registerUser("alice");
    const { ws } = await session.connectWithHello(alice.client);
    await joinRoom(ws, roomId);

    ws.send({ t: "request_rooms" });
    const rooms = await ws.waitFor("rooms", (message) =>
      message.rooms.some((room) => room.id === roomId && room.userCount === 1),
    );
    assert.equal(rooms.rooms.find((room) => room.id === roomId)?.userCount, 1);

    ws.send({ t: "request_online_users" });
    const online = await ws.waitFor("online_users", (message) =>
      message.users.some((user) => user.userId === alice.userId && user.roomId === roomId),
    );
    assert.equal(online.users.length, 1);
  }),
);

test("心跳：应用层 ping 返回 pong，服务端发送 ping，两次无响应后断开", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const alice = await session.registerUser("alice");
    const { ws } = await session.connectWithHello(alice.client);

    ws.send({ t: "ping", ts: 1729 });
    const pong = await ws.waitFor("pong");
    assert.equal(pong.ts, 1729);

    // 服务端按 WS_HEARTBEAT_INTERVAL_MS 发送协议层 ping
    await ws.waitForServerPing();

    // 不响应 pong 的客户端会被 terminate（1006）
    const bob = await session.registerUser("bob");
    const silent = await session.connect(bob.client, { autoPong: false });
    await silent.waitFor("hello");
    const close = await silent.waitForClose();
    assert.equal(close.code, 1006);
    await waitUntil(() => !session.hub.isOnline(bob.userId), "无响应连接已被清理");
    assert.equal(session.hub.isOnline(alice.userId), true);
  }),
);

// ============================================================
// 9. 配置更新与资料刷新广播
// ============================================================

test("房间配置更新广播 room_updated，用户资料更新广播 peer_updated", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "旧名字" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);

    const updated = await session.admin.patch("/api/rooms/" + roomId, { name: "新名字" });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    const roomUpdated = await bobWs.ws.waitFor("room_updated", (message) => message.room.name === "新名字");
    assert.equal(roomUpdated.room.id, roomId);

    const profile = await alice.client.patch("/api/users/me", { displayName: "爱丽丝" });
    assert.equal(profile.status, 200, JSON.stringify(profile.body));
    const peerUpdated = await bobWs.ws.waitFor(
      "peer_updated",
      (message) => message.peer.userId === alice.userId && message.peer.displayName === "爱丽丝",
    );
    assert.equal(peerUpdated.roomId, roomId);
    await bobWs.ws.waitFor(
      "online_users",
      (message) => message.users.some((user) => user.userId === alice.userId && user.displayName === "爱丽丝"),
    );

    const settingsUpdate = await session.admin.patch("/api/admin/settings", { name: "实时测试服务器" });
    assert.equal(settingsUpdate.status, 200, JSON.stringify(settingsUpdate.body));
    const serverSettings = await bobWs.ws.waitFor(
      "server_settings",
      (message) => message.server.name === "实时测试服务器",
    );
    assert.equal(serverSettings.server.name, "实时测试服务器");
  }),
);

// ============================================================
// 10. 更多边界：满员 / 切换房间 / 开关 / 限流 / shutdown
// ============================================================

test("服务器满员：新连接被拒绝（4003），入房返回 server_full", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "满员测试房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const charlie = await session.registerUser("charlie");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);

    // 管理员调低服务器人数上限：已在线用户入房被 server_full 拒绝
    session.ctx.services.settings.update({ maxUsers: 1 });
    bobWs.ws.send({ t: "join_room", roomId });
    const joinError = await bobWs.ws.waitFor("error", (message) => message.request === "join_room");
    assert.equal(joinError.code, "server_full");

    // 新连接被拒绝并关闭 4003
    const charlieWs = await session.connect(charlie.client);
    const close = await charlieWs.waitForClose();
    assert.equal(close.code, 4003);
    assert.match(close.reason, /人数已满/);
  }),
);

test("切换房间：先离开旧房间并广播，再加入新房间", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomA = await session.createRoom({ name: "切换 A" });
    const roomB = await session.createRoom({ name: "切换 B" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const charlie = await session.registerUser("charlie");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    const charlieWs = await session.connectWithHello(charlie.client);
    await joinRoom(aliceWs.ws, roomA);
    await joinRoom(bobWs.ws, roomA);
    await joinRoom(charlieWs.ws, roomB);
    await aliceWs.ws.waitFor("peer_joined", (message) => message.peer.userId === bob.userId);

    aliceWs.ws.send({ t: "join_room", roomId: roomB });
    const roomLeft = await aliceWs.ws.waitFor("room_left", (message) => message.reason === "切换房间");
    assert.equal(roomLeft.reason, "切换房间");
    const joined = await aliceWs.ws.waitFor("room_joined", (message) => message.snapshot.room.id === roomB);
    assert.ok(joined.snapshot.peers.some((peer) => peer.userId === charlie.userId));

    await bobWs.ws.waitFor("peer_left", (message) => message.userId === alice.userId);
    await charlieWs.ws.waitFor("peer_joined", (message) => message.peer.userId === alice.userId);
    assert.equal(session.hub.getRoomIdForUser(alice.userId), roomB);
    assert.equal(session.hub.getRoomCounts().get(roomA), 1);
    assert.equal(session.hub.getRoomCounts().get(roomB), 2);
  }),
);

test("聊天开关：关闭游客聊天或全局文字聊天返回 chat_disabled", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "聊天开关房" });
    const alice = await session.registerUser("alice");
    const guestClient = session.ctx.newClient();
    const guestLogin = await guestClient.guest("游客小张");
    assert.equal(guestLogin.status, 200, JSON.stringify(guestLogin.body));
    const guestUserId = guestLogin.body.user.id;
    const aliceWs = await session.connectWithHello(alice.client);
    const guestWs = await session.connectWithHello(guestClient);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(guestWs.ws, roomId);

    // 默认允许游客聊天
    guestWs.ws.send({ t: "chat", content: "游客消息" });
    await guestWs.ws.waitFor(
      "chat_message",
      (message) => message.message.content === "游客消息" && message.message.userId === guestUserId,
    );

    // 关闭游客聊天
    session.ctx.services.settings.update({ allowGuestChat: false });
    guestWs.ws.send({ t: "chat", content: "再来一条" });
    const guestDenied = await guestWs.ws.waitFor("error", (message) => message.request === "chat");
    assert.equal(guestDenied.code, "chat_disabled");

    // 关闭全局文字聊天
    session.ctx.services.settings.update({ allowTextChat: false });
    aliceWs.ws.send({ t: "chat", content: "管理消息" });
    const textDenied = await aliceWs.ws.waitFor("error", (message) => message.request === "chat");
    assert.equal(textDenied.code, "chat_disabled");
  }),
);

test("服务器关闭屏幕共享时返回 screen_share_disabled", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "禁用共享房" });
    const alice = await session.registerUser("alice");
    const aliceWs = await session.connectWithHello(alice.client);
    await joinRoom(aliceWs.ws, roomId);
    session.ctx.services.settings.update({ allowScreenShare: false });
    aliceWs.ws.send({ t: "screen_share", active: true });
    const error = await aliceWs.ws.waitFor("error", (message) => message.request === "screen_share");
    assert.equal(error.code, "screen_share_disabled");
  }),
);

test("信令限流：每连接 120 条/10 秒，超出返回 rate_limited", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const roomId = await session.createRoom({ name: "信令限流房" });
    const alice = await session.registerUser("alice");
    const bob = await session.registerUser("bob");
    const aliceWs = await session.connectWithHello(alice.client);
    const bobWs = await session.connectWithHello(bob.client);
    await joinRoom(aliceWs.ws, roomId);
    await joinRoom(bobWs.ws, roomId);

    const payload: SignalPayload = { kind: "offer", sdp: "v=0" };
    for (let index = 0; index < 121; index += 1) {
      aliceWs.ws.send({ t: "signal", to: bob.userId, payload });
    }
    const error = await aliceWs.ws.waitFor("error", (message) => message.request === "signal");
    assert.equal(error.code, "rate_limited");
  }),
);

test("超大消息由协议层拒绝，服务器继续可用", TEST_OPTIONS, () =>
  withSession(async (session) => {
    const alice = await session.registerUser("alice");
    const { ws } = await session.connectWithHello(alice.client);
    ws.sendRaw(JSON.stringify({ t: "chat", content: "x".repeat(300 * 1024) }));
    const close = await ws.waitForClose();
    assert.ok(close.code === 1009 || close.code === 1006, "关闭码应为 1009/1006，实际: " + close.code);

    const next = await session.registerUser("alice2");
    const second = await session.connectWithHello(next.client);
    assert.equal(second.hello.user.id, next.userId);
  }),
);

test("shutdown 通知所有连接 close 1001 并清空在线状态", TEST_OPTIONS, async () => {
  const session = await Session.create();
  try {
    const alice = await session.registerUser("alice");
    const { ws } = await session.connectWithHello(alice.client);
    session.hub.shutdown();
    const close = await ws.waitForClose();
    assert.equal(close.code, WS_CLOSE_CODES.shutdown);
    assert.equal(session.hub.getOnlineCount(), 0);
    assert.deepEqual(session.hub.getOnlineUsers(), []);
  } finally {
    await session.close();
  }
});


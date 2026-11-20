import test from "node:test";
import assert from "node:assert/strict";
import { TokenVerifier } from "livekit-server-sdk";
import {
  LIVEKIT_ROOM_PREFIX,
  LIVEKIT_TOKEN_TTL_SECONDS,
  MEDIA_TRANSPORT,
  type LivekitTokenResponse,
  type ServerSettings,
  type ServerSettingsPublic,
} from "@airmic/shared";
import { createTestContext, type TestClient, type TestContext, type WsMessageQueue } from "./helpers.js";

const TEST_OPTIONS = { timeout: 30_000 } as const;

/** 测试用 LiveKit 开发配置（与本地 livekit-server --dev 的 devkey/secret 一致） */
const LIVEKIT = {
  livekitUrl: "ws://127.0.0.1:7880",
  livekitApiKey: "devkey",
  livekitApiSecret: "secret",
} as const;

interface ServerInfoBody {
  server: ServerSettingsPublic;
  setupRequired: boolean;
  version: string;
}

interface RoomCreateBody {
  room: { id: number; name: string; maxUsers: number };
}

/** 通过 WebSocket 加入房间，模拟真实客户端流程（先 /ws 入房，再换语音令牌） */
async function joinVoiceRoom(ctx: TestContext, client: TestClient, roomId: number): Promise<WsMessageQueue> {
  const ws = await ctx.connectWs(client);
  await ws.waitFor("hello");
  ws.send({ t: "join_room", roomId });
  await ws.waitFor("room_joined");
  return ws;
}

// ============================================================
// 配置与服务端公开信息
// ============================================================

test("默认未配置 LiveKit：voiceAvailable=false、livekitUrl=null，房间人数继承 SFU 推荐值 100", TEST_OPTIONS, async () => {
  const ctx = await createTestContext({ livekitUrl: null, livekitApiKey: null, livekitApiSecret: null });
  try {
    const info = await ctx.newClient().get<ServerInfoBody>("/api/server");
    assert.equal(info.status, 200);
    assert.equal(info.body.server.voiceAvailable, false);
    assert.equal(info.body.server.livekitUrl, null);
    assert.equal(info.body.server.mediaTransport, MEDIA_TRANSPORT);
    assert.equal(info.body.server.mediaTransport, "sfu");
    assert.equal(info.body.server.maxUsersPerRoom, 100);
    assert.equal(info.body.server.maxUsers, 500);

    // 创建房间时 maxUsers=0 表示继承服务器设置（100），不再受 P2P 的 10 人限制
    const admin = await ctx.registerUser("admin");
    const created = await admin.post<RoomCreateBody>("/api/rooms", { name: "默认容量房", maxUsers: 0 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.room.maxUsers, 100);

    const rooms = await admin.get<{ rooms: { id: number; maxUsers: number }[] }>("/api/rooms");
    assert.equal(rooms.body.rooms.find((room) => room.id === created.body.room.id)?.maxUsers, 100);
  } finally {
    await ctx.close();
  }
});

test("LiveKit 环境配置生效：/api/server 暴露连接地址且 voiceAvailable=true（不泄露密钥）", TEST_OPTIONS, async () => {
  const ctx = await createTestContext(LIVEKIT);
  try {
    const info = await ctx.newClient().get<ServerInfoBody>("/api/server");
    assert.equal(info.status, 200);
    assert.equal(info.body.server.voiceAvailable, true);
    assert.equal(info.body.server.livekitUrl, LIVEKIT.livekitUrl);
    assert.equal(info.body.server.mediaTransport, "sfu");

    // 公开设置绝不能包含 API Key/Secret
    const raw = info.body.server as unknown as Record<string, unknown>;
    assert.equal(raw.livekitApiKey, undefined);
    assert.equal(raw.livekitApiSecret, undefined);

    assert.equal(ctx.services.settings.isVoiceAvailable(), true);
    assert.deepEqual(ctx.services.settings.getLivekitCredentials(), {
      url: LIVEKIT.livekitUrl,
      apiKey: LIVEKIT.livekitApiKey,
      apiSecret: LIVEKIT.livekitApiSecret,
    });
  } finally {
    await ctx.close();
  }
});

test("管理员 PATCH 设置可修改/清空 LiveKit 配置，显式清空优先于环境变量", TEST_OPTIONS, async () => {
  const ctx = await createTestContext(LIVEKIT);
  try {
    const admin = await ctx.registerUser("admin");

    // 初始来自环境变量兜底
    let info = await admin.get<ServerInfoBody>("/api/server");
    assert.equal(info.body.server.voiceAvailable, true);
    assert.equal(info.body.server.livekitUrl, LIVEKIT.livekitUrl);

    // 修改三项配置
    const patched = await admin.patch<{ settings: ServerSettings }>("/api/admin/settings", {
      livekitUrl: "ws://127.0.0.1:7881",
      livekitApiKey: "new-key",
      livekitApiSecret: "new-secret",
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.settings.voiceAvailable, true);
    assert.equal(patched.body.settings.livekitUrl, "ws://127.0.0.1:7881");
    assert.equal(patched.body.settings.livekitApiKey, "new-key");
    assert.equal(patched.body.settings.livekitApiSecret, "new-secret");
    assert.equal(patched.body.settings.mediaTransport, "sfu");
    assert.deepEqual(ctx.services.settings.getLivekitCredentials(), {
      url: "ws://127.0.0.1:7881",
      apiKey: "new-key",
      apiSecret: "new-secret",
    });

    info = await admin.get<ServerInfoBody>("/api/server");
    assert.equal(info.body.server.livekitUrl, "ws://127.0.0.1:7881");
    assert.equal(info.body.server.voiceAvailable, true);

    // 显式清空：即使环境变量里仍有配置，也应该保持"未配置"
    const cleared = await admin.patch<{ settings: ServerSettings }>("/api/admin/settings", {
      livekitUrl: "",
      livekitApiKey: "",
      livekitApiSecret: "",
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.settings.voiceAvailable, false);
    assert.equal(cleared.body.settings.livekitUrl, null);
    assert.equal(cleared.body.settings.livekitApiKey, null);
    assert.equal(cleared.body.settings.livekitApiSecret, null);

    info = await admin.get<ServerInfoBody>("/api/server");
    assert.equal(info.body.server.voiceAvailable, false);
    assert.equal(info.body.server.livekitUrl, null);
    assert.equal(ctx.services.settings.isVoiceAvailable(), false);
  } finally {
    await ctx.close();
  }
});

test("房间人数上限可通过管理设置放宽到 500（超过上限被拒绝）", TEST_OPTIONS, async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("admin");
    const created = await admin.post<RoomCreateBody>("/api/rooms", { name: "容量房", maxUsers: 0 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const roomId = created.body.room.id;
    assert.equal(created.body.room.maxUsers, 100);

    const widened = await admin.patch<{ settings: ServerSettings }>("/api/admin/settings", { maxUsersPerRoom: 500 });
    assert.equal(widened.status, 200, JSON.stringify(widened.body));
    assert.equal(widened.body.settings.maxUsersPerRoom, 500);

    const rooms = await admin.get<{ rooms: { id: number; maxUsers: number }[] }>("/api/rooms");
    assert.equal(rooms.body.rooms.find((room) => room.id === roomId)?.maxUsers, 500);

    // 超过 500 被拒绝
    assert.equal((await admin.patch("/api/admin/settings", { maxUsersPerRoom: 501 })).status, 400);
    assert.equal((await admin.patch("/api/admin/settings", { maxUsersPerRoom: 0 })).status, 400);
  } finally {
    await ctx.close();
  }
});

// ============================================================
// LiveKit 令牌接口
// ============================================================

test("令牌接口：未登录 401、房间不存在 404、未入房 403", TEST_OPTIONS, async () => {
  const ctx = await createTestContext(LIVEKIT);
  try {
    const admin = await ctx.registerUser("admin");
    const created = await admin.post<RoomCreateBody>("/api/rooms", { name: "权限校验房" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const roomId = created.body.room.id;

    const alice = await ctx.registerUser("alice");
    assert.equal((await ctx.newClient().post("/api/rooms/" + roomId + "/livekit-token")).status, 401);

    const notInRoom = await alice.post("/api/rooms/" + roomId + "/livekit-token");
    assert.equal(notInRoom.status, 403);

    const missingRoom = await alice.post("/api/rooms/999999/livekit-token");
    assert.equal(missingRoom.status, 404);

    const invalidRoom = await alice.post("/api/rooms/not-a-number/livekit-token");
    assert.equal(invalidRoom.status, 400);
  } finally {
    await ctx.close();
  }
});

test("令牌接口：入房后返回可校验的 LiveKit 令牌，清空配置后返回 voice_not_configured", TEST_OPTIONS, async () => {
  const ctx = await createTestContext(LIVEKIT);
  try {
    const admin = await ctx.registerUser("admin");
    const created = await admin.post<RoomCreateBody>("/api/rooms", { name: "语音令牌房" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const roomId = created.body.room.id;
    const otherRoom = await admin.post<RoomCreateBody>("/api/rooms", { name: "另一个语音房" });
    assert.equal(otherRoom.status, 200, JSON.stringify(otherRoom.body));
    const otherRoomId = otherRoom.body.room.id;

    const alice = await ctx.registerUser("alice", "password123", "爱丽丝");
    const me = await alice.get<{ user: { id: number; displayName: string } }>("/api/auth/me");
    assert.equal(me.status, 200);
    const aliceId = me.body.user.id;

    const ws = await joinVoiceRoom(ctx, alice, roomId);
    try {
      // 请求其他房间的令牌（已加入的不是该房间）
      assert.equal((await alice.post("/api/rooms/" + otherRoomId + "/livekit-token")).status, 403);

      const res = await alice.post<LivekitTokenResponse>("/api/rooms/" + roomId + "/livekit-token");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.url, LIVEKIT.livekitUrl);
      assert.equal(res.body.room, LIVEKIT_ROOM_PREFIX + roomId);
      assert.equal(res.body.identity, String(aliceId));

      // 用 LiveKit 官方 SDK 校验令牌声明
      const verifier = new TokenVerifier(LIVEKIT.livekitApiKey, LIVEKIT.livekitApiSecret);
      const claims = await verifier.verify(res.body.token);
      assert.equal(claims.sub, String(aliceId));
      assert.equal(claims.name, "爱丽丝");
      assert.equal(claims.video?.room, LIVEKIT_ROOM_PREFIX + roomId);
      assert.equal(claims.video?.roomJoin, true);
      assert.equal(claims.video?.canPublish, true);
      assert.equal(claims.video?.canSubscribe, true);
      assert.equal(claims.video?.canPublishData, false);

      assert.equal(typeof claims.metadata, "string");
      const metadata = JSON.parse(claims.metadata as string) as {
        userId: number;
        role: string;
        avatarColor: string;
        avatarEmoji: string | null;
        isGuest: boolean;
      };
      assert.equal(metadata.userId, aliceId);
      assert.equal(metadata.role, "user");
      assert.equal(metadata.isGuest, false);
      assert.equal(typeof metadata.avatarColor, "string");

      assert.equal(typeof claims.exp, "number");
      const remaining = Number(claims.exp) - Math.floor(Date.now() / 1000);
      assert.ok(
        remaining > LIVEKIT_TOKEN_TTL_SECONDS - 120 && remaining <= LIVEKIT_TOKEN_TTL_SECONDS,
        "令牌有效期应约为 " + LIVEKIT_TOKEN_TTL_SECONDS + " 秒，实际剩余 " + remaining,
      );

      // 清空配置后接口返回 400 voice_not_configured
      const cleared = await admin.patch("/api/admin/settings", { livekitUrl: "", livekitApiKey: "", livekitApiSecret: "" });
      assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
      const notConfigured = await alice.post<{ error: { code: string; message: string } }>(
        "/api/rooms/" + roomId + "/livekit-token",
      );
      assert.equal(notConfigured.status, 400);
      assert.equal(notConfigured.body.error.code, "voice_not_configured");
      assert.match(notConfigured.body.error.message, /LiveKit/);
    } finally {
      ws.close();
    }
  } finally {
    await ctx.close();
  }
});

test("LiveKit 配置不完整时视为未配置：房间内也无法换取令牌", TEST_OPTIONS, async () => {
  // 只配置地址、缺少 key/secret
  const ctx = await createTestContext({ livekitUrl: "ws://127.0.0.1:7880" });
  try {
    const info = await ctx.newClient().get<ServerInfoBody>("/api/server");
    assert.equal(info.body.server.voiceAvailable, false);
    assert.equal(info.body.server.livekitUrl, "ws://127.0.0.1:7880");
    assert.equal(ctx.services.settings.isVoiceAvailable(), false);

    const admin = await ctx.registerUser("admin");
    const created = await admin.post<RoomCreateBody>("/api/rooms", { name: "未配置语音房" });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const roomId = created.body.room.id;

    const alice = await ctx.registerUser("alice");
    const ws = await joinVoiceRoom(ctx, alice, roomId);
    try {
      const res = await alice.post<{ error: { code: string; message: string } }>(
        "/api/rooms/" + roomId + "/livekit-token",
      );
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "voice_not_configured");
    } finally {
      ws.close();
    }
  } finally {
    await ctx.close();
  }
});

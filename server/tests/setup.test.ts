import test from "node:test";
import assert from "node:assert/strict";
import { createTestContext } from "./helpers.js";

interface SetupStatus {
  setupRequired: boolean;
  requiresToken: boolean;
  server: { name: string };
}

test("初始化状态：全新部署需要初始化", async () => {
  const ctx = await createTestContext();
  try {
    const client = ctx.newClient();
    const status = await client.get<SetupStatus>("/api/setup/status");
    assert.equal(status.status, 200);
    assert.equal(status.body.setupRequired, true);
    assert.equal(status.body.requiresToken, false);

    const info = await client.get<{ setupRequired: boolean; server: { voiceAvailable: boolean } }>("/api/server");
    assert.equal(info.body.setupRequired, true);
    assert.equal(info.body.server.voiceAvailable, false);
    assert.equal((info.body.server as unknown as Record<string, unknown>).livekitUrl, undefined);
  } finally {
    await ctx.close();
  }
});

test("初始化：创建管理员、应用服务器设置并创建默认房间", async () => {
  const ctx = await createTestContext();
  try {
    const client = ctx.newClient();
    const result = await client.post<{
      user: { id: number; username: string; role: string; permissions: string[] };
      server: { name: string; motd: string; registrationMode: string; maxUsersPerRoom: number };
      rooms: { id: number; name: string }[];
    }>("/api/setup/initialize", {
      admin: { username: "root_admin", password: "password123", displayName: "服务器主人" },
      server: {
        name: "测试语音基地",
        motd: "欢迎来到测试服",
        registrationMode: "open",
        guestEnabled: true,
        maxUsersPerRoom: 120,
        defaultAudioSettings: { preset: "music" },
        livekitUrl: "ws://127.0.0.1:7880",
        livekitApiKey: "devkey",
        livekitApiSecret: "secret",
      },
      createDefaultRooms: true,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.user.role, "admin");
    assert.ok(result.body.user.permissions.includes("manage_server"));
    assert.equal(result.body.server.name, "测试语音基地");
    assert.equal(result.body.server.motd, "欢迎来到测试服");
    assert.equal(result.body.server.registrationMode, "open");
    assert.equal(result.body.server.maxUsersPerRoom, 120);
    assert.equal(result.body.rooms.length, 2);
    assert.deepEqual(
      result.body.rooms.map((room) => room.name).sort(),
      ["休息室", "开黑大厅"].sort(),
    );

    // 已自动登录
    const me = await client.get<{ user: { username: string; role: string } }>("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, "root_admin");

    // 初始化完成状态
    const status = await client.get<SetupStatus>("/api/setup/status");
    assert.equal(status.body.setupRequired, false);
    const info = await client.get<{ server: { voiceAvailable: boolean } }>("/api/server");
    assert.equal(info.body.server.voiceAvailable, true);
    // 公开信息不暴露 SFU 连接地址，只有管理员后台可见
    assert.equal((info.body.server as unknown as Record<string, unknown>).livekitUrl, undefined);

    // 重复初始化被拒绝
    const again = await ctx.newClient().post("/api/setup/initialize", {
      admin: { username: "other_admin", password: "password123" },
    });
    assert.equal(again.status, 409);

    // 之后注册的普通用户不是管理员
    const userClient = ctx.newClient();
    const register = await userClient.post<{ user: { role: string } }>("/api/auth/register", {
      username: "normal_user",
      password: "password123",
    });
    assert.equal(register.status, 200);
    assert.equal(register.body.user.role, "user");
  } finally {
    await ctx.close();
  }
});

test("初始化：SETUP_TOKEN 口令保护", async () => {
  const ctx = await createTestContext({ setupToken: "s3cret-setup" });
  try {
    const status = await ctx.newClient().get<SetupStatus>("/api/setup/status");
    assert.equal(status.body.requiresToken, true);

    const missing = await ctx.newClient().post("/api/setup/initialize", {
      admin: { username: "root_admin", password: "password123" },
    });
    assert.equal(missing.status, 403);

    const wrong = await ctx.newClient().post("/api/setup/initialize", {
      token: "wrong-token",
      admin: { username: "root_admin", password: "password123" },
    });
    assert.equal(wrong.status, 403);

    const ok = await ctx.newClient().post<{ user: { role: string } }>("/api/setup/initialize", {
      token: "s3cret-setup",
      admin: { username: "root_admin", password: "password123" },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.role, "admin");
  } finally {
    await ctx.close();
  }
});

test("初始化：参数校验与可选默认房间", async () => {
  const ctx = await createTestContext();
  try {
    const weak = await ctx.newClient().post("/api/setup/initialize", {
      admin: { username: "ab", password: "123" },
    });
    assert.equal(weak.status, 400);

    const noRooms = await ctx.newClient().post<{ rooms: unknown[] }>("/api/setup/initialize", {
      admin: { username: "root_admin", password: "password123" },
      createDefaultRooms: false,
    });
    assert.equal(noRooms.status, 200);
    assert.equal(noRooms.body.rooms.length, 0);
  } finally {
    await ctx.close();
  }
});
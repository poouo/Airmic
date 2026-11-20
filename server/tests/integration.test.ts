import test from "node:test";
import assert from "node:assert/strict";
import { createTestContext } from "./helpers.js";

test("公开接口与首次部署状态", async () => {
  const ctx = await createTestContext();
  try {
    const client = ctx.newClient();
    const health = await client.get<{ status: string; version: string }>("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");

    const serverInfo = await client.get<{ server: { name: string; registrationMode: string; defaultAudioSettings: { bitrate: number } }; setupRequired: boolean }>("/api/server");
    assert.equal(serverInfo.status, 200);
    assert.equal(serverInfo.body.setupRequired, true);
    assert.equal(serverInfo.body.server.registrationMode, "open");
    assert.equal(serverInfo.body.server.defaultAudioSettings.bitrate, 32000);

    const ice = await client.get<{ iceServers: unknown[]; forceRelay: boolean }>("/api/rtc/ice");
    assert.equal(ice.status, 200);
    assert.ok(ice.body.iceServers.length >= 1);

    const rooms = await client.get("/api/rooms");
    assert.equal(rooms.status, 401);
  } finally {
    await ctx.close();
  }
});

test("注册登录与会话生命周期", async () => {
  const ctx = await createTestContext();
  try {
    const admin = ctx.newClient();
    const first = await admin.register("admin1", "password123", "管理员一号");
    assert.equal(first.status, 200);
    assert.equal(first.body.user.role, "admin");
    assert.ok(first.body.user.permissions.includes("manage_server"));

    const me = await admin.get<{ user: { username: string; role: string } }>("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, "admin1");

    // 重复用户名
    const dup = await ctx.newClient().register("Admin1", "password123");
    assert.equal(dup.status, 409);

    // 弱参数
    const bad = await ctx.newClient().post("/api/auth/register", { username: "ab", password: "123" });
    assert.equal(bad.status, 400);

    // 登录错误密码
    const wrong = await ctx.newClient().post("/api/auth/login", { username: "admin1", password: "bad-password" });
    assert.equal(wrong.status, 401);

    // 正常登录第二个客户端
    const second = ctx.newClient();
    const login = await second.post<{ user: { id: number } }>("/api/auth/login", { username: "admin1", password: "password123" });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.id, first.body.user.id);

    // 注销只影响当前会话
    const logout = await second.post("/api/auth/logout");
    assert.equal(logout.status, 200);
    assert.equal((await second.get("/api/auth/me")).status, 401);
    assert.equal((await admin.get("/api/auth/me")).status, 200);

    // 第二个注册用户是普通用户
    const user = await ctx.registerUser("player1", "password123");
    const userMe = await user.get<{ user: { role: string } }>("/api/auth/me");
    assert.equal(userMe.body.user.role, "user");
  } finally {
    await ctx.close();
  }
});

test("游客模式与限制", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("admin1");
    const guest = ctx.newClient();
    const login = await guest.guest("游客小明");
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, "guest");
    assert.equal(login.body.user.isGuest, true);
    assert.ok(!login.body.user.permissions.includes("manage_server"));

    // 游客默认不能创建房间
    const create = await guest.post("/api/rooms", { name: "游客房" });
    assert.equal(create.status, 403);

    // 关闭游客模式后不能再创建游客身份
    ctx.services.settings.update({ guestEnabled: false });
    const denied = await ctx.newClient().guest("另一个游客");
    assert.equal(denied.status, 403);

    // 已登录游客仍可访问房间列表
    assert.equal((await guest.get("/api/rooms")).status, 200);
    void admin;
  } finally {
    await ctx.close();
  }
});

test("房间 CRUD、密码与消息接口", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("admin1");
    const create = await admin.post<{ room: { id: number; name: string; hasPassword: boolean; maxUsers: number } }>("/api/rooms", {
      name: "上分车队",
      description: "排位专用",
      category: "开黑房间",
      password: "secret123",
      maxUsers: 5,
      sortOrder: 3,
    });
    assert.equal(create.status, 200);
    assert.equal(create.body.room.hasPassword, true);
    assert.equal(create.body.room.maxUsers, 5);
    const roomId = create.body.room.id;

    // 重名
    const dup = await admin.post("/api/rooms", { name: "上分车队" });
    assert.equal(dup.status, 409);

    // 列表
    const list = await admin.get<{ rooms: { id: number; userCount: number; hasPassword: boolean }[] }>("/api/rooms");
    assert.equal(list.body.rooms.length, 1);
    assert.equal(list.body.rooms[0]?.hasPassword, true);

    // 密码校验
    const badPassword = await admin.post<{ ok: boolean }>("/api/rooms/" + roomId + "/check-password", { password: "bad" });
    assert.equal(badPassword.body.ok, false);
    const goodPassword = await admin.post<{ ok: boolean }>("/api/rooms/" + roomId + "/check-password", { password: "secret123" });
    assert.equal(goodPassword.body.ok, true);

    // 更新：清空密码、改名、音质覆盖
    const update = await admin.patch<{ room: { name: string; hasPassword: boolean; audioSettings: { bitrate: number; channels: number } } }>(
      "/api/rooms/" + roomId,
      {
        name: "上分车队二队",
        password: null,
        maxUsers: 3,
        audioOverride: { preset: "music" },
      },
    );
    assert.equal(update.status, 200);
    assert.equal(update.body.room.name, "上分车队二队");
    assert.equal(update.body.room.hasPassword, false);
    assert.equal(update.body.room.audioSettings.bitrate, 96000);
    assert.equal(update.body.room.audioSettings.channels, 2);

    // 普通用户无管理权限不能修改他人房间（默认 allowRoomCreation=false）
    const user = await ctx.registerUser("player1");
    const denied = await user.patch("/api/rooms/" + roomId, { name: "hack" });
    assert.equal(denied.status, 403);
    assert.equal((await user.post("/api/rooms", { name: "普通用户的房" })).status, 403);

    // 消息历史为空
    const messages = await admin.get<{ messages: unknown[] }>("/api/rooms/" + roomId + "/messages");
    assert.equal(messages.status, 200);
    assert.deepEqual(messages.body.messages, []);

    // 不存在的房间
    assert.equal((await admin.get("/api/rooms/9999/messages")).status, 404);

    // 删除
    assert.equal((await admin.del("/api/rooms/" + roomId)).status, 200);
    assert.equal((await admin.get<{ rooms: unknown[] }>("/api/rooms")).body.rooms.length, 0);
    assert.equal((await admin.get("/api/rooms/" + roomId + "/messages")).status, 404);
  } finally {
    await ctx.close();
  }
});

test("注册模式：邀请码与关闭注册", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("admin1");
    // 邀请制（自动生成邀请码）
    const settings = ctx.services.settings.update({ registrationMode: "invite" });
    assert.ok(settings.registrationCode.length >= 6);

    const noCode = await ctx.newClient().post("/api/auth/register", { username: "invited1", password: "password123" });
    assert.equal(noCode.status, 403);

    const wrongCode = await ctx.newClient().post("/api/auth/register", {
      username: "invited1",
      password: "password123",
      inviteCode: "WRONGCODE",
    });
    assert.equal(wrongCode.status, 403);

    const ok = await ctx.newClient().post("/api/auth/register", {
      username: "invited1",
      password: "password123",
      inviteCode: settings.registrationCode,
    });
    assert.equal(ok.status, 200);

    // 关闭注册
    ctx.services.settings.update({ registrationMode: "closed" });
    const closed = await ctx.newClient().post("/api/auth/register", { username: "closed1", password: "password123" });
    assert.equal(closed.status, 403);
    void admin;
  } finally {
    await ctx.close();
  }
});

test("个人资料与修改密码", async () => {
  const ctx = await createTestContext();
  try {
    const user = await ctx.registerUser("player1", "password123", "旧昵称");
    const updated = await user.patch<{ user: { displayName: string; avatarColor: string; avatarEmoji: string | null; statusText: string } }>(
      "/api/users/me",
      { displayName: "新昵称", avatarColor: "#22c55e", avatarEmoji: "🐱", statusText: "上分中" },
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.displayName, "新昵称");
    assert.equal(updated.body.user.avatarColor, "#22c55e");
    assert.equal(updated.body.user.avatarEmoji, "🐱");
    assert.equal(updated.body.user.statusText, "上分中");

    const wrong = await user.post("/api/users/me/password", { currentPassword: "nope", newPassword: "newpassword123" });
    assert.equal(wrong.status, 401);

    const changed = await user.post("/api/users/me/password", { currentPassword: "password123", newPassword: "newpassword123" });
    assert.equal(changed.status, 200);

    const relogin = ctx.newClient();
    assert.equal((await relogin.post("/api/auth/login", { username: "player1", password: "password123" })).status, 401);
    assert.equal((await relogin.post("/api/auth/login", { username: "player1", password: "newpassword123" })).status, 200);
  } finally {
    await ctx.close();
  }
});
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  AdminAuditResponse,
  AdminBanListResponse,
  AdminOverviewResponse,
  AdminRoomsResponse,
  AdminSessionsResponse,
  AdminSettingsResponse,
  AdminUserRow,
  AuditRow,
  BanRow,
  OnlineUser,
  Role,
  RoomDetail,
} from "@airmic/shared";
import { hashPassword } from "../src/lib/password.js";
import type { HubLike } from "../src/realtime/contracts.js";
import { getHub, setHub } from "../src/realtime/instance.js";
import type { CreateRoomInput, RoomRow } from "../src/services/rooms.js";
import type { UserRow } from "../src/services/users.js";
import { createTestContext, TestClient, type TestContext } from "./helpers.js";

// ============ 测试基础设施 ============

interface HubCall {
  method: string;
  args: unknown[];
}

/** 记录管理动作调用、可注入在线状态的实时层替身 */
class FakeHub implements HubLike {
  readonly calls: HubCall[] = [];
  onlineUsers: OnlineUser[] = [];
  roomCounts = new Map<number, number>();
  peakOnline = 0;
  onlineCount: number | null = null;
  kickResult = true;
  disconnectResult = true;
  forceMuteResult = true;
  moveResult = true;

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  callsOf(method: string): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }

  getRoomCounts(): Map<number, number> {
    return new Map(this.roomCounts);
  }

  getRoomIdForUser(userId: number): number | null {
    return this.onlineUsers.find((entry) => entry.userId === userId)?.roomId ?? null;
  }

  getOnlineUsers(): OnlineUser[] {
    return this.onlineUsers.map((entry) => ({ ...entry }));
  }

  getOnlineCount(): number {
    return this.onlineCount ?? this.onlineUsers.length;
  }

  getPeakOnline(): number {
    return this.peakOnline;
  }

  isOnline(userId: number): boolean {
    return this.onlineUsers.some((entry) => entry.userId === userId);
  }

  kick(userId: number, scope: "server" | "room", reason: string): boolean {
    this.record("kick", userId, scope, reason);
    return this.kickResult;
  }

  disconnectUser(userId: number, reason: string): boolean {
    this.record("disconnectUser", userId, reason);
    return this.disconnectResult;
  }

  forceMute(userId: number, muted: boolean, reason?: string): boolean {
    this.record("forceMute", userId, muted, reason);
    return this.forceMuteResult;
  }

  moveToRoom(userId: number, roomId: number | null): boolean {
    this.record("moveToRoom", userId, roomId);
    return this.moveResult;
  }

  refreshUser(userId: number): void {
    this.record("refreshUser", userId);
  }

  broadcastRooms(): void {
    this.record("broadcastRooms");
  }

  broadcastRoomUpdate(roomId: number): void {
    this.record("broadcastRoomUpdate", roomId);
  }

  broadcastRoomDeleted(roomId: number, reason?: string): void {
    this.record("broadcastRoomDeleted", roomId, reason);
  }

  broadcastOnlineUsers(): void {
    this.record("broadcastOnlineUsers");
  }

  broadcastServerSettings(): void {
    this.record("broadcastServerSettings");
  }

  shutdown(): void {
    this.record("shutdown");
  }
}

interface TestActor {
  row: UserRow;
  client: TestClient;
}

interface Env {
  ctx: TestContext;
  admin: TestActor;
  user: TestActor;
  hub: FakeHub;
}

interface HookContext {
  after(fn: () => void | Promise<void>): void;
}

/** 直接写入数据库并签发会话，避免反复触发注册接口的限流 */
function createActor(
  ctx: TestContext,
  options: { username: string; displayName?: string; role?: Role; password?: string; ip?: string; isGuest?: boolean },
): TestActor {
  const ip = options.ip ?? "127.0.0.1";
  const row = options.isGuest
    ? ctx.services.users.createGuest(options.displayName ?? options.username, ip)
    : ctx.services.users.create({
        username: options.username,
        displayName: options.displayName ?? options.username,
        passwordHash: options.password ? hashPassword(options.password) : null,
        role: options.role ?? "user",
        ip,
      });
  const auth = ctx.services.auth.createSessionForUser(row, ip, "node:test");
  const client = ctx.newClient();
  client.cookies.set("airmic_token", auth.token);
  return { row, client };
}

async function setup(t: HookContext): Promise<Env> {
  const ctx = await createTestContext();
  const frameworkHub = getHub();
  const hub = new FakeHub();
  setHub(hub);
  t.after(async () => {
    setHub(frameworkHub);
    await ctx.close();
    setHub(null);
  });
  const admin = createActor(ctx, { username: "admin_root", displayName: "管理员", role: "admin" });
  const user = createActor(ctx, { username: "normal_user", displayName: "普通用户" });
  return { ctx, admin, user, hub };
}

function createRoom(
  ctx: TestContext,
  name: string,
  input: Partial<Omit<CreateRoomInput, "name">> = {},
  createdBy: number | null = null,
): RoomRow {
  return ctx.services.rooms.create({ name, ...input }, createdBy);
}

function makeOnlineUser(row: UserRow, roomId: number | null, roomName: string | null = null): OnlineUser {
  return {
    userId: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isGuest: row.is_guest === 1,
    avatarColor: row.avatar_color,
    avatarEmoji: row.avatar_emoji,
    roomId,
    roomName,
    muted: false,
    deafened: false,
    speaking: false,
  };
}

function latestAudit(ctx: TestContext, action: string): AuditRow | undefined {
  return ctx.services.audit.list({ page: 1, pageSize: 5, action }).items[0];
}

function errorMessage(body: unknown): string {
  const parsed = body as { error?: { message?: string } };
  return parsed.error?.message ?? "";
}

// ============ 权限 ============

test("未登录返回 401，普通用户访问管理接口返回 403，首个注册用户为管理员", async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.close());
  const anonymous = ctx.newClient();

  assert.equal((await anonymous.get("/api/admin/overview")).status, 401);
  assert.equal((await anonymous.get("/api/admin/users")).status, 401);
  assert.equal((await anonymous.patch("/api/admin/settings", { name: "x" })).status, 401);
  assert.equal((await anonymous.post("/api/admin/users/1/kick")).status, 401);
  assert.equal((await anonymous.del("/api/admin/users/1")).status, 401);
  const unauthorizedBody = await anonymous.get("/api/admin/settings");
  assert.equal((unauthorizedBody.body as { error: { code: string } }).error.code, "unauthorized");

  // 首个注册用户自动成为管理员，之后的注册用户为普通角色
  const first = ctx.newClient();
  const firstRes = await first.register("studio_owner", "password123");
  assert.equal(firstRes.status, 200);
  assert.equal(firstRes.body.user.role, "admin");

  const second = ctx.newClient();
  const secondRes = await second.register("studio_user", "password123");
  assert.equal(secondRes.status, 200);
  assert.equal(secondRes.body.user.role, "user");

  for (const path of [
    "/api/admin/overview",
    "/api/admin/settings",
    "/api/admin/users",
    "/api/admin/audit",
    "/api/admin/bans",
    "/api/admin/sessions",
    "/api/admin/rooms",
  ]) {
    assert.equal((await second.get(path)).status, 403, path + " 应拒绝普通用户");
  }
  assert.equal((await second.patch("/api/admin/settings", { name: "x" })).status, 403);
  assert.equal((await first.get("/api/admin/overview")).status, 200);
});

// ============ 仪表盘 ============

test("overview 返回统计、在线用户、最近审计与房间人数", async (t) => {
  const env = await setup(t);
  const guest = createActor(env.ctx, { username: "guest_1", displayName: "游客甲", isGuest: true });
  const room = createRoom(env.ctx, "一号房", {}, env.admin.row.id);
  env.ctx.services.rooms.addMessage(
    room.id,
    { id: env.admin.row.id, name: "管理员", role: "admin" },
    "大家好",
  );
  env.ctx.services.rooms.addMessage(
    room.id,
    { id: env.user.row.id, name: "普通用户", role: "user" },
    "你好",
  );
  env.ctx.services.bans.create({ userId: guest.row.id, reason: "测试封禁", bannedById: env.admin.row.id });
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  env.ctx.services.db.run(
    "INSERT INTO bans (user_id, username, ip, reason, banned_by, created_at, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    null,
    null,
    "198.51.100.7",
    "过期封禁",
    null,
    expiredAt,
    expiredAt,
  );

  env.hub.onlineUsers = [
    makeOnlineUser(env.admin.row, room.id, room.name),
    makeOnlineUser(env.user.row, room.id, room.name),
  ];
  env.hub.onlineCount = 2;
  env.hub.peakOnline = 5;
  env.hub.roomCounts.set(room.id, 2);
  for (let index = 0; index < 10; index += 1) {
    env.ctx.services.audit.log({ actorName: "tester", action: "seed_action_" + index });
  }

  const res = await env.admin.client.get<AdminOverviewResponse>("/api/admin/overview");
  assert.equal(res.status, 200);
  const body = res.body;
  assert.equal(body.stats.users, 2);
  assert.equal(body.stats.guests, 1);
  assert.equal(body.stats.online, 2);
  assert.equal(body.stats.peakOnline, 5);
  assert.equal(body.stats.rooms, 1);
  assert.equal(body.stats.messages, 2);
  assert.equal(body.stats.activeBans, 1);
  assert.equal(body.stats.startedAt, env.ctx.services.startedAt);
  assert.ok(body.stats.uptimeSeconds >= 0);
  assert.deepEqual(
    body.onlineUsers.map((entry) => entry.userId).sort((a, b) => a - b),
    [env.admin.row.id, env.user.row.id].sort((a, b) => a - b),
  );
  assert.equal(body.recentAudit.length, 8);
  assert.equal(body.rooms.length, 1);
  assert.equal(body.rooms[0]?.name, "一号房");
  assert.equal(body.rooms[0]?.userCount, 2);
});

// ============ 服务器设置 ============

test("settings 读取、更新、审计与广播", async (t) => {
  const env = await setup(t);
  const initial = await env.admin.client.get<AdminSettingsResponse>("/api/admin/settings");
  assert.equal(initial.status, 200);
  assert.equal(initial.body.settings.version, "1.0.0");
  assert.equal(initial.body.settings.name, "AirMic 语音服务器");
  assert.equal(typeof initial.body.settings.registrationCode, "string");

  const res = await env.admin.client.patch<AdminSettingsResponse>("/api/admin/settings", {
    name: "测试语音服",
    motd: "欢迎光临",
    maxUsers: 50,
    registrationMode: "invite",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.settings.name, "测试语音服");
  assert.equal(res.body.settings.motd, "欢迎光临");
  assert.equal(res.body.settings.maxUsers, 50);
  assert.equal(res.body.settings.registrationMode, "invite");
  assert.ok(res.body.settings.registrationCode.length > 0);
  assert.equal(env.hub.callsOf("broadcastServerSettings").length, 1);

  const audit = latestAudit(env.ctx, "settings_update");
  assert.ok(audit);
  assert.equal(audit.actorId, env.admin.row.id);
  assert.equal(audit.actorName, "管理员");
  const details = JSON.parse(audit.details ?? "{}") as { fields?: string[] };
  for (const field of ["name", "motd", "maxUsers", "registrationMode"]) {
    assert.ok((details.fields ?? []).includes(field), "审计应记录字段 " + field);
  }

  // 公开接口同步生效
  const publicInfo = await env.ctx.newClient().get<{ server: { name: string } }>("/api/server");
  assert.equal(publicInfo.body.server.name, "测试语音服");

  // 音质支持部分字段更新（以当前默认值为基准合并）
  const audioRes = await env.admin.client.patch<AdminSettingsResponse>("/api/admin/settings", {
    defaultAudioSettings: { bitrate: 64000 },
  });
  assert.equal(audioRes.status, 200);
  assert.equal(audioRes.body.settings.defaultAudioSettings.bitrate, 64000);
  assert.equal(audioRes.body.settings.defaultAudioSettings.preset, "custom");

  const badRange = await env.admin.client.patch("/api/admin/settings", { maxUsers: -1 });
  assert.equal(badRange.status, 400);
  assert.match(errorMessage(badRange.body), /请求参数不正确/);
  assert.equal((await env.admin.client.patch("/api/admin/settings", { registrationMode: "weird" })).status, 400);
  assert.equal(
    (await env.admin.client.patch("/api/admin/settings", { defaultAudioSettings: { bitrate: 1 } })).status,
    400,
  );
});

// ============ 用户管理 ============

test("用户列表支持搜索、分页、角色筛选并含在线状态", async (t) => {
  const env = await setup(t);
  const alice = createActor(env.ctx, { username: "alice", displayName: "爱丽丝" });
  const bob = createActor(env.ctx, { username: "bob", displayName: "鲍勃" });
  const guest = createActor(env.ctx, { username: "charlie", displayName: "游客查理", isGuest: true });
  const room = createRoom(env.ctx, "一号房", {}, env.admin.row.id);
  env.hub.onlineUsers = [makeOnlineUser(alice.row, room.id), makeOnlineUser(bob.row, null)];
  env.hub.onlineCount = 2;

  const res = await env.admin.client.get<{
    items: AdminUserRow[];
    users: AdminUserRow[];
    total: number;
    page: number;
    pageSize: number;
    onlineCount: number;
  }>("/api/admin/users");
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 5);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.pageSize, 20);
  assert.equal(res.body.onlineCount, 2);
  assert.deepEqual(res.body.users, res.body.items);

  const aliceRow = res.body.items.find((row) => row.id === alice.row.id);
  assert.ok(aliceRow);
  assert.equal(aliceRow.online, true);
  assert.equal(aliceRow.roomId, room.id);
  assert.equal(aliceRow.roomName, "一号房");
  assert.equal(aliceRow.lastIp, "127.0.0.1");
  assert.equal(aliceRow.role, "user");

  const adminRow = res.body.items.find((row) => row.id === env.admin.row.id);
  assert.ok(adminRow);
  assert.equal(adminRow.online, false);
  assert.equal(adminRow.roomId, null);
  assert.equal(adminRow.role, "admin");

  const page2 = await env.admin.client.get<{ items: AdminUserRow[]; total: number }>(
    "/api/admin/users?page=2&pageSize=2",
  );
  assert.equal(page2.status, 200);
  assert.equal(page2.body.total, 5);
  assert.equal(page2.body.items.length, 2);

  const search = await env.admin.client.get<{ items: AdminUserRow[]; total: number }>("/api/admin/users?search=ali");
  assert.equal(search.body.total, 1);
  assert.equal(search.body.items[0]?.username, "alice");

  const guests = await env.admin.client.get<{ items: AdminUserRow[]; total: number }>("/api/admin/users?role=guest");
  assert.equal(guests.body.total, 1);
  assert.equal(guests.body.items[0]?.username, guest.row.username);

  assert.equal((await env.admin.client.get("/api/admin/users?role=superuser")).status, 400);
  assert.equal((await env.admin.client.get("/api/admin/users?pageSize=101")).status, 400);
  assert.equal((await env.admin.client.get("/api/admin/users?page=0")).status, 400);
});

test("修改用户昵称/角色并保护最后一名管理员", async (t) => {
  const env = await setup(t);
  const res = await env.admin.client.patch<{ user: AdminUserRow }>("/api/admin/users/" + env.user.row.id, {
    role: "moderator",
    displayName: "版主甲",
    statusText: "值班中",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, env.user.row.id);
  assert.equal(res.body.user.role, "moderator");
  assert.equal(res.body.user.displayName, "版主甲");
  assert.equal(res.body.user.statusText, "值班中");
  assert.deepEqual(env.hub.callsOf("refreshUser"), [[env.user.row.id]]);
  const audit = latestAudit(env.ctx, "user_update");
  assert.ok(audit);
  assert.equal(audit.targetId, String(env.user.row.id));
  assert.equal(audit.targetName, "normal_user");

  // 角色变更即时反映到权限
  const me = await env.user.client.get<{ user: { role: string; permissions: string[] } }>("/api/auth/me");
  assert.equal(me.body.user.role, "moderator");
  assert.ok(me.body.user.permissions.includes("kick_users"));
  assert.ok(!me.body.user.permissions.includes("manage_server"));

  const demote = await env.admin.client.patch("/api/admin/users/" + env.admin.row.id, { role: "user" });
  assert.equal(demote.status, 400);
  assert.match(errorMessage(demote.body), /最后一名管理员/);

  assert.equal((await env.admin.client.patch("/api/admin/users/99999", { role: "user" })).status, 404);
  assert.equal((await env.admin.client.patch("/api/admin/users/" + env.user.row.id, {})).status, 400);
  assert.equal(
    (await env.admin.client.patch("/api/admin/users/" + env.user.row.id, { role: "superuser" })).status,
    400,
  );
});

test("删除用户：保护自己、注销会话并断开实时连接", async (t) => {
  const env = await setup(t);
  const victim = createActor(env.ctx, { username: "victim", displayName: "待删除" });
  env.hub.onlineUsers = [makeOnlineUser(victim.row, null)];

  const res = await env.admin.client.del<{ ok: boolean }>("/api/admin/users/" + victim.row.id);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(env.ctx.services.users.findById(victim.row.id), undefined);
  assert.deepEqual(env.hub.callsOf("disconnectUser"), [[victim.row.id, "账号已被删除"]]);
  assert.equal((await victim.client.get("/api/auth/me")).status, 401);
  const audit = latestAudit(env.ctx, "user_delete");
  assert.ok(audit);
  assert.equal(audit.targetId, String(victim.row.id));

  const self = await env.admin.client.del("/api/admin/users/" + env.admin.row.id);
  assert.equal(self.status, 400);
  assert.match(errorMessage(self.body), /自己/);
  assert.equal((await env.admin.client.del("/api/admin/users/99999")).status, 404);
});

test("踢人：离线返回 409，在线调用实时层并审计", async (t) => {
  const env = await setup(t);
  const victim = createActor(env.ctx, { username: "noisy", displayName: "吵闹的人" });

  const offline = await env.admin.client.post("/api/admin/users/" + victim.row.id + "/kick", { scope: "room" });
  assert.equal(offline.status, 409);
  assert.match(errorMessage(offline.body), /不在线/);

  env.hub.onlineUsers = [makeOnlineUser(victim.row, null)];
  const res = await env.admin.client.post<{ ok: boolean }>(
    "/api/admin/users/" + victim.row.id + "/kick",
    { scope: "room", reason: "太吵了" },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(env.hub.callsOf("kick"), [[victim.row.id, "room", "太吵了"]]);
  const audit = latestAudit(env.ctx, "user_kick");
  assert.ok(audit);
  assert.ok(audit.details?.includes("太吵了"));

  // 未提供 scope 时默认踢出服务器
  assert.equal((await env.admin.client.post("/api/admin/users/" + victim.row.id + "/kick")).status, 200);
  const calls = env.hub.callsOf("kick");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.[1], "server");
  assert.equal(typeof calls[1]?.[2], "string");
  assert.ok((calls[1]?.[2] as string).length > 0);

  // 版主拥有 kick_users 权限，但没有 manage_server 权限
  env.ctx.services.users.updateRole(env.user.row.id, "moderator");
  assert.equal(
    (await env.user.client.post("/api/admin/users/" + victim.row.id + "/kick", { scope: "room" })).status,
    200,
  );
  assert.equal((await env.user.client.get("/api/admin/overview")).status, 403);

  assert.equal((await env.admin.client.post("/api/admin/users/99999/kick")).status, 409);
});

test("强制静音/解除静音调用实时层并审计", async (t) => {
  const env = await setup(t);
  const target = createActor(env.ctx, { username: "loud", displayName: "大嗓门" });

  assert.equal(
    (await env.admin.client.post("/api/admin/users/" + target.row.id + "/mute", { muted: true })).status,
    409,
  );

  env.hub.onlineUsers = [makeOnlineUser(target.row, null)];
  const res = await env.admin.client.post<{ ok: boolean }>(
    "/api/admin/users/" + target.row.id + "/mute",
    { muted: true, reason: "请安静" },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(env.hub.callsOf("forceMute"), [[target.row.id, true, "请安静"]]);
  const audit = latestAudit(env.ctx, "user_mute");
  assert.ok(audit);
  assert.ok(audit.details?.includes('"muted":true'));

  assert.equal(
    (await env.admin.client.post("/api/admin/users/" + target.row.id + "/mute", { muted: false })).status,
    200,
  );
  assert.deepEqual(env.hub.callsOf("forceMute")[1], [target.row.id, false, undefined]);
  assert.equal(
    (await env.admin.client.post("/api/admin/users/" + target.row.id + "/mute", { muted: "yes" })).status,
    400,
  );
});

test("移动用户到房间/大厅并校验房间存在", async (t) => {
  const env = await setup(t);
  const target = createActor(env.ctx, { username: "mover", displayName: "被移动" });
  const room = createRoom(env.ctx, "二号房", {}, env.admin.row.id);
  env.hub.onlineUsers = [makeOnlineUser(target.row, null)];

  assert.equal(
    (await env.admin.client.post("/api/admin/users/" + target.row.id + "/move", { roomId: 99999 })).status,
    404,
  );
  assert.equal((await env.admin.client.post("/api/admin/users/" + target.row.id + "/move", {})).status, 400);
  assert.equal(
    (await env.admin.client.post("/api/admin/users/" + target.row.id + "/move", { roomId: -1 })).status,
    400,
  );

  const res = await env.admin.client.post<{ ok: boolean }>("/api/admin/users/" + target.row.id + "/move", {
    roomId: room.id,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(env.hub.callsOf("moveToRoom")[0], [target.row.id, room.id]);
  const audit = latestAudit(env.ctx, "user_move");
  assert.ok(audit);
  assert.ok(audit.details?.includes("二号房"));

  assert.equal(
    (await env.admin.client.post("/api/admin/users/" + target.row.id + "/move", { roomId: null })).status,
    200,
  );
  assert.deepEqual(env.hub.callsOf("moveToRoom")[1], [target.row.id, null]);
});

// ============ 封禁管理 ============

test("创建账号封禁：快照用户名、注销会话、断开连接并记录审计", async (t) => {
  const env = await setup(t);
  const victim = createActor(env.ctx, { username: "spammer", displayName: "刷屏者", password: "password123" });
  env.hub.onlineUsers = [makeOnlineUser(victim.row, null)];

  const res = await env.admin.client.post<{ ban: BanRow }>("/api/admin/bans", {
    userId: victim.row.id,
    reason: "刷屏骂人",
    durationMinutes: 60,
  });
  assert.equal(res.status, 200);
  const ban = res.body.ban;
  assert.equal(ban.userId, victim.row.id);
  assert.equal(ban.username, "spammer");
  assert.equal(ban.reason, "刷屏骂人");
  assert.equal(ban.active, true);
  assert.ok(ban.expiresAt);
  assert.equal(ban.bannedById, env.admin.row.id);
  assert.equal(ban.bannedByName, "管理员");

  assert.equal(env.ctx.services.users.findById(victim.row.id)?.is_banned, 1);
  assert.equal((await victim.client.get("/api/auth/me")).status, 401);
  assert.deepEqual(env.hub.callsOf("disconnectUser")[0]?.[0], victim.row.id);
  assert.match(String(env.hub.callsOf("disconnectUser")[0]?.[1]), /封禁/);
  const audit = latestAudit(env.ctx, "ban_create");
  assert.ok(audit);
  assert.ok(audit.details?.includes('"durationMinutes":60'));
  assert.ok(audit.details?.includes("spammer"));

  const active = await env.admin.client.get<AdminBanListResponse>("/api/admin/bans?active=true");
  assert.equal(active.body.total, 1);
  assert.equal(active.body.page, 1);
  assert.equal(active.body.pageSize, 20);
  assert.equal((await env.admin.client.get<AdminBanListResponse>("/api/admin/bans?active=false")).body.total, 0);
  assert.equal((await env.admin.client.get<AdminBanListResponse>("/api/admin/bans")).body.total, 1);

  // 不能封禁自己或管理员
  const self = await env.admin.client.post("/api/admin/bans", { userId: env.admin.row.id, reason: "手滑" });
  assert.equal(self.status, 400);
  assert.match(errorMessage(self.body), /自己/);
  env.ctx.services.users.updateRole(env.user.row.id, "admin");
  const adminBan = await env.admin.client.post("/api/admin/bans", { userId: env.user.row.id, reason: "管理员" });
  assert.equal(adminBan.status, 400);
  assert.match(errorMessage(adminBan.body), /管理员/);

  // 参数校验
  assert.equal((await env.admin.client.post("/api/admin/bans", {})).status, 400);
  const noTarget = await env.admin.client.post("/api/admin/bans", { reason: "测试" });
  assert.equal(noTarget.status, 400);
  assert.match(errorMessage(noTarget.body), /用户 ID 或 IP/);
  assert.equal((await env.admin.client.post("/api/admin/bans", { userId: 99999, reason: "测试" })).status, 404);
  assert.equal((await env.admin.client.post("/api/admin/bans", { ip: "not-an-ip", reason: "测试" })).status, 400);
  assert.equal(
    (await env.admin.client.post("/api/admin/bans", { userId: victim.row.id, reason: "" })).status,
    400,
  );
});

test("IP 封禁与解除封禁", async (t) => {
  const env = await setup(t);
  const created = await env.admin.client.post<{ ban: BanRow }>("/api/admin/bans", {
    ip: "203.0.113.9",
    reason: "恶意 IP",
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.ban.userId, null);
  assert.equal(created.body.ban.username, null);
  assert.equal(created.body.ban.ip, "203.0.113.9");
  assert.equal(created.body.ban.bannedByName, "管理员");

  const banId = created.body.ban.id;
  const revoked = await env.admin.client.patch<{ ban: BanRow }>("/api/admin/bans/" + banId, { active: false });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.ban.active, false);
  assert.equal(revoked.body.ban.reason, "恶意 IP");
  const audit = latestAudit(env.ctx, "ban_revoke");
  assert.ok(audit);
  assert.equal(audit.targetId, String(banId));

  assert.equal((await env.admin.client.get<AdminBanListResponse>("/api/admin/bans?active=true")).body.total, 0);
  assert.equal((await env.admin.client.get<AdminBanListResponse>("/api/admin/bans?active=false")).body.total, 1);

  assert.equal(
    (await env.admin.client.patch("/api/admin/bans/" + banId, { active: false })).status,
    400,
  );
  assert.equal(
    (await env.admin.client.patch("/api/admin/bans/" + banId, { active: true })).status,
    400,
  );
  assert.equal((await env.admin.client.patch("/api/admin/bans/99999", { active: false })).status, 404);
  assert.equal((await env.admin.client.patch("/api/admin/bans/" + banId, {})).status, 400);
});

test("被封禁账号与 IP 无法登录", async (t) => {
  const env = await setup(t);
  const bannedUser = createActor(env.ctx, { username: "badboy", displayName: "违规用户", password: "password123" });
  createActor(env.ctx, { username: "goodboy", displayName: "正常用户", password: "password123" });

  const banRes = await env.admin.client.post("/api/admin/bans", { userId: bannedUser.row.id, reason: "违规" });
  assert.equal(banRes.status, 200);

  const loginBanned = await env.ctx.newClient().post<{ error: { code: string; message: string } }>(
    "/api/auth/login",
    { username: "badboy", password: "password123" },
  );
  assert.equal(loginBanned.status, 403);
  assert.equal(loginBanned.body.error.code, "banned");
  assert.match(loginBanned.body.error.message, /封禁/);

  const loginOk = await env.ctx.newClient().post("/api/auth/login", { username: "goodboy", password: "password123" });
  assert.equal(loginOk.status, 200);

  const ipBan = await env.admin.client.post("/api/admin/bans", { ip: "127.0.0.1", reason: "异常 IP" });
  assert.equal(ipBan.status, 200);
  const loginByIp = await env.ctx.newClient().post("/api/auth/login", {
    username: "goodboy",
    password: "password123",
  });
  assert.equal(loginByIp.status, 403);
  assert.match(errorMessage(loginByIp.body), /IP/);
});

// ============ 审计与会话 ============

test("审计日志分页与按操作筛选", async (t) => {
  const env = await setup(t);
  await env.admin.client.patch("/api/admin/settings", { name: "审计测试服" });
  await env.admin.client.patch("/api/admin/users/" + env.user.row.id, { displayName: "改名用户" });
  env.hub.onlineUsers = [makeOnlineUser(env.user.row, null)];
  await env.admin.client.post("/api/admin/users/" + env.user.row.id + "/kick", {
    scope: "server",
    reason: "审计踢人",
  });

  const res = await env.admin.client.get<AdminAuditResponse>("/api/admin/audit");
  assert.equal(res.status, 200);
  assert.ok(res.body.total >= 3);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.pageSize, 20);
  assert.equal(res.body.items[0]?.action, "user_kick");
  assert.equal(res.body.items[0]?.actorName, "管理员");
  assert.equal(res.body.items[0]?.targetName, "normal_user");

  const filtered = await env.admin.client.get<AdminAuditResponse>("/api/admin/audit?action=settings_update");
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.items[0]?.action, "settings_update");
  assert.ok(filtered.body.items[0]?.details?.includes("name"));

  const filteredPage = await env.admin.client.get<AdminAuditResponse>(
    "/api/admin/audit?page=1&pageSize=1&action=user_update",
  );
  assert.equal(filteredPage.body.total, 1);
  assert.equal(filteredPage.body.items.length, 1);
  assert.equal(filteredPage.body.items[0]?.action, "user_update");
  assert.equal(filteredPage.body.page, 1);
  assert.equal(filteredPage.body.pageSize, 1);

  // 未过滤时共 3 条审计，pageSize=2 的第二页有 1 条
  const pagedAll = await env.admin.client.get<AdminAuditResponse>("/api/admin/audit?page=2&pageSize=2");
  assert.equal(pagedAll.body.total, res.body.total);
  assert.equal(pagedAll.body.items.length, 1);
  assert.equal(pagedAll.body.page, 2);

  const empty = await env.admin.client.get<AdminAuditResponse>("/api/admin/audit?action=not_exist_action");
  assert.equal(empty.body.total, 0);
  assert.equal((await env.admin.client.get("/api/admin/audit?pageSize=500")).status, 400);
});

test("有效登录会话列表并排除已注销会话", async (t) => {
  const env = await setup(t);
  createActor(env.ctx, { username: "guest_session", displayName: "会话游客", isGuest: true });

  const res = await env.admin.client.get<AdminSessionsResponse>("/api/admin/sessions");
  assert.equal(res.status, 200);
  assert.ok(res.body.sessions.length >= 3);
  assert.ok(res.body.sessions.length <= 200);
  const adminSession = res.body.sessions.find((session) => session.userId === env.admin.row.id);
  assert.ok(adminSession);
  assert.equal(adminSession.username, "admin_root");
  assert.equal(adminSession.displayName, "管理员");
  assert.equal(adminSession.role, "admin");
  assert.equal(adminSession.isGuest, false);
  assert.equal(adminSession.ip, "127.0.0.1");
  assert.ok(Date.parse(adminSession.expiresAt) > Date.now());
  assert.ok(res.body.sessions.some((session) => session.isGuest));

  env.ctx.services.auth.revokeUserSessions(env.user.row.id);
  const after = await env.admin.client.get<AdminSessionsResponse>("/api/admin/sessions");
  assert.ok(!after.body.sessions.some((session) => session.userId === env.user.row.id));
  assert.ok(after.body.sessions.some((session) => session.userId === env.admin.row.id));
});

// ============ 房间详情 ============

test("房间详情列表含实时人数与生效音质", async (t) => {
  const env = await setup(t);
  const plain = createRoom(env.ctx, "普通房", { description: "默认音质" }, env.admin.row.id);
  const music = createRoom(env.ctx, "音乐房", { audioOverride: { preset: "music" } }, env.admin.row.id);
  const locked = createRoom(
    env.ctx,
    "上锁房",
    { password: "room-pass", locked: true, maxUsers: 5 },
    env.admin.row.id,
  );
  env.hub.roomCounts.set(plain.id, 3);
  env.hub.roomCounts.set(music.id, 1);

  const res = await env.admin.client.get<AdminRoomsResponse>("/api/admin/rooms");
  assert.equal(res.status, 200);
  assert.equal(res.body.rooms.length, 3);

  const plainRoom = res.body.rooms.find((room) => room.id === plain.id) as RoomDetail;
  assert.ok(plainRoom);
  assert.equal(plainRoom.userCount, 3);
  assert.equal(plainRoom.audioOverride, null);
  assert.equal(plainRoom.audioSettings.preset, "voice-standard");
  assert.equal(plainRoom.createdBy?.displayName, "管理员");

  const musicRoom = res.body.rooms.find((room) => room.id === music.id) as RoomDetail;
  assert.ok(musicRoom);
  assert.equal(musicRoom.userCount, 1);
  assert.equal(musicRoom.audioSettings.preset, "music");
  assert.equal(musicRoom.audioSettings.channels, 2);
  assert.equal(musicRoom.audioOverride?.preset, "music");

  const lockedRoom = res.body.rooms.find((room) => room.id === locked.id) as RoomDetail;
  assert.ok(lockedRoom);
  assert.equal(lockedRoom.hasPassword, true);
  assert.equal(lockedRoom.locked, true);
  assert.equal(lockedRoom.maxUsers, 5);

  // 普通用户无权访问
  assert.equal((await env.user.client.get("/api/admin/rooms")).status, 403);
});

// ============ SPA 回退与 API 404 ============

test("API 未知路径返回 JSON 404，SPA 路径回退 index.html", async (t) => {
  const webDist = mkdtempSync(path.join(os.tmpdir(), "airmic-webdist-"));
  writeFileSync(path.join(webDist, "index.html"), "<!doctype html><html><title>AirMic</title></html>", "utf8");
  t.after(() => rmSync(webDist, { recursive: true, force: true }));

  const ctx = await createTestContext({ webDist });
  t.after(() => ctx.close());

  const api404 = await ctx.newClient().get("/api/not-exists");
  assert.equal(api404.status, 404);
  assert.deepEqual(api404.body, { error: { code: "not_found", message: "资源不存在" } });

  const spa = await ctx.newClient().get("/lobby/room/1");
  assert.equal(spa.status, 200);
  assert.match(String(spa.body), /AirMic/);
});

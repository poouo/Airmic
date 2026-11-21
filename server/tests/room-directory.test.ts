import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { RoomArea, RoomDirectory, RoomSummary, UserSelf } from "@airmic/shared";
import { Database } from "../src/db.js";
import { MIGRATIONS } from "../src/schema.js";
import { createTestContext, type TestClient } from "./helpers.js";

const directoryPath = "/api/room-directory";
const areasPath = `${directoryPath}/areas`;
const roomPath = (id: number) => `/api/rooms/${id}`;

async function createArea(client: TestClient, parentId: number | null, name: string): Promise<number> {
  const result = await client.post<{ area: RoomArea }>(areasPath, { parentId, name });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.area.id;
}

async function createRoom(client: TestClient, areaId: number, name: string, password?: string): Promise<RoomSummary> {
  const result = await client.post<{ room: RoomSummary }>("/api/rooms", { areaId, name, password });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.room;
}

test("旧数据库按原有路径迁移，保留房间 ID、密码、聊天和空分类", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "airmic-directory-migration-"));
  const file = path.join(temp, "airmic.db");
  try {
    const legacy = new DatabaseSync(file);
    try {
      legacy.exec("PRAGMA foreign_keys = ON");
      for (const migration of MIGRATIONS.filter((entry) => entry.version < 4)) legacy.exec(migration.sql);
      legacy.exec(`
        INSERT INTO rooms (id, name, channel, category, password_hash, created_at, updated_at)
        VALUES (7, '一号房', '游戏区', '大厅', 'old-hash', 'before', 'before'),
               (9, '二号房', '娱乐区', '大厅', NULL, 'before', 'before'),
               (12, '已删除', '娱乐区', '大厅', NULL, 'before', 'before');
        INSERT INTO messages (id, room_id, sender_name, content, created_at) VALUES (13, 7, '玩家', '上车', 'before');
        INSERT INTO users (id, username, display_name, role, is_guest, created_at, updated_at)
        VALUES (12, 'guest_legacy', '旧游客', 'guest', 1, 'before', 'before');
        INSERT INTO sessions (session_id, user_id, created_at, last_seen_at, expires_at)
        VALUES ('legacy_guest_session', 12, 'before', 'before', 'after');
        INSERT INTO messages (room_id, user_id, sender_name, sender_role, content, created_at)
        VALUES (9, 12, '旧游客', 'guest', '游客留言', 'before');
        INSERT INTO app_logs (created_at, level, category, message, username, user_id)
        VALUES ('before', 'info', 'auth', '旧游客已进入', 'guest_legacy', 12);
        INSERT INTO settings (key, value, updated_at) VALUES ('roomCategories', '["大厅", "备用"]', 'before');
        DELETE FROM rooms WHERE id = 12;
        PRAGMA user_version = 3;
      `);
    } finally {
      legacy.close();
    }
    const db = new Database(file);
    try {
      const rooms = db.all<{ id: number; channel: string; category: string; password_hash: string | null }>(`
        SELECT r.id, a.name AS channel, c.name AS category, r.password_hash FROM rooms r
        JOIN room_areas c ON c.id = r.area_id JOIN room_areas a ON a.id = c.parent_id ORDER BY r.id
      `);
      assert.deepEqual(rooms.map(({ id, channel, category, password_hash }) => [id, channel, category, password_hash]),
        [[7, "游戏区", "大厅", "old-hash"], [9, "娱乐区", "大厅", null]]);
      assert.equal(db.get("SELECT 1 FROM rooms WHERE allow_guests != 1"), undefined);
      assert.equal(db.get("SELECT 1 FROM rooms WHERE text_chat_enabled != 1 OR chat_history_days != 30"), undefined);
      assert.equal(db.get("SELECT 1 FROM users WHERE id = 12"), undefined);
      assert.equal(db.get("SELECT 1 FROM sessions WHERE user_id = 12"), undefined);
      assert.equal(db.get("SELECT 1 FROM app_logs WHERE user_id = 12"), undefined);
      const guestMessage = db.get<{ user_id: number | null; sender_name: string }>("SELECT user_id, sender_name FROM messages WHERE content = '游客留言'");
      assert.equal(guestMessage?.user_id, null);
      assert.equal(guestMessage?.sender_name, "游客");
      assert.equal(db.get<{ content: string }>("SELECT content FROM messages WHERE id = 13 AND room_id = 7")?.content, "上车");
      assert.equal(db.get<{ seq: number }>("SELECT seq FROM sqlite_sequence WHERE name = 'rooms'")?.seq, 12);
      assert.equal(db.get<{ name: string }>("SELECT name FROM room_areas WHERE name = '备用' AND parent_id IS NOT NULL")?.name, "备用");
      assert.deepEqual(db.all("PRAGMA foreign_key_check"), []);
      db.run("DELETE FROM rooms WHERE id = 7");
      assert.equal(db.get("SELECT 1 FROM messages WHERE id = 13"), undefined);
    } finally {
      db.close();
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("分区独立存在，房间可跨子区同名，移动和删除保护原数据", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("directory_admin");
    const game = await createArea(admin, null, "游戏区");
    const entertainment = await createArea(admin, null, "娱乐区");
    const delta = await createArea(admin, game, "三角洲行动");
    const lol = await createArea(admin, game, "英雄联盟");
    const empty = await createArea(admin, entertainment, "游戏闲聊");
    const directory = await admin.get<RoomDirectory>(directoryPath);
    assert.ok(directory.body.areas.some((area) => area.id === empty && area.parentId === entertainment));
    assert.equal((await admin.post(areasPath, { parentId: delta, name: "三级分区" })).status, 400);
    assert.equal((await admin.post(areasPath, { parentId: game, name: "三角洲行动" })).status, 409);
    assert.equal((await admin.post("/api/rooms", { areaId: game, name: "放错层级" })).status, 400);
    const normal = await createRoom(admin, delta, "普通房");
    const otherNormal = await createRoom(admin, lol, "普通房");
    const locked = await createRoom(admin, delta, "加密房", "delta-1234");
    assert.equal(locked.hasPassword, true);
    assert.equal((await admin.post("/api/rooms", { areaId: delta, name: "普通房" })).status, 409);
    assert.equal((await admin.patch(roomPath(normal.id), { areaId: lol })).status, 409);
    assert.equal((await admin.patch(roomPath(locked.id), { areaId: lol })).status, 200);
    assert.equal((await admin.patch(`${areasPath}/${game}`, { name: "开黑区", sortOrder: -10 })).status, 200);
    const { body } = await admin.get<{ rooms: RoomSummary[] }>("/api/rooms");
    assert.ok(body.rooms.some((room) => room.id === normal.id && room.channel === "开黑区" && room.category === "三角洲行动"));
    assert.ok(body.rooms.some((room) => room.id === locked.id && room.areaId === lol && room.hasPassword));
    assert.ok(body.rooms.some((room) => room.id === otherNormal.id));
    assert.equal((await admin.del(`${areasPath}/${game}`)).status, 409);
    assert.equal((await admin.del(`${areasPath}/${delta}`)).status, 409);
    assert.equal((await admin.del(`${areasPath}/${empty}`)).status, 200);
    assert.equal((await admin.del(`${areasPath}/${entertainment}`)).status, 200);
  } finally {
    await ctx.close();
  }
});

test("房间、子区和一级分区授权隔离，撤销立即生效，踢出只影响目标房间", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("directory_admin");
    const manager = await ctx.registerUser("directory_manager");
    const player = await ctx.registerUser("directory_player");
    const game = await createArea(admin, null, "游戏区");
    const entertainment = await createArea(admin, null, "娱乐区");
    const delta = await createArea(admin, game, "三角洲行动");
    const lol = await createArea(admin, game, "英雄联盟");
    const casual = await createArea(admin, entertainment, "闲聊");
    const room = await createRoom(admin, delta, "普通房");
    const sibling = await createRoom(admin, lol, "普通房");
    const outside = await createRoom(admin, casual, "普通房");
    const roomGrant = `${directoryPath}/room/${room.id}/managers`;
    const childGrant = `${directoryPath}/area/${delta}/managers`;
    const rootGrant = `${directoryPath}/area/${game}/managers`;
    const grantee = { username: "directory_manager" };
    const managerId = (await manager.get<{ user: UserSelf }>("/api/auth/me")).body.user.id;
    const socket = await ctx.connectWs(manager);
    assert.deepEqual((await socket.waitFor("hello")).directory.grants, []);

    assert.equal((await manager.post(roomGrant, grantee)).status, 403);
    assert.equal((await manager.get(`${roomPath(room.id)}/settings`)).status, 403);
    assert.equal((await admin.post(roomGrant, grantee)).status, 200);
    await socket.waitFor("room_directory_changed");
    assert.deepEqual((await manager.get<RoomDirectory>(directoryPath)).body.grants, [{ kind: "room", id: room.id }]);
    assert.equal((await manager.get(`${roomPath(room.id)}/settings`)).status, 200);
    assert.equal((await manager.patch(roomPath(room.id), { description: "房管编辑" })).status, 200);
    assert.equal((await manager.patch(roomPath(room.id), { areaId: lol })).status, 403);
    assert.equal((await manager.patch(roomPath(sibling.id), { locked: true })).status, 403);
    assert.equal((await manager.post("/api/rooms", { areaId: delta, name: "房管不能新建" })).status, 403);

    const playerSocket = await ctx.connectWs(player);
    const playerId = (await playerSocket.waitFor("hello")).user.id;
    playerSocket.send({ t: "join_room", roomId: outside.id });
    await playerSocket.waitFor("room_joined");
    assert.equal((await manager.post(`${roomPath(outside.id)}/members/${playerId}/kick`)).status, 403);
    assert.equal((await manager.post(`${roomPath(room.id)}/members/${playerId}/kick`)).status, 409);
    playerSocket.send({ t: "join_room", roomId: room.id });
    await playerSocket.waitFor("room_joined");
    assert.equal((await manager.post(`${roomPath(room.id)}/members/${playerId}/kick`)).status, 200);
    assert.equal((await playerSocket.waitFor("kicked")).scope, "room");
    assert.equal((await admin.del(`${roomGrant}/${managerId}`)).status, 200);
    assert.equal((await manager.patch(roomPath(room.id), { locked: true })).status, 403);

    assert.equal((await admin.post(childGrant, grantee)).status, 200);
    await createRoom(manager, delta, "子区房管的新房");
    assert.equal((await manager.patch(`${areasPath}/${delta}`, { name: "三角洲" })).status, 200);
    assert.equal((await manager.post(areasPath, { parentId: game, name: "越界子区" })).status, 403);
    assert.equal((await manager.patch(roomPath(sibling.id), { locked: true })).status, 403);
    assert.equal((await admin.del(`${childGrant}/${managerId}`)).status, 200);

    assert.equal((await admin.post(rootGrant, grantee)).status, 200);
    const futureArea = await createArea(manager, game, "新游戏");
    await createRoom(manager, futureArea, "普通房");
    assert.equal((await manager.patch(roomPath(sibling.id), { locked: true })).status, 200);
    assert.equal((await manager.patch(roomPath(outside.id), { locked: true })).status, 403);
    assert.equal((await manager.post(areasPath, { parentId: null, name: "越界分区" })).status, 403);
    assert.equal((await manager.get("/api/admin/settings")).status, 403);
    const protectedRoom = await createRoom(admin, delta, "分区加密房", "test-password");
    const passwordPath = `${roomPath(protectedRoom.id)}/check-password`;
    assert.deepEqual((await admin.post(passwordPath, {})).body, { ok: true, required: false });
    assert.deepEqual((await manager.post(passwordPath, {})).body, { ok: true, required: false });
    assert.deepEqual((await player.post(passwordPath, {})).body, { ok: false, required: true });
    socket.send({ t: "join_room", roomId: protectedRoom.id });
    assert.equal((await socket.waitFor("room_joined")).snapshot.room.id, protectedRoom.id);
    socket.send({ t: "leave_room" });
    await socket.waitFor("room_left");
    assert.equal((await admin.del(`${rootGrant}/${managerId}`)).status, 200);
    socket.send({ t: "join_room", roomId: protectedRoom.id });
    assert.equal((await socket.waitFor("error")).code, "room_password_required");
    assert.equal((await manager.patch(roomPath(sibling.id), { locked: false })).status, 403);
  } finally {
    await ctx.close();
  }
});

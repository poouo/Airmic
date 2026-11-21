import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AudioOverride, RoomSummary, UserSelf } from "@airmic/shared";
import { canManageArea, canManageRoomScope, ROLE_ORDER } from "@airmic/shared";
import { getClientIp } from "../lib/http.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { parseWith } from "../lib/validation.js";
import { requireAuth } from "../plugins/auth.js";
import { getHub } from "../realtime/instance.js";
import type { Services } from "../types.js";
import type { RoomInput, RoomRow } from "../services/rooms.js";

const audioOverrideSchema = z
  .object({
    preset: z.enum(["voice-low", "voice-standard", "voice-high", "music", "custom"]).optional(),
    bitrate: z.number().int().min(6000).max(160000).optional(),
    sampleRate: z.union([z.literal(16000), z.literal(24000), z.literal(32000), z.literal(48000)]).optional(),
    channels: z.union([z.literal(1), z.literal(2)]).optional(),
    dtx: z.boolean().optional(),
    fec: z.boolean().optional(),
    echoCancellation: z.boolean().optional(),
    noiseSuppression: z.boolean().optional(),
    autoGainControl: z.boolean().optional(),
  })
  .strict();

const createRoomSchema = z.object({
  name: z.string().trim().min(1, "房间名不能为空").max(40, "房间名最多 40 个字符"),
  description: z.string().max(200).optional(),
  areaId: z.number().int().positive().safe().optional(),
  category: z.string().trim().max(20).optional(),
  channel: z.string().trim().max(20).optional(),
  icon: z.string().trim().max(30).optional(),
  password: z.string().min(4, "房间密码至少 4 位").max(64).nullable().optional(),
  maxUsers: z.number().int().min(0).max(500).optional(),
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
  locked: z.boolean().optional(),
  screenShareEnabled: z.boolean().optional(),
  audioOverride: audioOverrideSchema.nullable().optional(),
});

const updateRoomSchema = createRoomSchema.partial();

function counts(): Map<number, number> {
  return getHub()?.getRoomCounts() ?? new Map<number, number>();
}

function allowsPersonalRooms(services: Services, user: UserSelf): boolean {
  const settings = services.settings.get();
  return user.isGuest ? settings.allowGuestRoomCreation : settings.allowRoomCreation;
}

function hasRoomScope(services: Services, user: UserSelf, row: RoomRow): boolean {
  return canManageRoomScope(user, { id: row.id, areaId: row.area_id }, services.roomDirectory.forUser(user.id));
}

function canEditRoom(services: Services, user: UserSelf, row: RoomRow): boolean {
  return hasRoomScope(services, user, row) || (row.created_by === user.id && allowsPersonalRooms(services, user));
}

function findRoom(services: Services, request: FastifyRequest): RoomRow {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isSafeInteger(id) || id < 1) throw badRequest("房间 ID 不正确");
  const row = services.rooms.findById(id);
  if (!row) throw notFound("房间不存在");
  return row;
}

function toRoomInput(body: z.infer<typeof createRoomSchema> | z.infer<typeof updateRoomSchema>): RoomInput {
  return {
    name: body.name,
    description: body.description,
    icon: body.icon,
    password: body.password,
    maxUsers: body.maxUsers,
    sortOrder: body.sortOrder,
    locked: body.locked,
    screenShareEnabled: body.screenShareEnabled,
    audioOverride: body.audioOverride as AudioOverride | null | undefined,
  };
}

export async function registerRoomRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get("/api/rooms", async (request): Promise<{ rooms: RoomSummary[] }> => {
    requireAuth(request);
    return { rooms: services.rooms.list(counts()) };
  });

  app.post("/api/rooms", async (request) => {
    const auth = requireAuth(request);
    const body = parseWith(createRoomSchema, request.body);
    const area = services.rooms.resolveArea(body);
    if (!area) throw badRequest("请选择已有的子区");
    if (!canManageArea(auth.user, area, services.roomDirectory.forUser(auth.user.id).grants) && !allowsPersonalRooms(services, auth.user)) {
      throw forbidden("没有权限在这个子区创建房间");
    }
    const settings = services.settings.get();
    if (settings.maxRooms > 0 && services.rooms.countRooms() >= settings.maxRooms) {
      throw forbidden("房间数量已达上限");
    }
    if (services.rooms.findByName(area.id, body.name)) throw conflict("该子区已有同名房间", "room_name_taken");
    const row = services.rooms.create({ ...toRoomInput(body), name: body.name, areaId: area.id }, auth.user.id);
    const summary = services.rooms.toSummary(row, 0);
    services.audit.log({
      actorId: auth.user.id,
      actorName: auth.user.displayName,
      action: "room_create",
      targetType: "room",
      targetId: row.id,
      targetName: row.name,
      ip: getClientIp(request),
    });
    getHub()?.broadcastRooms();
    return { room: summary };
  });

  app.get("/api/rooms/:id/settings", async (request) => {
    const { user } = requireAuth(request);
    const row = findRoom(services, request);
    if (!canEditRoom(services, user, row)) throw forbidden("没有权限编辑该房间");
    return { room: services.rooms.toDetail(row, counts().get(row.id) ?? 0) };
  });

  app.patch("/api/rooms/:id", async (request) => {
    const auth = requireAuth(request);
    const row = findRoom(services, request);
    if (!canEditRoom(services, auth.user, row)) throw forbidden("没有权限修改该房间");
    const body = parseWith(updateRoomSchema, request.body);
    const area = services.rooms.resolveArea(body, row);
    if (!area) throw badRequest("请选择已有的子区");
    const moved = area.id !== row.area_id;
    if (moved && !canManageArea(auth.user, area, services.roomDirectory.forUser(auth.user.id).grants)) {
      throw forbidden("没有权限将房间移到这个子区");
    }
    const duplicate = services.rooms.findByName(area.id, body.name ?? row.name);
    if (duplicate && duplicate.id !== row.id) throw conflict("该子区已有同名房间", "room_name_taken");
    const updated = services.rooms.update(row.id, { ...toRoomInput(body), areaId: moved ? area.id : undefined });
    if (!updated) throw notFound("房间不存在");
    services.audit.log({
      actorId: auth.user.id,
      actorName: auth.user.displayName,
      action: "room_update",
      targetType: "room",
      targetId: updated.id,
      targetName: updated.name,
      details: JSON.stringify(Object.keys(body)),
      ip: getClientIp(request),
    });
    getHub()?.broadcastRoomUpdate(row.id);
    getHub()?.broadcastRooms();
    return { room: services.rooms.toDetail(updated, counts().get(row.id) ?? 0) };
  });

  app.delete("/api/rooms/:id", async (request) => {
    const auth = requireAuth(request);
    const row = findRoom(services, request);
    const roomId = row.id;
    if (!canEditRoom(services, auth.user, row)) throw forbidden("没有权限删除该房间");
    services.rooms.remove(roomId);
    services.audit.log({
      actorId: auth.user.id,
      actorName: auth.user.displayName,
      action: "room_delete",
      targetType: "room",
      targetId: roomId,
      targetName: row.name,
      ip: getClientIp(request),
    });
    getHub()?.broadcastRoomDeleted(roomId, "房间已被管理员删除");
    getHub()?.broadcastRoomDirectoryChanged();
    return { ok: true };
  });

  app.post("/api/rooms/:id/members/:userId/kick", async (request) => {
    const { user } = requireAuth(request);
    const row = findRoom(services, request);
    if (!hasRoomScope(services, user, row)) throw forbidden("没有权限管理该房间的成员");
    const targetId = Number((request.params as { userId: string }).userId);
    if (!Number.isSafeInteger(targetId) || targetId < 1) throw badRequest("用户 ID 不正确");
    const target = services.users.findById(targetId);
    if (!target) throw notFound("用户不存在");
    if (targetId === user.id || ROLE_ORDER[target.role] < ROLE_ORDER[user.role] || target.role === "admin") {
      throw forbidden("无法将该用户移出房间");
    }
    const hub = getHub();
    if (!hub || hub.getRoomIdForUser(targetId) !== row.id || !hub.kick(targetId, "room", "你已被管理员请出房间")) {
      throw conflict("该用户已离开房间");
    }
    services.audit.log({
      actorId: user.id,
      actorName: user.displayName,
      action: "room_member_kick",
      targetType: "user",
      targetId,
      targetName: target.username,
      details: JSON.stringify({ roomId: row.id }),
      ip: getClientIp(request),
    });
    return { ok: true };
  });

  app.get("/api/rooms/:id/messages", async (request) => {
    const { user } = requireAuth(request);
    const room = findRoom(services, request);
    const query = request.query as { limit?: string; beforeId?: string };
    if (room.password_hash && getHub()?.getRoomIdForUser(user.id) !== room.id) throw forbidden("请先加入该房间");
    const limit = query.limit ? Math.min(200, Math.max(1, Number(query.limit))) : 50;
    const beforeId = query.beforeId ? Number(query.beforeId) : undefined;
    return { messages: services.rooms.listMessages(room.id, limit, beforeId) };
  });

  /** 校验房间密码（用于 UI 提前校验，可省略直接 join_room） */
  app.post("/api/rooms/:id/check-password", async (request) => {
    requireAuth(request);
    const roomId = Number((request.params as { id: string }).id);
    const row = services.rooms.findById(roomId);
    if (!row) throw notFound("房间不存在");
    const body = parseWith(z.object({ password: z.string().optional() }), request.body ?? {});
    if (!row.password_hash) return { ok: true, required: false };
    const ok = services.rooms.verifyPassword(row, body.password);
    return { ok, required: true };
  });
}

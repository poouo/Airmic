import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AudioOverride, AuthResponse, RoomSummary } from "@airmic/shared";
import { mergeAudioSettings, diffAudioSettings } from "@airmic/shared";
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
  category: z.string().trim().max(20).optional(),
  password: z.string().min(4, "房间密码至少 4 位").max(64).nullable().optional(),
  maxUsers: z.number().int().min(0).max(100).optional(),
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
  locked: z.boolean().optional(),
  screenShareEnabled: z.boolean().optional(),
  audioOverride: audioOverrideSchema.nullable().optional(),
});

const updateRoomSchema = createRoomSchema.partial();

function counts(services: Services): Map<number, number> {
  return getHub()?.getRoomCounts() ?? new Map<number, number>();
}

function canCreateRoom(services: Services, request: FastifyRequest): boolean {
  const auth = requireAuth(request);
  if (auth.user.permissions.includes("manage_rooms")) return true;
  const settings = services.settings.get();
  if (auth.user.role === "guest") return settings.allowGuestRoomCreation;
  return settings.allowRoomCreation;
}

function canEditRoom(services: Services, request: FastifyRequest, row: RoomRow): boolean {
  const auth = requireAuth(request);
  if (auth.user.permissions.includes("manage_rooms")) return true;
  const settings = services.settings.get();
  return settings.allowRoomCreation && row.created_by === auth.user.id;
}

function toRoomInput(body: z.infer<typeof createRoomSchema> | z.infer<typeof updateRoomSchema>): RoomInput {
  return {
    name: body.name,
    description: body.description,
    category: body.category,
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
    return { rooms: services.rooms.list(counts(services)) };
  });

  app.post("/api/rooms", async (request) => {
    const auth = requireAuth(request);
    if (!canCreateRoom(services, request)) throw forbidden("当前服务器不允许你创建房间");
    const settings = services.settings.get();
    if (settings.maxRooms > 0 && services.rooms.countRooms() >= settings.maxRooms) {
      throw forbidden("房间数量已达上限");
    }
    const body = parseWith(createRoomSchema, request.body);
    if (services.rooms.findByName(body.name)) throw conflict("房间名已存在", "room_name_taken");
    const row = services.rooms.create({ ...toRoomInput(body), name: body.name }, auth.user.id);
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

  app.patch("/api/rooms/:id", async (request) => {
    const auth = requireAuth(request);
    const roomId = Number((request.params as { id: string }).id);
    if (!Number.isFinite(roomId)) throw badRequest("房间 ID 不正确");
    const row = services.rooms.findById(roomId);
    if (!row) throw notFound("房间不存在");
    if (!canEditRoom(services, request, row)) throw forbidden("没有权限修改该房间");
    const body = parseWith(updateRoomSchema, request.body);
    if (body.name && body.name.toLowerCase() !== row.name.toLowerCase()) {
      if (services.rooms.findByName(body.name)) throw conflict("房间名已存在", "room_name_taken");
    }
    const updated = services.rooms.update(roomId, toRoomInput(body));
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
    getHub()?.broadcastRoomUpdate(roomId);
    getHub()?.broadcastRooms();
    return { room: services.rooms.toDetail(updated, counts(services).get(roomId) ?? 0) };
  });

  app.delete("/api/rooms/:id", async (request) => {
    const auth = requireAuth(request);
    const roomId = Number((request.params as { id: string }).id);
    if (!Number.isFinite(roomId)) throw badRequest("房间 ID 不正确");
    const row = services.rooms.findById(roomId);
    if (!row) throw notFound("房间不存在");
    if (!canEditRoom(services, request, row)) throw forbidden("没有权限删除该房间");
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
    getHub()?.broadcastRooms();
    return { ok: true };
  });

  app.get("/api/rooms/:id/messages", async (request) => {
    requireAuth(request);
    const roomId = Number((request.params as { id: string }).id);
    const query = request.query as { limit?: string; beforeId?: string };
    if (!Number.isFinite(roomId)) throw badRequest("房间 ID 不正确");
    if (!services.rooms.findById(roomId)) throw notFound("房间不存在");
    const limit = query.limit ? Math.min(200, Math.max(1, Number(query.limit))) : 50;
    const beforeId = query.beforeId ? Number(query.beforeId) : undefined;
    return { messages: services.rooms.listMessages(roomId, limit, beforeId) };
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
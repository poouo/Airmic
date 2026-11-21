import type { FastifyInstance, FastifyRequest } from "fastify";
import { canManageArea } from "@airmic/shared";
import type { RoomManagementScope } from "@airmic/shared";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { getClientIp } from "../lib/http.js";
import { parseWith } from "../lib/validation.js";
import { requireAuth } from "../plugins/auth.js";
import { getHub } from "../realtime/instance.js";
import type { Services } from "../types.js";

const idSchema = z.number().int().positive().safe();
const urlIdSchema = z.string().regex(/^\d+$/).pipe(z.coerce.number().int().positive().safe());
const nameSchema = z.string().trim().min(1, "名称不能为空").max(20, "名称最多 20 个字符");
const createAreaSchema = z.object({ parentId: idSchema.nullable(), name: nameSchema });
const updateAreaSchema = z.object({ name: nameSchema.optional(), sortOrder: z.number().int().min(-100000).max(100000).optional() });
const scopeSchema = z.object({ kind: z.enum(["area", "room"]), id: urlIdSchema });

export async function registerRoomDirectoryRoutes(app: FastifyInstance, services: Services): Promise<void> {
  const directory = services.roomDirectory;
  const admin = { preHandler: app.requirePermission("manage_server") };

  function findArea(id: number) {
    const area = directory.find(id);
    if (!area) throw notFound("分区不存在");
    return area;
  }

  function findScope(request: FastifyRequest): RoomManagementScope {
    const scope = parseWith(scopeSchema, request.params);
    if (scope.kind === "area") findArea(scope.id);
    else if (!services.rooms.findById(scope.id)) throw notFound("房间不存在");
    return scope;
  }

  function log(request: FastifyRequest, action: string, scope: RoomManagementScope, name?: string, userId?: number) {
    const { user } = requireAuth(request);
    services.audit.log({
      actorId: user.id,
      actorName: user.displayName,
      action,
      targetType: scope.kind,
      targetId: scope.id,
      targetName: name,
      details: userId === undefined ? undefined : JSON.stringify({ userId }),
      ip: getClientIp(request),
    });
  }

  app.get("/api/room-directory", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return directory.forUser(requireAuth(request).user.id);
  });

  app.post("/api/room-directory/areas", async (request) => {
    const { user } = requireAuth(request);
    const { parentId, name } = parseWith(createAreaSchema, request.body);
    if (parentId === null) {
      if (!user.permissions.includes("manage_server")) throw forbidden("只有服务器管理员可以创建一级分区");
    } else {
      const parent = findArea(parentId);
      if (parent.parentId !== null) throw badRequest("子区下面只能创建房间");
      if (!canManageArea(user, parent, directory.forUser(user.id).grants)) throw forbidden("没有权限在该分区下创建子区");
    }
    if (directory.findByName(parentId, name)) throw conflict("此处已有同名分区");
    const area = directory.create(parentId, name);
    log(request, "room_area_create", { kind: "area", id: area.id }, area.name);
    getHub()?.broadcastRoomDirectoryChanged();
    return { area };
  });

  app.patch("/api/room-directory/areas/:id", async (request) => {
    const { user } = requireAuth(request);
    const area = findArea(parseWith(z.object({ id: urlIdSchema }), request.params).id);
    if (!canManageArea(user, area, directory.forUser(user.id).grants)) throw forbidden("没有权限修改该分区");
    const body = parseWith(updateAreaSchema, request.body);
    const name = body.name ?? area.name;
    const duplicate = directory.findByName(area.parentId, name);
    if (duplicate && duplicate.id !== area.id) throw conflict("此处已有同名分区");
    const updated = directory.update(area, name, body.sortOrder ?? area.sortOrder);
    log(request, "room_area_update", { kind: "area", id: area.id }, name);
    const hub = getHub();
    hub?.broadcastRoomDirectoryChanged();
    if (hub && name !== area.name) {
      const areaIds = new Set([area.id, ...directory.list().filter((item) => item.parentId === area.id).map((item) => item.id)]);
      const counts = hub.getRoomCounts();
      for (const room of services.rooms.list(counts)) {
        if (areaIds.has(room.areaId) && counts.has(room.id)) hub.broadcastRoomUpdate(room.id);
      }
      hub.broadcastRooms();
    }
    return { area: updated };
  });

  app.delete("/api/room-directory/areas/:id", async (request) => {
    const { user } = requireAuth(request);
    const area = findArea(parseWith(z.object({ id: urlIdSchema }), request.params).id);
    const allowed = area.parentId === null
      ? user.permissions.includes("manage_server")
      : canManageArea(user, findArea(area.parentId), directory.forUser(user.id).grants);
    if (!allowed) throw forbidden("只有上级分区的管理者可以删除该分区");
    if (!directory.isEmpty(area.id)) throw conflict("请先移走或删除分区内的房间，并删除子区");
    directory.remove(area.id);
    log(request, "room_area_delete", { kind: "area", id: area.id }, area.name);
    getHub()?.broadcastRoomDirectoryChanged();
    return { ok: true };
  });

  const managersUrl = "/api/room-directory/:kind/:id/managers";
  app.get(managersUrl, admin, async (request) => ({ managers: directory.managers(findScope(request)) }));

  app.post(managersUrl, admin, async (request) => {
    const scope = findScope(request);
    const { username } = parseWith(z.object({ username: z.string().trim().min(1).max(60) }), request.body);
    const target = services.users.findByUsername(username);
    if (!target) throw notFound("找不到该用户名");
    if (target.is_guest || target.role !== "user") throw badRequest("请给普通注册用户分配该权限");
    directory.grant(scope, target.id);
    log(request, "room_manager_grant", scope, undefined, target.id);
    getHub()?.broadcastRoomDirectoryChanged(target.id);
    return { managers: directory.managers(scope) };
  });

  app.delete(managersUrl + "/:userId", admin, async (request) => {
    const scope = findScope(request);
    const { userId } = parseWith(z.object({ userId: urlIdSchema }), request.params);
    directory.revoke(scope, userId);
    log(request, "room_manager_revoke", scope, undefined, userId);
    getHub()?.broadcastRoomDirectoryChanged(userId);
    return { managers: directory.managers(scope) };
  });
}

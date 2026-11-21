import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AdminAuditResponse,
  AdminBanListResponse,
  AdminOverviewResponse,
  AdminRoomsResponse,
  AdminSessionRow,
  AdminSessionsResponse,
  AdminSettingsResponse,
  AdminUserListResponse,
  AdminUserRow,
  AudioPresetId,
  AudioSettings,
  BanRow,
  CreateBanRequest,
  ForceMuteRequest,
  KickUserRequest,
  MoveUserRequest,
  OnlineUser,
  RegistrationMode,
  Role,
  RoomDetail,
  ServerSettings,
  UpdateBanRequest,
  UpdateSettingsRequest,
  UpdateUserRequest,
} from "@airmic/shared";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { getClientIp } from "../lib/http.js";
import { isExpired, nowIso, secondsSince } from "../lib/time.js";
import { displayNameSchema, paginationSchema, parseWith, statusTextSchema } from "../lib/validation.js";
import { requireAuth } from "../plugins/auth.js";
import { getHub } from "../realtime/instance.js";
import type { UserRow } from "../services/users.js";
import type { Services } from "../types.js";

// ============ 校验 schema ============

const roleSchema = z.enum(["admin", "moderator", "user", "guest"], {
  errorMap: () => ({ message: "角色不正确" }),
});

const registrationModeSchema = z.enum(["open", "invite", "closed"], {
  errorMap: () => ({ message: "注册模式不正确" }),
});

const audioPresetSchema = z.enum(["voice-low", "voice-standard", "voice-high", "music", "custom"], {
  errorMap: () => ({ message: "音质预设不正确" }),
});

const sampleRateSchema = z.custom<AudioSettings["sampleRate"]>(
  (value) => value === 16000 || value === 24000 || value === 32000 || value === 48000,
  { message: "采样率不正确" },
);

const channelsSchema = z.custom<AudioSettings["channels"]>((value) => value === 1 || value === 2, {
  message: "声道数只能为 1 或 2",
});

/** 音质字段全部可选：服务端会以当前默认音质为基准合并 */
const audioSettingsPatchSchema = z
  .object({
    preset: audioPresetSchema,
    bitrate: z
      .number({ required_error: "码率不能为空", invalid_type_error: "码率必须为数字" })
      .int("码率必须为整数")
      .min(6000, "码率不能低于 6000")
      .max(160000, "码率不能高于 160000"),
    sampleRate: sampleRateSchema,
    channels: channelsSchema,
    dtx: z.boolean({ required_error: "dtx 不能为空", invalid_type_error: "dtx 必须为布尔值" }),
    fec: z.boolean({ required_error: "fec 不能为空", invalid_type_error: "fec 必须为布尔值" }),
    echoCancellation: z.boolean({ required_error: "回声消除开关不能为空", invalid_type_error: "回声消除开关必须为布尔值" }),
    noiseSuppression: z.boolean({ required_error: "降噪开关不能为空", invalid_type_error: "降噪开关必须为布尔值" }),
    autoGainControl: z.boolean({ required_error: "自动增益开关不能为空", invalid_type_error: "自动增益开关必须为布尔值" }),
  })
  .partial();

const iceServerSchema = z.object({
  urls: z.union(
    [
      z.string().trim().min(1, "ICE 地址不能为空").max(300, "ICE 地址最多 300 个字符"),
      z
        .array(z.string().trim().min(1, "ICE 地址不能为空").max(300, "ICE 地址最多 300 个字符"))
        .min(1, "至少提供一个 ICE 地址")
        .max(10, "单个 ICE 服务器最多 10 个地址"),
    ],
    { errorMap: () => ({ message: "ICE 地址格式不正确" }) },
  ),
  username: z.string().trim().max(200, "ICE 用户名最多 200 个字符").optional(),
  credential: z.string().trim().max(300, "ICE 凭据最多 300 个字符").optional(),
});

const updateSettingsSchema = z.object({
  name: z.string().trim().min(1, "服务器名称不能为空").max(60, "服务器名称最多 60 个字符").optional(),
  motd: z.string().max(500, "服务器公告最多 500 个字符").optional(),
  registrationMode: registrationModeSchema.optional(),
  registrationCode: z.string().trim().max(32, "邀请码最多 32 个字符").optional(),
  guestEnabled: z.boolean({ invalid_type_error: "游客开关必须为布尔值" }).optional(),
  maxUsers: z.number({ invalid_type_error: "服务器人数上限必须为数字" }).int().min(1, "服务器人数上限不能小于 1").max(10000, "服务器人数上限不能大于 10000").optional(),
  maxUsersPerRoom: z.number({ invalid_type_error: "房间人数上限必须为数字" }).int().min(1, "房间人数上限不能小于 1").max(500, "房间人数上限不能大于 500").optional(),
  maxRooms: z.number({ invalid_type_error: "房间数量上限必须为数字" }).int().min(0, "房间数量上限不能小于 0").max(1000, "房间数量上限不能大于 1000").optional(),
  allowRoomCreation: z.boolean({ invalid_type_error: "创建房间开关必须为布尔值" }).optional(),
  allowGuestRoomCreation: z.boolean({ invalid_type_error: "游客创建房间开关必须为布尔值" }).optional(),
  allowScreenShare: z.boolean({ invalid_type_error: "屏幕共享开关必须为布尔值" }).optional(),
  allowTextChat: z.boolean({ invalid_type_error: "文字聊天开关必须为布尔值" }).optional(),
  allowGuestChat: z.boolean({ invalid_type_error: "游客聊天开关必须为布尔值" }).optional(),
  maxChatLength: z.number({ invalid_type_error: "聊天长度上限必须为数字" }).int().min(20, "聊天长度上限不能小于 20").max(5000, "聊天长度上限不能大于 5000").optional(),
  maxMessagesPerRoom: z.number({ invalid_type_error: "房间消息保留数必须为数字" }).int().min(0, "房间消息保留数不能小于 0").max(5000, "房间消息保留数不能大于 5000").optional(),
  defaultAudioSettings: audioSettingsPatchSchema.optional(),
  iceServers: z.array(iceServerSchema).max(20, "最多 20 个 ICE 服务器").optional(),
  forceRelay: z.boolean({ invalid_type_error: "强制中继开关必须为布尔值" }).optional(),
  livekitUrl: z.string().trim().max(300, "LiveKit 地址最多 300 个字符").optional(),
  livekitApiKey: z.string().trim().max(200, "LiveKit API Key 最多 200 个字符").optional(),
  livekitApiSecret: z.string().trim().max(300, "LiveKit API Secret 最多 300 个字符").optional(),
  roomCategories: z
    .array(z.string().trim().min(1, "分类名称不能为空").max(20, "分类名称最多 20 个字符"))
    .max(20, "最多 20 个房间分类")
    .optional(),
});

const listUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(64, "搜索关键字最多 64 个字符").optional(),
  role: roleSchema.optional(),
});

const updateUserRequestSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    role: roleSchema.optional(),
    statusText: statusTextSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "请提供要更新的字段" });

const kickUserRequestSchema = z.object({
  scope: z.enum(["server", "room"], { errorMap: () => ({ message: "踢出范围只能为 server 或 room" }) }).default("server"),
  reason: z.string({ invalid_type_error: "踢出原因必须为字符串" }).trim().max(200, "踢出原因最多 200 个字符").optional(),
});

const forceMuteRequestSchema = z.object({
  muted: z.boolean({ required_error: "静音状态不能为空", invalid_type_error: "静音状态必须为布尔值" }),
  reason: z.string({ invalid_type_error: "静音原因必须为字符串" }).trim().max(200, "静音原因最多 200 个字符").optional(),
});

const moveUserRequestSchema = z.object({
  roomId: z
    .number({ required_error: "缺少目标房间 ID", invalid_type_error: "房间 ID 必须为数字" })
    .int("房间 ID 必须为整数")
    .positive("房间 ID 不正确")
    .nullable(),
});

const ipAddressSchema = z
  .string({ required_error: "IP 地址不能为空", invalid_type_error: "IP 地址必须为字符串" })
  .trim()
  .refine((value) => isIP(value) !== 0, "IP 地址格式不正确");

const createBanRequestSchema = z
  .object({
    userId: z
      .number({ invalid_type_error: "用户 ID 必须为数字" })
      .int("用户 ID 必须为整数")
      .positive("用户 ID 不正确")
      .optional(),
    ip: ipAddressSchema.optional(),
    reason: z
      .string({ required_error: "封禁原因不能为空", invalid_type_error: "封禁原因必须为字符串" })
      .trim()
      .min(1, "封禁原因不能为空")
      .max(200, "封禁原因最多 200 个字符"),
    durationMinutes: z
      .number({ invalid_type_error: "封禁时长必须为数字" })
      .int("封禁时长必须为整数")
      .min(0, "封禁时长不能为负数")
      .max(5_256_000, "封禁时长过长")
      .optional(),
  })
  .refine((value) => value.userId !== undefined || (value.ip !== undefined && value.ip.length > 0), {
    message: "请提供要封禁的用户 ID 或 IP 地址",
  });

const updateBanRequestSchema = z.object({
  active: z.boolean({ required_error: "active 不能为空", invalid_type_error: "active 必须为布尔值" }),
});

const listBansQuerySchema = paginationSchema.extend({
  active: z
    .enum(["true", "false", "1", "0"], { errorMap: () => ({ message: "active 参数只能为 true 或 false" }) })
    .optional(),
});

const listAuditQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(64, "操作类型最多 64 个字符").optional(),
});

// ============ 工具函数 ============

function parseIdParam(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw badRequest(label + " ID 不正确");
  return value;
}

function getRoomCounts(): Map<number, number> {
  return getHub()?.getRoomCounts() ?? new Map<number, number>();
}

function buildOnlineMap(): Map<number, OnlineUser> {
  const map = new Map<number, OnlineUser>();
  const hub = getHub();
  if (!hub) return map;
  for (const user of hub.getOnlineUsers()) map.set(user.userId, user);
  return map;
}

function toAdminUserRow(
  services: Services,
  row: UserRow,
  onlineMap: Map<number, OnlineUser>,
  roomNames: Map<number, string | null>,
): AdminUserRow {
  const onlineInfo = onlineMap.get(row.id);
  const roomId = onlineInfo?.roomId ?? null;
  let roomName: string | null = null;
  if (roomId !== null) {
    if (!roomNames.has(roomId)) roomNames.set(roomId, services.rooms.findById(roomId)?.name ?? null);
    roomName = roomNames.get(roomId) ?? null;
  }
  const banned = row.is_banned === 1 && !isExpired(row.banned_until);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isGuest: row.is_guest === 1,
    avatarColor: row.avatar_color,
    avatarEmoji: row.avatar_emoji,
    statusText: row.status_text,
    createdAt: row.created_at,
    isBanned: banned,
    banReason: banned ? row.ban_reason : null,
    bannedUntil: banned ? row.banned_until : null,
    lastSeenAt: row.last_seen_at,
    lastIp: row.last_ip,
    online: onlineInfo !== undefined,
    roomId,
    roomName,
  };
}

interface SessionJoinRow {
  id: number;
  user_id: number;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  username: string;
  display_name: string;
  role: Role;
  is_guest: number;
}

/** 管理后台接口 */
export async function registerAdminRoutes(app: FastifyInstance, services: Services): Promise<void> {
  // ---------- 仪表盘 ----------

  app.get(
    "/api/admin/overview",
    { preHandler: app.requirePermission("manage_server") },
    async (): Promise<AdminOverviewResponse> => {
      const hub = getHub();
      const messageCount = Number(
        services.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM messages")?.count ?? 0,
      );
      const activeBans = Number(
        services.db.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM bans WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?)",
          nowIso(),
        )?.count ?? 0,
      );
      return {
        stats: {
          users: services.users.countUsers(),
          guests: services.users.countGuests(),
          online: hub?.getOnlineCount() ?? 0,
          peakOnline: hub?.getPeakOnline() ?? 0,
          rooms: services.rooms.countRooms(),
          messages: messageCount,
          activeBans,
          uptimeSeconds: secondsSince(services.startedAt),
          startedAt: services.startedAt,
        },
        onlineUsers: hub?.getOnlineUsers() ?? [],
        recentAudit: services.audit.recent(8),
        rooms: services.rooms.list(hub?.getRoomCounts() ?? new Map<number, number>()),
      };
    },
  );

  // ---------- 服务器设置 ----------

  app.get(
    "/api/admin/settings",
    { preHandler: app.requirePermission("manage_server") },
    async (): Promise<AdminSettingsResponse> => {
      return { settings: services.settings.get() };
    },
  );

  app.patch(
    "/api/admin/settings",
    { preHandler: app.requirePermission("manage_server") },
    async (request): Promise<AdminSettingsResponse> => {
      const auth = requireAuth(request);
      const body: UpdateSettingsRequest = parseWith(updateSettingsSchema, request.body ?? {}) as UpdateSettingsRequest;
      const before = services.settings.get();
      // defaultAudioSettings 支持部分字段，SettingsService 会以当前默认音质为基准合并
      const updated = services.settings.update(body as unknown as Partial<ServerSettings>);
      const changed = (Object.keys(updated) as (keyof ServerSettings)[]).filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(updated[key]),
      );
      services.audit.log({
        actorId: auth.user.id,
        actorName: auth.user.displayName,
        action: "settings_update",
        targetType: "settings",
        details: JSON.stringify({ fields: changed }),
        ip: getClientIp(request),
      });
      getHub()?.broadcastServerSettings();
      return { settings: updated };
    },
  );

  // ---------- 用户管理 ----------

  app.get(
    "/api/admin/users",
    { preHandler: app.requirePermission("manage_users") },
    async (request): Promise<AdminUserListResponse> => {
      const query = parseWith(listUsersQuerySchema, request.query);
      const { rows, total } = services.users.listRegistered({
        search: query.search || undefined,
        page: query.page,
        pageSize: query.pageSize,
        role: query.role,
      });
      const onlineMap = buildOnlineMap();
      const roomNames = new Map<number, string | null>();
      const users = rows.map((row) => toAdminUserRow(services, row, onlineMap, roomNames));
      // shared 的 AdminUserListResponse 继承 Paginated（字段名为 items），
      // 同时附带 users 以兼容任务/前端约定的字段名。
      return {
        items: users,
        users,
        total,
        page: query.page,
        pageSize: query.pageSize,
        onlineCount: [...onlineMap.values()].filter((user) => !user.isGuest).length,
      } as AdminUserListResponse & { users: AdminUserRow[] };
    },
  );

  app.patch(
    "/api/admin/users/:id",
    { preHandler: app.requirePermission("manage_users") },
    async (request): Promise<{ user: AdminUserRow }> => {
      const auth = requireAuth(request);
      const userId = parseIdParam((request.params as { id: string }).id, "用户");
      const body: UpdateUserRequest = parseWith(updateUserRequestSchema, request.body ?? {});
      const target = services.users.findById(userId);
      if (!target) throw notFound("用户不存在");

      if (body.role !== undefined && body.role !== target.role) {
        if (target.role === "admin" && body.role !== "admin" && services.users.countAdmins() <= 1) {
          throw badRequest("不能降级最后一名管理员，服务器至少需要保留一名管理员");
        }
        services.users.updateRole(userId, body.role);
      }
      if (body.displayName !== undefined || body.statusText !== undefined) {
        services.users.updateProfile(userId, {
          displayName: body.displayName,
          statusText: body.statusText,
        });
      }
      const updated = services.users.findById(userId);
      if (!updated) throw notFound("用户不存在");

      services.audit.log({
        actorId: auth.user.id,
        actorName: auth.user.displayName,
        action: "user_update",
        targetType: "user",
        targetId: updated.id,
        targetName: updated.username,
        details: JSON.stringify({ fields: Object.keys(body) }),
        ip: getClientIp(request),
      });
      getHub()?.refreshUser(userId);

      return { user: toAdminUserRow(services, updated, buildOnlineMap(), new Map<number, string | null>()) };
    },
  );

  app.delete(
    "/api/admin/users/:id",
    { preHandler: app.requirePermission("manage_users") },
    async (request): Promise<{ ok: true }> => {
      const auth = requireAuth(request);
      const userId = parseIdParam((request.params as { id: string }).id, "用户");
      if (userId === auth.user.id) throw badRequest("不能删除自己的账号");
      const target = services.users.findById(userId);
      if (!target) throw notFound("用户不存在");
      if (target.role === "admin" && services.users.countAdmins() <= 1) {
        throw badRequest("不能删除最后一名管理员，服务器至少需要保留一名管理员");
      }

      services.auth.revokeUserSessions(userId);
      getHub()?.disconnectUser(userId, "账号已被删除");
      services.users.delete(userId);
      services.audit.log({
        actorId: auth.user.id,
        actorName: auth.user.displayName,
        action: "user_delete",
        targetType: "user",
        targetId: userId,
        targetName: target.username,
        details: JSON.stringify({ username: target.username }),
        ip: getClientIp(request),
      });
      return { ok: true };
    },
  );

  app.post(
    "/api/admin/users/:id/kick",
    { preHandler: app.requirePermission("kick_users") },
    async (request): Promise<{ ok: true }> => {
      const auth = requireAuth(request);
      const userId = parseIdParam((request.params as { id: string }).id, "用户");
      const body: KickUserRequest = parseWith(kickUserRequestSchema, request.body ?? {});
      const target = services.users.findById(userId);
      const hub = getHub();
      if (!hub || !hub.isOnline(userId)) throw conflict("该用户当前不在线");
      const scope = body.scope ?? "server";
      const reason = body.reason?.trim() || (scope === "room" ? "你已被管理员请出房间" : "你已被管理员踢出服务器");
      hub.kick(userId, scope, reason);
      services.audit.log({
        actorId: auth.user.id,
        actorName: auth.user.displayName,
        action: "user_kick",
        targetType: "user",
        targetId: userId,
        targetName: target?.username ?? String(userId),
        details: JSON.stringify({ scope, reason }),
        ip: getClientIp(request),
      });
      return { ok: true };
    },
  );

  app.post(
    "/api/admin/users/:id/mute",
    { preHandler: app.requirePermission("moderate_voice") },
    async (request): Promise<{ ok: true }> => {
      const auth = requireAuth(request);
      const userId = parseIdParam((request.params as { id: string }).id, "用户");
      const body: ForceMuteRequest = parseWith(forceMuteRequestSchema, request.body ?? {});
      const target = services.users.findById(userId);
      const hub = getHub();
      if (!hub || !hub.isOnline(userId)) throw conflict("该用户当前不在线");
      const reason = body.reason?.trim() || undefined;
      hub.forceMute(userId, body.muted, reason);
      services.audit.log({
        actorId: auth.user.id,
        actorName: auth.user.displayName,
        action: "user_mute",
        targetType: "user",
        targetId: userId,
        targetName: target?.username ?? String(userId),
        details: JSON.stringify({ muted: body.muted, reason: reason ?? null }),
        ip: getClientIp(request),
      });
      return { ok: true };
    },
  );

  app.post(
    "/api/admin/users/:id/move",
    { preHandler: app.requirePermission("moderate_voice") },
    async (request): Promise<{ ok: true }> => {
      const auth = requireAuth(request);
      const userId = parseIdParam((request.params as { id: string }).id, "用户");
      const body: MoveUserRequest = parseWith(moveUserRequestSchema, request.body ?? {});
      const target = services.users.findById(userId);
      if (!target) throw notFound("用户不存在");
      const hub = getHub();
      let roomName: string | null = null;
      if (body.roomId !== null) {
        const room = services.rooms.findById(body.roomId);
        if (!room) throw notFound("房间不存在");
        if (target.is_guest === 1 && room.allow_guests === 0 && hub?.getRoomIdForUser(userId) !== room.id) {
          throw forbidden("该房间仅限注册用户进入", "room_guests_disabled");
        }
        roomName = room.name;
      }
      if (hub && !hub.moveToRoom(userId, body.roomId)) {
        throw conflict("移动失败，该用户可能不在线或目标房间已满");
      }
      services.audit.log({
        actorId: auth.user.id,
        actorName: auth.user.displayName,
        action: "user_move",
        targetType: "user",
        targetId: userId,
        targetName: target.username,
        details: JSON.stringify({ roomId: body.roomId, roomName }),
        ip: getClientIp(request),
      });
      return { ok: true };
    },
  );

  // ---------- 封禁管理 ----------

  app.get(
    "/api/admin/bans",
    { preHandler: app.requirePermission("ban_users") },
    async (request): Promise<AdminBanListResponse> => {
      const query = parseWith(listBansQuerySchema, request.query);
      const active = query.active === undefined ? undefined : query.active === "true" || query.active === "1";
      const result = services.bans.list({ active, page: query.page, pageSize: query.pageSize });
      return { items: result.items, total: result.total, page: query.page, pageSize: query.pageSize };
    },
  );

  app.post(
    "/api/admin/bans",
    { preHandler: app.requirePermission("ban_users") },
    async (request): Promise<{ ban: BanRow }> => {
      const auth = requireAuth(request);
      const body: CreateBanRequest = parseWith(createBanRequestSchema, request.body ?? {});
      const ip = body.ip ?? null;

      let target: UserRow | undefined;
      if (body.userId !== undefined) {
        target = services.users.findById(body.userId);
        if (!target) throw notFound("用户不存在");
        if (target.id === auth.user.id) throw badRequest("不能封禁自己的账号");
        if (target.role === "admin") throw badRequest("不能封禁管理员账号");
      }
      if (target === undefined && ip === null) throw badRequest("请提供要封禁的用户 ID 或 IP 地址");

      const ban = services.bans.create({
        userId: target?.id ?? null,
        username: target?.username ?? null,
        ip,
        reason: body.reason,
        durationMinutes: body.durationMinutes,
        bannedById: auth.user.id,
      });

      if (target) {
        services.auth.revokeUserSessions(target.id);
        getHub()?.disconnectUser(target.id, "你已被封禁：" + body.reason);
      }
      services.audit.log({
        actorId: auth.user.id,
        actorName: auth.user.displayName,
        action: "ban_create",
        targetType: target ? "user" : "ip",
        targetId: target ? target.id : ip,
        targetName: target?.username ?? ip,
        details: JSON.stringify({
          reason: body.reason,
          durationMinutes: body.durationMinutes ?? 0,
          ip,
          username: target?.username ?? null,
        }),
        ip: getClientIp(request),
      });
      return { ban };
    },
  );

  app.patch(
    "/api/admin/bans/:id",
    { preHandler: app.requirePermission("ban_users") },
    async (request): Promise<{ ban: BanRow }> => {
      const auth = requireAuth(request);
      const banId = parseIdParam((request.params as { id: string }).id, "封禁记录");
      const body: UpdateBanRequest = parseWith(updateBanRequestSchema, request.body ?? {});
      if (body.active !== false) throw badRequest("只能执行解除封禁操作（active 必须为 false）");
      const existing = services.bans.findById(banId);
      if (!existing) throw notFound("封禁记录不存在");
      if (existing.active === 0) throw badRequest("该封禁已经解除，无需重复操作");

      services.bans.revoke(banId);
      const bannedByName = existing.banned_by
        ? services.users.findById(existing.banned_by)?.display_name ?? null
        : null;
      const ban: BanRow = {
        id: existing.id,
        userId: existing.user_id,
        username: existing.username,
        ip: existing.ip,
        reason: existing.reason,
        active: false,
        createdAt: existing.created_at,
        expiresAt: existing.expires_at,
        bannedById: existing.banned_by,
        bannedByName,
      };
      services.audit.log({
        actorId: auth.user.id,
        actorName: auth.user.displayName,
        action: "ban_revoke",
        targetType: "ban",
        targetId: existing.id,
        targetName: existing.username ?? existing.ip,
        details: JSON.stringify({ userId: existing.user_id, username: existing.username }),
        ip: getClientIp(request),
      });
      return { ban };
    },
  );

  // ---------- 审计与会话 ----------

  app.get(
    "/api/admin/audit",
    { preHandler: app.requirePermission("view_audit") },
    async (request): Promise<AdminAuditResponse> => {
      const query = parseWith(listAuditQuerySchema, request.query);
      const result = services.audit.list({
        page: query.page,
        pageSize: query.pageSize,
        action: query.action || undefined,
      });
      return { items: result.items, total: result.total, page: query.page, pageSize: query.pageSize };
    },
  );

  app.get(
    "/api/admin/sessions",
    { preHandler: app.requirePermission("manage_users") },
    async (): Promise<AdminSessionsResponse> => {
      const rows = services.db.all<SessionJoinRow>(
        "SELECT s.id, s.user_id, s.ip, s.user_agent, s.created_at, s.last_seen_at, s.expires_at, " +
          "u.username, u.display_name, u.role, u.is_guest " +
          "FROM sessions s JOIN users u ON u.id = s.user_id " +
          "WHERE s.revoked = 0 AND s.expires_at > ? ORDER BY s.last_seen_at DESC LIMIT 200",
        nowIso(),
      );
      const sessions: AdminSessionRow[] = rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        isGuest: row.is_guest === 1,
        ip: row.ip,
        userAgent: row.user_agent,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
      }));
      return { sessions };
    },
  );

  // ---------- 房间详情 ----------

  app.get(
    "/api/admin/rooms",
    { preHandler: app.requirePermission("manage_server") },
    async (): Promise<AdminRoomsResponse> => {
      const counts = getRoomCounts();
      const rooms: RoomDetail[] = [];
      for (const summary of services.rooms.list(counts)) {
        const row = services.rooms.findById(summary.id);
        if (!row) continue;
        rooms.push(services.rooms.toDetail(row, counts.get(row.id) ?? 0));
      }
      return { rooms };
    },
  );
}

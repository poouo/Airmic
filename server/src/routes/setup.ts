import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SetupInitializeResponse, SetupStatusResponse } from "@airmic/shared";
import { AUTH_COOKIE } from "../services/auth.js";
import { getClientIp, getUserAgent } from "../lib/http.js";
import { globalRateLimiter } from "../lib/rate-limit.js";
import { parseWith } from "../lib/validation.js";
import { conflict, forbidden, tooManyRequests } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { getHub } from "../realtime/instance.js";
import type { Services } from "../types.js";
import type { ServerSettings } from "@airmic/shared";

const audioSettingsSchema = z
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

const setupSchema = z.object({
  token: z.string().max(200).optional(),
  admin: z.object({
    username: z
      .string()
      .trim()
      .min(3, "管理员用户名至少 3 个字符")
      .max(24, "管理员用户名最多 24 个字符")
      .regex(/^[a-zA-Z0-9_-]+$/, "管理员用户名只能包含字母、数字、下划线和短横线"),
    password: z.string().min(6, "管理员密码至少 6 位").max(128, "管理员密码最多 128 位"),
    displayName: z.string().trim().min(1, "管理员昵称不能为空").max(24, "管理员昵称最多 24 个字符").optional(),
  }),
  server: z
    .object({
      name: z.string().trim().min(1).max(60).optional(),
      motd: z.string().max(500).optional(),
      registrationMode: z.enum(["open", "invite", "closed"]).optional(),
      guestEnabled: z.boolean().optional(),
      maxUsers: z.number().int().min(1).max(10000).optional(),
      maxUsersPerRoom: z.number().int().min(1).max(500).optional(),
      defaultAudioSettings: audioSettingsSchema.optional(),
      allowGuestChat: z.boolean().optional(),
      livekitUrl: z.string().max(300).optional(),
      livekitApiKey: z.string().max(200).optional(),
      livekitApiSecret: z.string().max(300).optional(),
    })
    .strict()
    .optional(),
  createDefaultRooms: z.boolean().optional(),
});

const DEFAULT_ROOMS = [
  { name: "开黑大厅", description: "默认语音大厅，欢迎开麦交流", category: "开黑房间" },
  { name: "休息室", description: "挂机、聊天、听歌", category: "休息室" },
];

let setupInProgress = false;

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 部署后的初始化引导接口（仅在没有任何管理员时可用） */
export async function registerSetupRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get("/api/setup/status", async (): Promise<SetupStatusResponse> => {
    return {
      setupRequired: services.settings.setupRequired(),
      requiresToken: services.config.setupToken !== null,
      server: services.settings.getPublic(),
    };
  });

  app.post("/api/setup/initialize", async (request: FastifyRequest, reply: FastifyReply): Promise<SetupInitializeResponse> => {
    const ip = getClientIp(request);
    if (!globalRateLimiter.hit("setup:" + ip, 10, 10 * 60_000)) throw tooManyRequests("初始化尝试过于频繁，请稍后再试");
    if (!services.settings.setupRequired()) throw conflict("服务器已完成初始化，无需重复操作", "setup_completed");
    if (setupInProgress) throw conflict("初始化正在进行中，请稍候", "setup_in_progress");

    const body = parseWith(setupSchema, request.body ?? {});

    if (services.config.setupToken) {
      if (!body.token || !safeEqual(body.token, services.config.setupToken)) {
        throw forbidden("初始化口令不正确", "setup_token_invalid");
      }
    }

    setupInProgress = true;
    try {
      if (!services.settings.setupRequired()) throw conflict("服务器已完成初始化，无需重复操作", "setup_completed");
      const adminUsername = body.admin.username;
      if (services.users.usernameExists(adminUsername)) throw conflict("用户名已被占用", "username_taken");

      if (body.server) {
        const patch: Partial<ServerSettings> = {};
        if (body.server.name !== undefined) patch.name = body.server.name;
        if (body.server.motd !== undefined) patch.motd = body.server.motd;
        if (body.server.registrationMode !== undefined) patch.registrationMode = body.server.registrationMode;
        if (body.server.guestEnabled !== undefined) patch.guestEnabled = body.server.guestEnabled;
        if (body.server.maxUsers !== undefined) patch.maxUsers = body.server.maxUsers;
        if (body.server.maxUsersPerRoom !== undefined) patch.maxUsersPerRoom = body.server.maxUsersPerRoom;
        if (body.server.defaultAudioSettings !== undefined) {
          patch.defaultAudioSettings = body.server.defaultAudioSettings as ServerSettings["defaultAudioSettings"];
        }
        if (body.server.allowGuestChat !== undefined) patch.allowGuestChat = body.server.allowGuestChat;
        if (body.server.livekitUrl !== undefined) patch.livekitUrl = body.server.livekitUrl.trim() || null;
        if (body.server.livekitApiKey !== undefined) patch.livekitApiKey = body.server.livekitApiKey.trim() || null;
        if (body.server.livekitApiSecret !== undefined) patch.livekitApiSecret = body.server.livekitApiSecret.trim() || null;
        services.settings.update(patch);
      }

      const admin = services.users.create({
        username: adminUsername,
        displayName: body.admin.displayName?.trim() || adminUsername,
        passwordHash: hashPassword(body.admin.password),
        role: "admin",
        ip,
      });

      const shouldCreateRooms = body.createDefaultRooms !== false && services.rooms.countRooms() === 0;
      const createdRooms: number[] = [];
      if (shouldCreateRooms) {
        const directory = services.roomDirectory;
        const root = directory.findByName(null, "默认频道") ?? directory.create(null, "默认频道");
        for (const room of DEFAULT_ROOMS) {
          const area = directory.findByName(root.id, room.category) ?? directory.create(root.id, room.category);
          const row = services.rooms.create(
            {
              name: room.name,
              description: room.description,
              areaId: area.id,
              maxUsers: 0,
              screenShareEnabled: true,
            },
            admin.id,
          );
          createdRooms.push(row.id);
        }
      }

      services.audit.log({
        actorId: admin.id,
        actorName: admin.display_name,
        action: "setup_initialize",
        targetType: "server",
        details: JSON.stringify({ serverName: services.settings.get().name, createdRooms }),
        ip,
      });

      const ctx = services.auth.createSessionForUser(admin, ip, getUserAgent(request));
      reply.setCookie(AUTH_COOKIE, ctx.token, services.auth.cookieOptions());

      const hub = getHub();
      hub?.broadcastServerSettings();
      hub?.broadcastRooms();
      hub?.broadcastOnlineUsers();

      return {
        user: ctx.user,
        server: services.settings.getPublic(),
        rooms: services.rooms.list(hub?.getRoomCounts() ?? new Map<number, number>()),
      };
    } finally {
      setupInProgress = false;
    }
  });
}

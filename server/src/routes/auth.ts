import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthResponse, GuestLoginRequest, LoginRequest, RegisterRequest } from "@airmic/shared";
import { AUTH_COOKIE } from "../services/auth.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { requireAuth } from "../plugins/auth.js";
import { getClientIp, getUserAgent } from "../lib/http.js";
import { globalRateLimiter } from "../lib/rate-limit.js";
import { parseWith } from "../lib/validation.js";
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "../lib/errors.js";
import type { Services } from "../types.js";
import { getHub } from "../realtime/instance.js";

const registerSchema = z.object({
  username: z.string(),
  password: z.string(),
  displayName: z.string().optional(),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const guestSchema = z.object({
  displayName: z.string(),
});

const registerBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "用户名至少 3 个字符")
    .max(24, "用户名最多 24 个字符")
    .regex(/^[a-zA-Z0-9_-]+$/, "用户名只能包含字母、数字、下划线和短横线"),
  password: z.string().min(6, "密码至少 6 位").max(128, "密码最多 128 位"),
  displayName: z.string().trim().min(1).max(24).optional(),
  inviteCode: z.string().optional(),
});

const loginBodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

const guestBodySchema = z.object({
  displayName: z.string().trim().min(1, "昵称不能为空").max(24, "昵称最多 24 个字符"),
});

function setCookie(reply: FastifyReply, name: string, value: string, options: Parameters<FastifyReply["setCookie"]>[2]): void {
  reply.setCookie(name, value, options);
}

export async function registerAuthRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.post("/api/auth/register", async (request: FastifyRequest, reply: FastifyReply): Promise<AuthResponse> => {
    const ip = getClientIp(request);
    if (!globalRateLimiter.hit("register:" + ip, 10, 10 * 60_000)) throw tooManyRequests("注册太频繁，请稍后再试");
    const body = parseWith(registerBodySchema, request.body) as RegisterRequest;
    const settings = services.settings.get();
    const isFirstUser = services.users.countUsers({ includeGuests: true }) === 0;

    if (!isFirstUser) {
      if (settings.registrationMode === "closed") throw forbidden("服务器已关闭注册");
      if (settings.registrationMode === "invite") {
        const code = (body.inviteCode ?? "").trim();
        if (!settings.registrationCode || code.toUpperCase() !== settings.registrationCode.toUpperCase()) {
          throw forbidden("邀请码不正确");
        }
      }
    }

    if (services.users.usernameExists(body.username)) throw conflict("用户名已被占用", "username_taken");

    const role = isFirstUser ? "admin" : "user";
    const user = services.users.create({
      username: body.username,
      displayName: body.displayName?.trim() || body.username,
      passwordHash: hashPassword(body.password),
      role,
      ip,
    });

    services.audit.log({
      actorId: user.id,
      actorName: user.display_name,
      action: "register",
      targetType: "user",
      targetId: user.id,
      targetName: user.username,
      details: role === "admin" ? "首个用户自动成为管理员" : null,
      ip,
    });

    const ctx = services.auth.createSessionForUser(user, ip, getUserAgent(request));
    setCookie(reply, AUTH_COOKIE, ctx.token, isFirstUser ? services.auth.cookieOptions() : services.auth.cookieOptions());
    getHub()?.broadcastOnlineUsers();
    return { user: ctx.user };
  });

  app.post("/api/auth/login", async (request: FastifyRequest, reply: FastifyReply): Promise<AuthResponse> => {
    const ip = getClientIp(request);
    if (!globalRateLimiter.hit("login:" + ip, 20, 5 * 60_000)) throw tooManyRequests("尝试次数过多，请稍后再试");
    const body = parseWith(loginBodySchema, request.body) as LoginRequest;
    const user = services.users.findByUsername(body.username);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw unauthorized("用户名或密码错误", "invalid_credentials");
    }
    const ban = services.bans.findActive(user.id, ip);
    if (ban) throw forbidden("该账号或 IP 已被封禁：" + ban.reason, "banned");
    if (user.is_banned === 1) {
      const until = user.banned_until ? Date.parse(user.banned_until) : null;
      if (until === null || Number.isNaN(until) || until > Date.now()) {
        throw forbidden("该账号已被封禁：" + (user.ban_reason ?? ""), "banned");
      }
    }
    const ctx = services.auth.createSessionForUser(user, ip, getUserAgent(request));
    setCookie(reply, AUTH_COOKIE, ctx.token, services.auth.cookieOptions());
    services.audit.log({ actorId: user.id, actorName: user.display_name, action: "login", ip });
    return { user: ctx.user };
  });

  app.post("/api/auth/guest", async (request: FastifyRequest, reply: FastifyReply): Promise<AuthResponse> => {
    const ip = getClientIp(request);
    if (!globalRateLimiter.hit("guest:" + ip, 10, 10 * 60_000)) throw tooManyRequests("创建游客身份太频繁，请稍后再试");
    const settings = services.settings.get();
    if (!settings.guestEnabled) throw forbidden("服务器未开放游客模式");
    const body = parseWith(guestBodySchema, request.body) as GuestLoginRequest;
    const ban = services.bans.findActive(null, ip);
    if (ban) throw forbidden("该 IP 已被封禁：" + ban.reason, "banned");

    const user = services.users.createGuest(body.displayName.trim(), ip);
    const ctx = services.auth.createSessionForUser(user, ip, getUserAgent(request));
    setCookie(reply, AUTH_COOKIE, ctx.token, services.auth.guestCookieOptions());
    services.audit.log({
      actorId: user.id,
      actorName: user.display_name,
      action: "guest_login",
      targetType: "user",
      targetId: user.id,
      targetName: user.username,
      ip,
    });
    getHub()?.broadcastOnlineUsers();
    return { user: ctx.user };
  });

  app.post("/api/auth/logout", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth) {
      services.auth.revokeSession(request.auth.sessionId);
      getHub()?.disconnectUser(request.auth.user.id, "已退出登录");
    }
    reply.clearCookie(AUTH_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (request: FastifyRequest): Promise<AuthResponse> => {
    const auth = requireAuth(request);
    const roomId = getHub()?.getRoomIdForUser(auth.user.id) ?? null;
    const user = services.auth.loadUserSelf(auth.user.id, roomId) ?? auth.user;
    return { user: { ...user, roomId } };
  });

  // 兼容测试/API 客户端：也允许从请求体读取邀请码等字段
  void registerSchema;
  void loginSchema;
  void guestSchema;
  setCookie;
}

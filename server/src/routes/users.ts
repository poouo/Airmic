import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthResponse } from "@airmic/shared";
import { requireAuth } from "../plugins/auth.js";
import { parseWith } from "../lib/validation.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { badRequest, notFound, unauthorized } from "../lib/errors.js";
import { getHub } from "../realtime/instance.js";
import type { Services } from "../types.js";

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1, "昵称不能为空").max(24, "昵称最多 24 个字符").optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "头像颜色格式不正确").optional(),
  avatarEmoji: z.string().max(8).nullable().optional(),
  statusText: z.string().max(60, "状态最多 60 个字符").optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: z.string().min(6, "新密码至少 6 位").max(128),
});

export async function registerUserRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.patch("/api/users/me", async (request): Promise<AuthResponse> => {
    const auth = requireAuth(request);
    const body = parseWith(updateProfileSchema, request.body);
    const updated = services.users.updateProfile(auth.user.id, body);
    if (!updated) throw notFound("用户不存在");
    getHub()?.refreshUser(auth.user.id);
    const roomId = getHub()?.getRoomIdForUser(auth.user.id) ?? null;
    return { user: services.users.toSelf(updated, roomId) };
  });

  app.post("/api/users/me/password", async (request) => {
    const auth = requireAuth(request);
    const body = parseWith(changePasswordSchema, request.body);
    const row = services.users.findById(auth.user.id);
    if (!row) throw notFound("用户不存在");
    if (row.is_guest === 1) throw badRequest("游客账号不支持设置密码，请注册正式账号");
    if (!verifyPassword(body.currentPassword, row.password_hash)) throw unauthorized("当前密码不正确", "invalid_password");
    services.db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", hashPassword(body.newPassword), new Date().toISOString(), auth.user.id);
    // 注销除当前会话外的其他登录状态
    services.db.run("UPDATE sessions SET revoked = 1 WHERE user_id = ? AND session_id != ?", auth.user.id, auth.sessionId);
    services.audit.log({ actorId: auth.user.id, actorName: row.display_name, action: "password_change" });
    return { ok: true };
  });
}

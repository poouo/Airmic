import { z } from "zod";
import { AppError } from "./errors.js";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "用户名至少 3 个字符")
  .max(24, "用户名最多 24 个字符")
  .regex(/^[a-zA-Z0-9_-]+$/, "用户名只能包含字母、数字、下划线和短横线");

export const passwordSchema = z.string().min(6, "密码至少 6 位").max(128, "密码最多 128 位");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "昵称不能为空")
  .max(24, "昵称最多 24 个字符")
  .refine((value) => !/[\u0000-\u001f]/.test(value), "昵称包含非法字符");

export const avatarColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "头像颜色格式不正确");

export const avatarEmojiSchema = z.string().max(8, "表情最多 8 个字符").nullable();

export const statusTextSchema = z.string().max(60, "状态最多 60 个字符");

export const roomNameSchema = z
  .string()
  .trim()
  .min(1, "房间名不能为空")
  .max(40, "房间名最多 40 个字符")
  .refine((value) => !/[\u0000-\u001f]/.test(value), "房间名包含非法字符");

export const roomDescriptionSchema = z.string().max(200, "房间简介最多 200 个字符");
export const roomCategorySchema = z.string().trim().max(20, "分类最多 20 个字符");
export const roomPasswordSchema = z.string().min(4, "房间密码至少 4 位").max(64, "房间密码最多 64 位");

export const idSchema = z.coerce.number().int().positive();
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ipSchema = z.string().trim().min(2).max(64);

export function parseWith<T extends z.ZodTypeAny>(schema: T, data: unknown, message = "请求参数不正确"): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const text = issue?.message ? `${message}：${issue.message}` : message;
    const error = new Error(text) as Error & { statusCode?: number; code?: string; details?: unknown };
    error.statusCode = 400;
    error.code = "validation_error";
    error.details = result.error.issues.map((item) => ({ path: item.path.join("."), message: item.message }));
    throw error;
  }
  return result.data;
}
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AdminLogListResponse, AdminLogQuery, LogCategory, LogLevel } from "@airmic/shared";
import { parseWith } from "../lib/validation.js";
import { requireAuth } from "../plugins/auth.js";
import type { Services } from "../types.js";

const levelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);
const categorySchema = z.enum(["http", "ws", "auth", "admin", "system", "room", "voice", "error", "security"]);

const logQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  level: levelSchema.optional(),
  category: categorySchema.optional(),
  search: z.string().trim().max(100).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
});

const exportQuerySchema = logQuerySchema.extend({
  format: z.enum(["csv", "json"]).default("csv"),
});

/** 运行日志查询与导出（管理员；日志仅保留最近 LOG_RETENTION_DAYS 天） */
export async function registerLogRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get(
    "/api/admin/logs",
    { preHandler: app.requireAnyPermission(["manage_server", "view_audit"]) },
    async (request): Promise<AdminLogListResponse> => {
      requireAuth(request);
      const query = parseWith(logQuerySchema, request.query);
      return services.logs.list(query as AdminLogQuery);
    },
  );

  app.get(
    "/api/admin/logs/export",
    { preHandler: app.requireAnyPermission(["manage_server", "view_audit"]) },
    async (request, reply) => {
      requireAuth(request);
      const query = parseWith(exportQuerySchema, request.query);
      const format = query.format;
      const file = services.logs.export(query as AdminLogQuery, format);
      reply.header("content-type", file.contentType);
      reply.header("content-disposition", 'attachment; filename="' + file.filename + '"');
      reply.header("cache-control", "no-store");
      return reply.send(file.content);
    },
  );

  void levelSchema;
  void categorySchema;
}

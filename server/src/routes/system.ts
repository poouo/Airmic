import type { FastifyInstance } from "fastify";
import type { UpdateCheckResponse } from "@airmic/shared";
import { requireAuth } from "../plugins/auth.js";
import type { Services } from "../types.js";

/** 系统信息与在线更新检查（管理员） */
export async function registerSystemRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get(
    "/api/system/update",
    { preHandler: app.requirePermission("manage_server") },
    async (request): Promise<UpdateCheckResponse> => {
      requireAuth(request);
      const force = String((request.query as { force?: string }).force ?? "") === "1";
      return services.update.check(force);
    },
  );
}

import fs from "node:fs";
import { APP_VERSION } from "@airmic/shared";
import path from "node:path";
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { AppError } from "./lib/errors.js";
import { getClientIp } from "./lib/http.js";
import { nowIso } from "./lib/time.js";
import { registerAuthDecorators } from "./plugins/auth.js";
import { registerRealtime } from "./realtime/index.js";
import { getHub } from "./realtime/instance.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerLogRoutes } from "./routes/logs.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerRoomRoutes } from "./routes/rooms.js";
import { registerRoomDirectoryRoutes } from "./routes/room-directory.js";
import { registerServerRoutes } from "./routes/server.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerUserRoutes } from "./routes/users.js";
import { createServices } from "./services/index.js";
import { isGuestId } from "./services/users.js";

export interface BuildAppOptions {
  config?: AppConfig;
}

function involvesGuest(request: FastifyRequest): boolean {
  const route = request.routeOptions.url;
  if (request.auth?.user.isGuest || route === "/api/auth/guest") return true;
  const params = request.params as { id?: string; userId?: string } | undefined;
  if (route?.startsWith("/api/admin/users/:id")) return isGuestId(Number(params?.id));
  if (route?.startsWith("/api/rooms/:id/members/:userId")) return isGuestId(Number(params?.userId));
  return false;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const services = createServices(config);

  const loggerOption = config.logLevel === "silent" ? false : { level: config.logLevel };
  const baseOptions = {
    logger: loggerOption,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  };
  // HTTPS 可选：Fastify 的类型推断对 http/https 返回不同的实例泛型，这里统一视为默认实例
  const app = (
    config.ssl ? Fastify({ ...baseOptions, https: config.ssl }) : Fastify(baseOptions)
  ) as unknown as FastifyInstance;

  app.decorate("services", services);

  await app.register(cookie);

  const indexHtmlPath = path.join(config.webDist, "index.html");

  // 错误响应与 404 处理器必须在路由/插件注册之前设置：
  // Fastify 在 register() 之后设置错误处理器时，无法作用到此前已注册的路由。
  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? "";
    if (request.method === "GET" && !url.startsWith("/api/") && !url.startsWith("/ws")) {
      if (fs.existsSync(indexHtmlPath)) {
        reply.header("Cache-Control", "no-store");
        return reply.type("text/html; charset=utf-8").send(fs.createReadStream(indexHtmlPath));
      }
    }
    return reply.code(404).send({ error: { code: "not_found", message: "资源不存在" } });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    const candidate = error as { statusCode?: number; code?: string; message?: string; validation?: unknown };
    if (candidate.validation) {
      return reply.code(400).send({ error: { code: "validation_error", message: "请求参数不正确" } });
    }
    if (typeof candidate.statusCode === "number" && candidate.statusCode >= 400 && candidate.statusCode < 500) {
      return reply.code(candidate.statusCode).send({
        error: { code: candidate.code ?? "bad_request", message: candidate.message ?? "请求不正确" },
      });
    }
    if (!involvesGuest(request)) {
      services.logs.write({
        level: "error",
        category: "error",
        message: "未处理的服务端错误：" + (candidate.message ?? String(error)),
        meta: { path: request.raw.url, stack: error instanceof Error ? error.stack?.slice(0, 4000) : String(error) },
        userId: request.auth?.user.id ?? null,
        username: request.auth?.user.username ?? null,
        ip: request.auth ? getClientIp(request) : null,
        requestId: request.id,
      });
      request.log.error({ err: error }, "未处理的服务端错误");
    }
    return reply.code(500).send({ error: { code: "internal", message: "服务器内部错误" } });
  });

  app.addHook("onRequest", async (request) => {
    const url = request.raw.url ?? "";
    if (url.startsWith("/api/") || url.startsWith("/ws")) {
      request.raw.socket.setNoDelay?.(true);
    }
  });

  app.addHook("onSend", async (request, reply) => {
    const url = request.raw.url ?? "";
    if (!url.startsWith("/api/") && !url.startsWith("/ws")) return;
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Permissions-Policy", "microphone=(self), camera=(self), display-capture=(self)");
  });

  registerAuthDecorators(app, services);

  // ---------- 运行日志：HTTP 请求记录（管理后台可分页查看/导出，默认保留 3 天） ----------
  app.addHook("onResponse", async (request, reply) => {
    const url = request.raw.url ?? "";
    if (!url.startsWith("/api/") && !url.startsWith("/ws")) return;
    if (url.startsWith("/api/health") || url.startsWith("/api/admin/logs")) return;
    if (involvesGuest(request)) return;
    const path = url.split("?")[0] ?? url;
    const status = reply.statusCode;
    const category = path.startsWith("/ws")
      ? "ws"
      : path.startsWith("/api/admin")
        ? "admin"
        : path.startsWith("/api/auth")
          ? "auth"
          : "http";
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    const elapsed = Math.round(reply.elapsedTime);
    services.logs.write({
      level,
      category,
      message: request.method + " " + path + " → " + status + " (" + elapsed + "ms)",
      meta: { method: request.method, path, status, ms: elapsed },
      userId: request.auth?.user.id ?? null,
      username: request.auth?.user.username ?? null,
      ip: request.auth ? getClientIp(request) : null,
      requestId: request.id,
    });
  });

  let maintenance: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => {
    services.logs.write({
      level: "info",
      category: "system",
      message: "AirMic 服务已启动",
      meta: { version: APP_VERSION, port: config.port, node: process.version, pid: process.pid },
    });
    maintenance = setInterval(() => {
      try {
        for (const guestId of services.auth.removeExpiredGuests()) {
          services.rooms.releaseGuestRooms(guestId);
          getHub()?.disconnectUser(guestId, "游客会话已过期");
        }
        services.bans.expireOld();
        services.db.run("DELETE FROM sessions WHERE expires_at < ?", nowIso());
        services.rooms.purgeExpiredMessages();
      } catch (error) {
        app.log.error({ err: error }, "清理过期数据失败");
      }
    }, 60_000).unref();
  });

  await registerServerRoutes(app, services);
  await registerAuthRoutes(app, services);
  await registerUserRoutes(app, services);
  await registerRoomRoutes(app, services);
  await registerRoomDirectoryRoutes(app, services);
  await registerMediaRoutes(app, services);
  await registerSetupRoutes(app, services);
  await registerLogRoutes(app, services);
  await registerSystemRoutes(app, services);
  await registerAdminRoutes(app, services);
  await registerRealtime(app, services);

  if (fs.existsSync(indexHtmlPath)) {
    // 显式处理根路径：@fastify/static 使用 index:false + wildcard:true 时，"/" 会被当作目录请求返回 403
    app.get("/", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.type("text/html; charset=utf-8").send(fs.createReadStream(indexHtmlPath));
    });
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: "/",
      index: false,
      maxAge: config.isProduction ? "1h" : 0,
      wildcard: true,
    });
  }

  app.addHook("onClose", async () => {
    clearInterval(maintenance);
    services.logs.write({ level: "info", category: "system", message: "AirMic 服务正在关闭" });
    services.logs.shutdown();
    getHub()?.shutdown();
    services.db.close();
  });

  return app;
}

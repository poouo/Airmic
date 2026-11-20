import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { WS_MAX_MESSAGE_BYTES, WS_PATH } from "@airmic/shared";
import type { Services } from "../types.js";
import { Hub } from "./hub.js";
import { getHub, setHub } from "./instance.js";

/**
 * 测试/调试时可通过环境变量缩短心跳间隔（毫秒），默认使用协议常量 25s。
 * 仅用于本地自动化测试，生产环境不会设置该变量。
 */
function heartbeatIntervalOverride(): number | undefined {
  const raw = process.env.AIRMIC_WS_HEARTBEAT_MS;
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 20 ? Math.floor(value) : undefined;
}

/**
 * 注册 WebSocket 实时信令路由（/ws）。
 * 注册 @fastify/websocket 插件并创建 Hub，通过 instance.setHub 暴露给 REST 路由。
 *
 * 注意：这里不能 await app.register(websocket)。app.ts 在所有路由注册之后才调用
 * app.setErrorHandler；如果在注册阶段 await 插件，Fastify 的 avvio 会提前执行此前
 * 已注册路由的 after 回调，导致 /api 路由捕获默认错误处理器（错误响应体格式不一致）。
 * 因此把插件与 /ws 路由放入延迟加载的插件作用域，让错误处理器先完成注册。
 */
export async function registerRealtime(app: FastifyInstance, services: Services): Promise<void> {
  const hub = new Hub(services, {
    heartbeatIntervalMs: heartbeatIntervalOverride(),
    logger: {
      warn: (message: string) => app.log.warn(message),
      error: (message: string) => app.log.error(message),
    },
  });
  setHub(hub);

  app.register(async (instance) => {
    await instance.register(websocket, {
      options: {
        // 单条消息上限与协议常量保持一致；超过时由 ws 直接以 1009 关闭，不会进入业务逻辑
        maxPayload: WS_MAX_MESSAGE_BYTES,
      },
    });
    instance.get(WS_PATH, { websocket: true }, (socket, request) => {
      hub.handleConnection(socket, request);
    });
  });

  app.addHook("onClose", async () => {
    hub.shutdown();
    if (getHub() === hub) setHub(null);
  });
}

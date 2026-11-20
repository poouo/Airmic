import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import type { AuthResponse, ServerMessage } from "@airmic/shared";
import { buildApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import type { Services } from "../src/types.js";
import { globalRateLimiter } from "../src/lib/rate-limit.js";

export interface ApiResult<T> {
  status: number;
  body: T;
}

export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(readonly baseUrl: string) {}

  cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => name + "=" + value).join("; ");
  }

  async request<T = unknown>(method: string, apiPath: string, body?: unknown): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    const response = await fetch(this.baseUrl + apiPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (value === "" || raw.toLowerCase().includes("max-age=0")) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed as T };
  }

  get<T = unknown>(apiPath: string): Promise<ApiResult<T>> {
    return this.request<T>("GET", apiPath);
  }

  post<T = unknown>(apiPath: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request<T>("POST", apiPath, body);
  }

  patch<T = unknown>(apiPath: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request<T>("PATCH", apiPath, body);
  }

  del<T = unknown>(apiPath: string): Promise<ApiResult<T>> {
    return this.request<T>("DELETE", apiPath);
  }

  async register(username: string, password = "password123", displayName?: string): Promise<ApiResult<AuthResponse>> {
    return this.post("/api/auth/register", { username, password, displayName });
  }

  async guest(displayName: string): Promise<ApiResult<AuthResponse>> {
    return this.post("/api/auth/guest", { displayName });
  }
}

export interface WsMessageQueue {
  messages: ServerMessage[];
  send: (message: unknown) => void;
  waitFor<T extends ServerMessage["t"]>(type: T, timeoutMs?: number): Promise<Extract<ServerMessage, { t: T }>>;
  waitForAny(timeoutMs?: number): Promise<ServerMessage>;
  close(): void;
}

export interface TestContext {
  app: FastifyInstance;
  services: Services;
  config: AppConfig;
  baseUrl: string;
  wsUrl: string;
  newClient(): TestClient;
  registerUser(username: string, password?: string, displayName?: string): Promise<TestClient>;
  connectWs(client: TestClient): Promise<WsMessageQueue>;
  close(): Promise<void>;
}

export async function createTestContext(overrides: Partial<AppConfig> = {}): Promise<TestContext> {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "airmic-test-"));
  const config = loadConfig({
    databasePath: path.join(tmpDir, "test.db"),
    logLevel: "silent",
    jwtSecret: "test-jwt-secret",
    port: 0,
    host: "127.0.0.1",
    adminUsername: null,
    adminPassword: null,
    ...overrides,
  });
  globalRateLimiter.reset();
  const app = await buildApp({ config });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("测试服务器启动失败");
  const baseUrl = "http://127.0.0.1:" + address.port;
  const wsUrl = "ws://127.0.0.1:" + address.port + "/ws";
  const clients: TestClient[] = [];
  const sockets: WebSocket[] = [];

  let closed = false;
  const ctx: TestContext = {
    app,
    services: app.services,
    config,
    baseUrl,
    wsUrl,
    newClient() {
      const client = new TestClient(baseUrl);
      clients.push(client);
      return client;
    },
    async registerUser(username: string, password = "password123", displayName?: string) {
      const client = ctx.newClient();
      const result = await client.register(username, password, displayName);
      if (result.status !== 200) throw new Error("注册失败: " + JSON.stringify(result.body));
      return client;
    },
    async connectWs(client: TestClient) {
      const socket = new WebSocket(wsUrl, { headers: { cookie: client.cookieHeader() } });
      sockets.push(socket);
      const queue: ServerMessage[] = [];
      const waiters: { resolve: (msg: ServerMessage) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }[] = [];
      socket.on("message", (raw) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(raw.toString()) as ServerMessage;
        } catch {
          return;
        }
        queue.push(message);
        for (const waiter of [...waiters]) {
          waiter.resolve(message);
          clearTimeout(waiter.timer);
          waiters.splice(waiters.indexOf(waiter), 1);
        }
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", (error) => reject(error));
      });

      function waitForAny(timeoutMs = 3000): Promise<ServerMessage> {
        const existing = queue.shift();
        if (existing) return Promise.resolve(existing);
        return new Promise<ServerMessage>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("等待 WebSocket 消息超时")), timeoutMs);
          waiters.push({ resolve, reject, timer });
        });
      }

      const wsQueue: WsMessageQueue = {
        messages: queue,
        send(message: unknown) {
          socket.send(JSON.stringify(message));
        },
        async waitFor<T extends ServerMessage["t"]>(type: T, timeoutMs = 3000) {
          const deadline = Date.now() + timeoutMs;
          for (;;) {
            const message = await waitForAny(Math.max(1, deadline - Date.now()));
            if (message.t === type) return message as Extract<ServerMessage, { t: T }>;
          }
        },
        waitForAny,
        close() {
          socket.close();
        },
      };
      return wsQueue;
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
      await app.close();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
  return ctx;
}

/** 便捷方法：等待事件循环推进 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
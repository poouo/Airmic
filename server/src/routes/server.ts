import type { FastifyInstance } from "fastify";
import { APP_VERSION } from "@airmic/shared";
import type { ServerInfoResponse } from "@airmic/shared";
import { secondsSince } from "../lib/time.js";
import type { Services } from "../types.js";

export async function registerServerRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get("/api/health", async () => ({
    status: "ok",
    version: APP_VERSION,
    uptimeSeconds: secondsSince(services.startedAt),
  }));

  app.get("/api/server", async (): Promise<ServerInfoResponse> => {
    return {
      server: services.settings.getPublic(),
      setupRequired: services.settings.setupRequired(),
      version: APP_VERSION,
    };
  });

  app.get("/api/rtc/ice", async () => {
    const settings = services.settings.get();
    return {
      iceServers: settings.iceServers,
      forceRelay: settings.forceRelay,
    };
  });
}

import type { Permission } from "@airmic/shared";
import type { AuthContext, Services } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }

  interface FastifyInstance {
    services: Services;
    requirePermission: (permission: Permission) => (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    requireAnyPermission: (permissions: Permission[]) => (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
}
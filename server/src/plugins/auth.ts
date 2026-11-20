import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Permission } from "@airmic/shared";
import { AUTH_COOKIE } from "../services/auth.js";
import type { AuthContext, Services } from "../types.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export function registerAuthDecorators(app: FastifyInstance, services: Services): void {
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request: FastifyRequest) => {
    const cookieToken = request.cookies?.[AUTH_COOKIE];
    const header = request.headers.authorization;
    const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
    const token = cookieToken ?? bearer;
    if (token) {
      request.auth = services.auth.authenticate(token);
    }
  });

  app.decorate("requirePermission", (permission: Permission) => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      if (!auth.user.permissions.includes(permission)) {
        throw forbidden();
      }
    };
  });

  app.decorate("requireAnyPermission", (permissions: Permission[]) => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      if (!permissions.some((permission) => auth.user.permissions.includes(permission))) {
        throw forbidden();
      }
    };
  });
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export function hasPermission(request: FastifyRequest, permission: Permission): boolean {
  return request.auth?.user.permissions.includes(permission) ?? false;
}

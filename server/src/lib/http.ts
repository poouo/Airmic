import type { FastifyRequest } from "fastify";
import { paginationSchema } from "./validation.js";
import type { PageQuery } from "@airmic/shared";

export function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}

export function getUserAgent(request: FastifyRequest): string {
  const ua = request.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 300) : "";
}

export function parsePagination(query: unknown): { page: number; pageSize: number; offset: number } {
  const parsed = paginationSchema.parse(query ?? {}) as PageQuery;
  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 20;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function publicUserFields(): string {
  return "id, username, display_name, role, is_guest, avatar_color, avatar_emoji, status_text, created_at";
}

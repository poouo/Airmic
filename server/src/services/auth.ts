import type { CookieSerializeOptions } from "@fastify/cookie";
import type { UserSelf } from "@airmic/shared";
import { permissionsForRole } from "@airmic/shared";
import type { AppConfig } from "../config.js";
import type { Database } from "../db.js";
import { AppError, forbidden, unauthorized } from "../lib/errors.js";
import { verifyJwt, signJwt } from "../lib/jwt.js";
import { randomToken } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import type { AuthContext } from "../types.js";
import type { SettingsService } from "./settings.js";
import type { UserRow, UsersService } from "./users.js";

export const AUTH_COOKIE = "airmic_token";

interface SessionRow {
  session_id: string;
  user_id: number;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked: number;
}

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: string;
  maxAgeSeconds: number;
}

export class AuthService {
  private readonly guestSessions = new Map<string, { userId: number; expiresAt: string }>();

  constructor(
    private readonly db: Database,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly config: AppConfig,
  ) {}

  getCookieName(): string {
    return AUTH_COOKIE;
  }

  ttlSecondsFor(user: UserRow): number {
    return user.is_guest === 1
      ? Math.max(1, this.config.guestSessionTtlHours) * 3600
      : Math.max(1, this.config.userSessionTtlDays) * 24 * 3600;
  }

  createSession(user: UserRow, ip: string | null, userAgent: string | null): IssuedSession {
    const sessionId = randomToken(24);
    const ttlSeconds = this.ttlSecondsFor(user);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const timestamp = nowIso();
    if (user.is_guest === 1) {
      this.guestSessions.set(sessionId, { userId: user.id, expiresAt });
    } else this.db.run(
      "INSERT INTO sessions (session_id, user_id, ip, user_agent, created_at, last_seen_at, expires_at, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      sessionId,
      user.id,
      ip,
      userAgent,
      timestamp,
      timestamp,
      expiresAt,
    );
    const token = signJwt({ sub: user.id, sid: sessionId }, this.settings.getJwtSecret(), ttlSeconds);
    return { token, sessionId, expiresAt, maxAgeSeconds: ttlSeconds };
  }

  authenticate(token: string | null | undefined): AuthContext | null {
    if (!token) return null;
    const payload = verifyJwt(token, this.settings.getJwtSecret());
    if (!payload) return null;
    const guestSession = this.guestSessions.get(payload.sid);
    if (guestSession) {
      if (guestSession.userId !== payload.sub || Date.parse(guestSession.expiresAt) <= Date.now()) return null;
      const user = this.loadUserSelf(guestSession.userId);
      return user ? { user, sessionId: payload.sid, token } : null;
    }
    const session = this.db.get<SessionRow>(
      "SELECT session_id, user_id, ip, user_agent, created_at, last_seen_at, expires_at, revoked FROM sessions WHERE session_id = ?",
      payload.sid,
    );
    if (!session || session.user_id !== payload.sub || session.revoked === 1) return null;
    if (Date.parse(session.expires_at) <= Date.now()) return null;
    const row = this.users.findById(session.user_id);
    if (!row) return null;
    if (row.is_banned === 1) {
      const until = row.banned_until ? Date.parse(row.banned_until) : null;
      if (until === null || Number.isNaN(until) || until > Date.now()) return null;
    }
    const lastSeen = Date.parse(session.last_seen_at);
    if (Number.isNaN(lastSeen) || Date.now() - lastSeen > 5 * 60_000) {
      this.db.run("UPDATE sessions SET last_seen_at = ? WHERE session_id = ?", nowIso(), session.session_id);
      this.users.touchLastSeen(row.id, session.ip);
    }
    return { user: this.users.toSelf(row), sessionId: session.session_id, token };
  }

  revokeSession(sessionId: string): void {
    const guest = this.guestSessions.get(sessionId);
    if (guest) {
      this.guestSessions.delete(sessionId);
      this.users.delete(guest.userId);
      return;
    }
    this.db.run("UPDATE sessions SET revoked = 1 WHERE session_id = ?", sessionId);
  }

  revokeUserSessions(userId: number): void {
    this.db.run("UPDATE sessions SET revoked = 1 WHERE user_id = ?", userId);
  }

  removeExpiredGuests(): number[] {
    const now = nowIso();
    const expired: number[] = [];
    for (const [sessionId, session] of this.guestSessions) {
      if (session.expiresAt > now) continue;
      this.revokeSession(sessionId);
      expired.push(session.userId);
    }
    return expired;
  }

  createSessionForUser(user: UserRow, ip: string | null, userAgent: string | null): AuthContext {
    const issued = this.createSession(user, ip, userAgent);
    const ctx: AuthContext = {
      user: this.users.toSelf(user),
      sessionId: issued.sessionId,
      token: issued.token,
    };
    return ctx;
  }

  cookieOptions(): CookieSerializeOptions {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.ssl !== null,
      path: "/",
      maxAge: Math.max(1, this.config.userSessionTtlDays) * 24 * 3600,
    };
  }

  guestCookieOptions(): CookieSerializeOptions {
    return { ...this.cookieOptions(), maxAge: Math.max(1, this.config.guestSessionTtlHours) * 3600 };
  }

  clearCookieOptions(): CookieSerializeOptions {
    return { ...this.cookieOptions(), maxAge: 0 };
  }

  /** 从请求头 Cookie 中提取令牌（WebSocket 升级请求没有 fastify cookie 解析） */
  static extractTokenFromCookieHeader(header: string | undefined): string | null {
    if (!header) return null;
    for (const part of header.split(";")) {
      const [rawName, ...rest] = part.split("=");
      if (rawName?.trim() === AUTH_COOKIE) {
        return decodeURIComponent(rest.join("=").trim());
      }
    }
    return null;
  }

  loadUserSelf(userId: number, roomId: number | null = null): UserSelf | null {
    const row = this.users.findById(userId);
    if (!row) return null;
    return { ...this.users.toSelf(row, roomId), permissions: permissionsForRole(row.role) };
  }
}

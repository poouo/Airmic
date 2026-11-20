import type { BanRow } from "@airmic/shared";
import type { Database } from "../db.js";
import { isoAfterMinutes, isExpired, nowIso } from "../lib/time.js";
import type { UsersService } from "./users.js";

interface BanDbRow {
  id: number;
  user_id: number | null;
  username: string | null;
  ip: string | null;
  reason: string;
  banned_by: number | null;
  created_at: string;
  expires_at: string | null;
  active: number;
}

const BAN_COLUMNS =
  "b.id, b.user_id, b.username, b.ip, b.reason, b.banned_by, b.created_at, b.expires_at, b.active";

export interface CreateBanInput {
  userId?: number | null;
  username?: string | null;
  ip?: string | null;
  reason: string;
  durationMinutes?: number;
  bannedById?: number | null;
}

export class BansService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersService,
  ) {}

  activeForUser(userId: number): BanDbRow | undefined {
    return this.db.get<BanDbRow>(
      "SELECT " + BAN_COLUMNS + " FROM bans b WHERE b.active = 1 AND b.user_id = ? AND (b.expires_at IS NULL OR b.expires_at > ?) ORDER BY b.id DESC LIMIT 1",
      userId,
      nowIso(),
    );
  }

  activeForIp(ip: string): BanDbRow | undefined {
    if (!ip) return undefined;
    return this.db.get<BanDbRow>(
      "SELECT " + BAN_COLUMNS + " FROM bans b WHERE b.active = 1 AND b.ip = ? AND (b.expires_at IS NULL OR b.expires_at > ?) ORDER BY b.id DESC LIMIT 1",
      ip,
      nowIso(),
    );
  }

  findActive(userId?: number | null, ip?: string | null): BanDbRow | undefined {
    if (userId) {
      const byUser = this.activeForUser(userId);
      if (byUser) return byUser;
    }
    if (ip) return this.activeForIp(ip);
    return undefined;
  }

  create(input: CreateBanInput): BanRow {
    const expiresAt =
      input.durationMinutes && input.durationMinutes > 0 ? isoAfterMinutes(input.durationMinutes) : null;
    const result = this.db.run(
      "INSERT INTO bans (user_id, username, ip, reason, banned_by, created_at, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      input.userId ?? null,
      input.username ?? null,
      input.ip ?? null,
      input.reason,
      input.bannedById ?? null,
      nowIso(),
      expiresAt,
    );
    if (input.userId) {
      this.users.setBanState(input.userId, true, input.reason, expiresAt);
    }
    const row = this.findById(result.lastInsertRowid);
    if (!row) throw new Error("创建封禁失败");
    return this.toBanRow(row);
  }

  findById(id: number): BanDbRow | undefined {
    return this.db.get<BanDbRow>("SELECT " + BAN_COLUMNS + " FROM bans b WHERE b.id = ?", id);
  }

  revoke(id: number): BanDbRow | undefined {
    const row = this.findById(id);
    if (!row) return undefined;
    this.db.run("UPDATE bans SET active = 0 WHERE id = ?", id);
    if (row.user_id) this.syncUserBanState(row.user_id);
    return { ...row, active: 0 };
  }

  /** 清理过期封禁并同步用户状态 */
  expireOld(now = nowIso()): number {
    const expired = this.db.all<{ id: number; user_id: number | null }>(
      "SELECT id, user_id FROM bans WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?",
      now,
    );
    if (expired.length === 0) return 0;
    this.db.transaction(() => {
      for (const row of expired) {
        this.db.run("UPDATE bans SET active = 0 WHERE id = ?", row.id);
        if (row.user_id) this.syncUserBanState(row.user_id);
      }
    });
    return expired.length;
  }

  private syncUserBanState(userId: number): void {
    const row = this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM bans WHERE active = 1 AND user_id = ? AND (expires_at IS NULL OR expires_at > ?)",
      userId,
      nowIso(),
    );
    if (Number(row?.count ?? 0) === 0) {
      this.users.setBanState(userId, false, null, null);
    }
  }

  list(options: { active?: boolean; page: number; pageSize: number }): { items: BanRow[]; total: number } {
    const where = options.active === undefined ? "" : "WHERE b.active = " + (options.active ? 1 : 0);
    const total = Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM bans b " + where)?.count ?? 0);
    const rows = this.db.all<BanDbRow>(
      "SELECT " + BAN_COLUMNS + " FROM bans b " + where + " ORDER BY b.active DESC, b.id DESC LIMIT ? OFFSET ?",
      options.pageSize,
      (options.page - 1) * options.pageSize,
    );
    return { items: rows.map((row) => this.toBanRow(row)), total };
  }

  private toBanRow(row: BanDbRow): BanRow {
    let bannedByName: string | null = null;
    if (row.banned_by) {
      const actor = this.db.get<{ display_name: string }>("SELECT display_name FROM users WHERE id = ?", row.banned_by);
      bannedByName = actor?.display_name ?? null;
    }
    return {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      ip: row.ip,
      reason: row.reason,
      active: row.active === 1 && !isExpired(row.expires_at),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      bannedById: row.banned_by,
      bannedByName,
    };
  }

  constructorArgs(): void {
    void this.users;
  }
}

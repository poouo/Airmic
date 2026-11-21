import type { Role, UserPublic, UserSelf } from "@airmic/shared";
import { permissionsForRole } from "@airmic/shared";
import type { Database } from "../db.js";
import { pickAvatarColor, randomId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string | null;
  role: Role;
  is_guest: number;
  is_banned: number;
  ban_reason: string | null;
  banned_until: string | null;
  avatar_color: string;
  avatar_emoji: string | null;
  status_text: string;
  last_ip: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export const USER_COLUMNS =
  "id, username, display_name, password_hash, role, is_guest, is_banned, ban_reason, " +
  "banned_until, avatar_color, avatar_emoji, status_text, last_ip, created_at, updated_at, last_seen_at";

export interface CreateUserInput {
  username: string;
  displayName: string;
  passwordHash: string | null;
  role?: Role;
  isGuest?: boolean;
  ip?: string | null;
}

export interface ListUsersOptions {
  search?: string;
  page: number;
  pageSize: number;
  role?: Role;
}

export class UsersService {
  constructor(private readonly db: Database) {}

  findById(id: number): UserRow | undefined {
    return this.db.get<UserRow>("SELECT " + USER_COLUMNS + " FROM users WHERE id = ?", id);
  }

  findByUsername(username: string): UserRow | undefined {
    return this.db.get<UserRow>("SELECT " + USER_COLUMNS + " FROM users WHERE username = ? COLLATE NOCASE", username);
  }

  usernameExists(username: string): boolean {
    return this.findByUsername(username) !== undefined;
  }

  create(input: CreateUserInput): UserRow {
    const timestamp = nowIso();
    const result = this.db.run(
      "INSERT INTO users (username, display_name, password_hash, role, is_guest, avatar_color, created_at, updated_at, last_seen_at, last_ip) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      input.username,
      input.displayName,
      input.passwordHash,
      input.role ?? "user",
      input.isGuest ? 1 : 0,
      pickAvatarColor(),
      timestamp,
      timestamp,
      timestamp,
      input.ip ?? null,
    );
    const row = this.findById(result.lastInsertRowid);
    if (!row) throw new Error("创建用户失败");
    return row;
  }

  createGuest(displayName: string, ip: string | null): UserRow {
    let username = "guest_" + randomId(4);
    let attempts = 0;
    while (this.usernameExists(username) && attempts < 10) {
      username = "guest_" + randomId(4);
      attempts += 1;
    }
    return this.create({ username, displayName, passwordHash: null, role: "guest", isGuest: true, ip });
  }

  /**
   * 游客原地升级为正式账号：补用户名与密码哈希，角色变为 user，is_guest 清零。
   * 保留同一个 user id，因此会话、房间成员身份和实时连接都不需要重建。
   */
  upgradeGuest(
    id: number,
    input: { username: string; passwordHash: string; displayName?: string },
  ): UserRow | undefined {
    const current = this.findById(id);
    if (!current || current.is_guest !== 1) return undefined;
    this.db.run(
      "UPDATE users SET username = ?, display_name = ?, password_hash = ?, role = 'user', is_guest = 0, updated_at = ? WHERE id = ?",
      input.username,
      input.displayName ?? current.display_name,
      input.passwordHash,
      nowIso(),
      id,
    );
    return this.findById(id);
  }

  updateProfile(
    id: number,
    patch: { displayName?: string; avatarColor?: string; avatarEmoji?: string | null; statusText?: string },
  ): UserRow | undefined {
    const current = this.findById(id);
    if (!current) return undefined;
    this.db.run(
      "UPDATE users SET display_name = ?, avatar_color = ?, avatar_emoji = ?, status_text = ?, updated_at = ? WHERE id = ?",
      patch.displayName ?? current.display_name,
      patch.avatarColor ?? current.avatar_color,
      patch.avatarEmoji !== undefined ? patch.avatarEmoji : current.avatar_emoji,
      patch.statusText ?? current.status_text,
      nowIso(),
      id,
    );
    return this.findById(id);
  }

  updateRole(id: number, role: Role): void {
    this.db.run("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", role, nowIso(), id);
  }

  setBanState(id: number, banned: boolean, reason: string | null, until: string | null): void {
    this.db.run(
      "UPDATE users SET is_banned = ?, ban_reason = ?, banned_until = ?, updated_at = ? WHERE id = ?",
      banned ? 1 : 0,
      banned ? reason : null,
      banned ? until : null,
      nowIso(),
      id,
    );
  }

  touchLastSeen(id: number, ip?: string | null): void {
    this.db.run("UPDATE users SET last_seen_at = ?, last_ip = COALESCE(?, last_ip) WHERE id = ?", nowIso(), ip ?? null, id);
  }

  delete(id: number): void {
    this.db.run("DELETE FROM users WHERE id = ?", id);
  }

  countAdmins(): number {
    const row = this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_guest = 0");
    return Number(row?.count ?? 0);
  }

  countUsers(filter: { includeGuests?: boolean } = {}): number {
    const sql = filter.includeGuests
      ? "SELECT COUNT(*) AS count FROM users"
      : "SELECT COUNT(*) AS count FROM users WHERE is_guest = 0";
    return Number(this.db.get<{ count: number }>(sql)?.count ?? 0);
  }

  countGuests(): number {
    return Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE is_guest = 1")?.count ?? 0);
  }

  listRegistered(options: ListUsersOptions): { rows: UserRow[]; total: number } {
    const conditions = ["is_guest = 0"];
    const params: (string | number)[] = [];
    if (options.search) {
      conditions.push("(username LIKE ? OR display_name LIKE ?)");
      const like = "%" + options.search + "%";
      params.push(like, like);
    }
    if (options.role) {
      conditions.push("role = ?");
      params.push(options.role);
    }
    const where = "WHERE " + conditions.join(" AND ");
    const total = Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users " + where, ...params)?.count ?? 0);
    const rows = this.db.all<UserRow>(
      "SELECT " + USER_COLUMNS + " FROM users " + where + " ORDER BY last_seen_at DESC, id DESC LIMIT ? OFFSET ?",
      ...params,
      options.pageSize,
      (options.page - 1) * options.pageSize,
    );
    return { rows, total };
  }

  /** 清理 N 天未活跃的游客账号（消息发送者会保留快照字段） */
  cleanupGuests(olderThanDays = 7): number {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.run(
      "DELETE FROM users WHERE is_guest = 1 AND COALESCE(last_seen_at, created_at) < ?",
      cutoff,
    );
    return result.changes;
  }

  toPublic(row: UserRow): UserPublic {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      isGuest: row.is_guest === 1,
      avatarColor: row.avatar_color,
      avatarEmoji: row.avatar_emoji,
      statusText: row.status_text,
      createdAt: row.created_at,
    };
  }

  toSelf(row: UserRow, roomId: number | null = null): UserSelf {
    return {
      ...this.toPublic(row),
      permissions: permissionsForRole(row.role),
      roomId,
    };
  }
}

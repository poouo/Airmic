import {
  diffAudioSettings,
  mergeAudioSettings,
  normalizeAudioSettings,
} from "@airmic/shared";
import type { AudioOverride, AudioSettings, ChatMessage, RoomDetail, RoomSummary, Role } from "@airmic/shared";
import type { Database } from "../db.js";
import { hashRoomPassword, verifyRoomPassword } from "../lib/password.js";
import { nowIso } from "../lib/time.js";
import type { SettingsService } from "./settings.js";

export interface RoomRow {
  id: number;
  name: string;
  description: string;
  category: string;
  password_hash: string | null;
  max_users: number;
  sort_order: number;
  locked: number;
  screen_share_enabled: number;
  audio_override: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: number;
  room_id: number;
  user_id: number | null;
  sender_name: string;
  sender_role: Role | "system";
  kind: "text" | "system";
  content: string;
  created_at: string;
}

const ROOM_COLUMNS =
  "id, name, description, category, password_hash, max_users, sort_order, locked, screen_share_enabled, " +
  "audio_override, created_by, created_at, updated_at";

export interface RoomInput {
  name?: string;
  description?: string;
  category?: string;
  password?: string | null;
  maxUsers?: number;
  sortOrder?: number;
  locked?: boolean;
  screenShareEnabled?: boolean;
  audioOverride?: AudioOverride | null;
}

export interface CreateRoomInput extends RoomInput {
  name: string;
}

export class RoomsService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  private get defaults(): AudioSettings {
    return this.settings.get().defaultAudioSettings;
  }

  list(counts: Map<number, number>): RoomSummary[] {
    const rows = this.db.all<RoomRow>(
      "SELECT " + ROOM_COLUMNS + " FROM rooms ORDER BY category ASC, sort_order ASC, id ASC",
    );
    return rows.map((row) => this.toSummary(row, counts.get(row.id) ?? 0));
  }

  findById(id: number): RoomRow | undefined {
    return this.db.get<RoomRow>("SELECT " + ROOM_COLUMNS + " FROM rooms WHERE id = ?", id);
  }

  findByName(name: string): RoomRow | undefined {
    return this.db.get<RoomRow>("SELECT " + ROOM_COLUMNS + " FROM rooms WHERE name = ? COLLATE NOCASE", name);
  }

  countRooms(): number {
    return Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM rooms")?.count ?? 0);
  }

  countRoomUsers(roomId: number): number {
    return Number(
      this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM messages WHERE room_id = ?", roomId)?.count ?? 0,
    );
  }

  toSummary(row: RoomRow, userCount: number): RoomSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      hasPassword: row.password_hash !== null,
      maxUsers: this.maxUsersFor(row),
      userCount,
      locked: row.locked === 1,
      sortOrder: row.sort_order,
      screenShareEnabled: row.screen_share_enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 房间生效人数上限：max_users <= 0 表示继承服务器设置（默认 100、可调到 500）。
   * SFU 模式下没有客户端 P2P 互联的 10 人限制，容量只由服务器设置与房间配置决定。
   */
  maxUsersFor(row: RoomRow): number {
    const serverLimit = this.settings.get().maxUsersPerRoom;
    if (row.max_users <= 0) return serverLimit;
    return Math.min(row.max_users, serverLimit);
  }

  effectiveAudio(row: RoomRow): AudioSettings {
    const override = this.parseOverride(row.audio_override);
    return mergeAudioSettings(this.defaults, override);
  }

  toDetail(row: RoomRow, userCount: number): RoomDetail {
    const createdBy = row.created_by
      ? this.db.get<{ id: number; display_name: string }>("SELECT id, display_name FROM users WHERE id = ?", row.created_by) ?? null
      : null;
    return {
      ...this.toSummary(row, userCount),
      audioSettings: this.effectiveAudio(row),
      audioOverride: this.parseOverride(row.audio_override),
      createdBy: createdBy ? { id: createdBy.id, displayName: createdBy.display_name } : null,
    };
  }

  private parseOverride(json: string | null): AudioOverride | null {
    if (!json) return null;
    try {
      const parsed = JSON.parse(json) as AudioOverride;
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private normalizeOverride(input: AudioOverride | null | undefined): string | null {
    if (input === null || input === undefined) return null;
    const merged = mergeAudioSettings(this.defaults, input);
    const diff = diffAudioSettings(this.defaults, merged);
    if (!diff) return null;
    return JSON.stringify(diff);
  }

  create(input: CreateRoomInput, actorId: number | null): RoomRow {
    const defaults = this.settings.get();
    const category = (input.category ?? defaults.roomCategories[0] ?? "开黑房间").trim() || "开黑房间";
    const passwordHash = input.password ? hashRoomPassword(input.password) : null;
    const nextSort =
      input.sortOrder ??
      (Number(
        this.db.get<{ max: number | null }>("SELECT MAX(sort_order) AS max FROM rooms WHERE category = ?", category)?.max ?? 0,
      ) + 10);
    const timestamp = nowIso();
    const result = this.db.run(
      "INSERT INTO rooms (name, description, category, password_hash, max_users, sort_order, locked, screen_share_enabled, audio_override, created_by, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      input.name.trim(),
      (input.description ?? "").trim(),
      category,
      passwordHash,
      clampRoomMaxUsers(input.maxUsers),
      nextSort,
      input.locked ? 1 : 0,
      input.screenShareEnabled === false ? 0 : 1,
      this.normalizeOverride(input.audioOverride),
      actorId,
      timestamp,
      timestamp,
    );
    const row = this.findById(result.lastInsertRowid);
    if (!row) throw new Error("创建房间失败");
    return row;
  }

  update(id: number, input: RoomInput): RoomRow | undefined {
    const current = this.findById(id);
    if (!current) return undefined;
    const fields: string[] = [];
    const params: (string | number | null)[] = [];

    if (input.name !== undefined) {
      fields.push("name = ?");
      params.push(input.name.trim());
    }
    if (input.description !== undefined) {
      fields.push("description = ?");
      params.push(input.description.trim());
    }
    if (input.category !== undefined) {
      fields.push("category = ?");
      params.push(input.category.trim() || "开黑房间");
    }
    if (input.password !== undefined) {
      fields.push("password_hash = ?");
      params.push(input.password ? hashRoomPassword(input.password) : null);
    }
    if (input.maxUsers !== undefined) {
      fields.push("max_users = ?");
      params.push(clampRoomMaxUsers(input.maxUsers));
    }
    if (input.sortOrder !== undefined) {
      fields.push("sort_order = ?");
      params.push(Math.trunc(Number(input.sortOrder) || 0));
    }
    if (input.locked !== undefined) {
      fields.push("locked = ?");
      params.push(input.locked ? 1 : 0);
    }
    if (input.screenShareEnabled !== undefined) {
      fields.push("screen_share_enabled = ?");
      params.push(input.screenShareEnabled ? 1 : 0);
    }
    if (input.audioOverride !== undefined) {
      fields.push("audio_override = ?");
      params.push(this.normalizeOverride(input.audioOverride));
    }
    if (fields.length === 0) return current;
    fields.push("updated_at = ?");
    params.push(nowIso());
    params.push(id);
    this.db.run("UPDATE rooms SET " + fields.join(", ") + " WHERE id = ?", ...params);
    return this.findById(id);
  }

  remove(id: number): void {
    this.db.run("DELETE FROM rooms WHERE id = ?", id);
  }

  verifyPassword(row: RoomRow, password: string | null | undefined): boolean {
    if (!row.password_hash) return true;
    if (!password) return false;
    return verifyRoomPassword(password, row.password_hash);
  }

  hasPassword(row: RoomRow): boolean {
    return row.password_hash !== null;
  }

  listMessages(roomId: number, limit = 50, beforeId?: number): ChatMessage[] {
    const boundedLimit = Math.min(Math.max(1, limit), 200);
    const rows = beforeId
      ? this.db.all<MessageRow>(
          "SELECT id, room_id, user_id, sender_name, sender_role, kind, content, created_at FROM messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
          roomId,
          beforeId,
          boundedLimit,
        )
      : this.db.all<MessageRow>(
          "SELECT id, room_id, user_id, sender_name, sender_role, kind, content, created_at FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?",
          roomId,
          boundedLimit,
        );
    return rows.reverse().map((row) => this.toMessage(row));
  }

  addMessage(
    roomId: number,
    sender: { id: number | null; name: string; role: Role | "system" },
    content: string,
    kind: "text" | "system" = "text",
  ): ChatMessage {
    const result = this.db.run(
      "INSERT INTO messages (room_id, user_id, sender_name, sender_role, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      roomId,
      sender.id,
      sender.name,
      sender.role,
      kind,
      content,
      nowIso(),
    );
    this.pruneMessages(roomId);
    const message = this.db.get<MessageRow>(
      "SELECT id, room_id, user_id, sender_name, sender_role, kind, content, created_at FROM messages WHERE id = ?",
      result.lastInsertRowid,
    );
    if (!message) throw new Error("发送消息失败");
    return this.toMessage(message);
  }

  private pruneMessages(roomId: number): void {
    const keep = this.settings.get().maxMessagesPerRoom;
    if (keep <= 0) return;
    this.db.run(
      "DELETE FROM messages WHERE room_id = ? AND id NOT IN (SELECT id FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?)",
      roomId,
      roomId,
      keep,
    );
  }

  private toMessage(row: MessageRow): ChatMessage {
    return {
      id: row.id,
      roomId: row.room_id,
      userId: row.user_id,
      senderName: row.sender_name,
      senderRole: row.sender_role,
      kind: row.kind,
      content: row.content,
      createdAt: row.created_at,
    };
  }
}

function clampRoomMaxUsers(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(500, Math.max(0, Math.trunc(num)));
}
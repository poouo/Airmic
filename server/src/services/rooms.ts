import {
  diffAudioSettings,
  mergeAudioSettings,
  normalizeAudioSettings,
} from "@airmic/shared";
import type { AudioOverride, AudioSettings, ChatMessage, RoomArea, RoomDetail, RoomSummary, Role } from "@airmic/shared";
import type { Database } from "../db.js";
import { hashRoomPassword, verifyRoomPassword } from "../lib/password.js";
import { nowIso } from "../lib/time.js";
import type { SettingsService } from "./settings.js";
import type { RoomDirectoryService } from "./room-directory.js";

export interface RoomRow {
  id: number;
  area_id: number;
  name: string;
  description: string;
  category: string;
  channel: string;
  icon: string;
  password_hash: string | null;
  max_users: number;
  sort_order: number;
  locked: number;
  allow_guests: number;
  text_chat_enabled: number;
  chat_history_days: number;
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

const ROOM_SELECT = `SELECT r.*, child.name AS category, root.name AS channel FROM rooms r
  JOIN room_areas child ON child.id = r.area_id JOIN room_areas root ON root.id = child.parent_id`;

export interface RoomInput {
  name?: string;
  description?: string;
  areaId?: number;
  category?: string;
  channel?: string;
  icon?: string;
  password?: string | null;
  maxUsers?: number;
  sortOrder?: number;
  locked?: boolean;
  allowGuests?: boolean;
  textChatEnabled?: boolean;
  chatHistoryDays?: number;
  screenShareEnabled?: boolean;
  audioOverride?: AudioOverride | null;
}

export interface CreateRoomInput extends RoomInput {
  name: string;
}

export class RoomsService {
  private readonly guestOwners = new Map<number, number>();

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly directory: RoomDirectoryService,
  ) {}

  private get defaults(): AudioSettings {
    return this.settings.get().defaultAudioSettings;
  }

  list(counts: Map<number, number>): RoomSummary[] {
    const rows = this.db.all<RoomRow>(
      `${ROOM_SELECT} ORDER BY root.sort_order, root.id, child.sort_order, child.id, r.sort_order, r.id`,
    );
    return rows.map((row) => this.toSummary(row, counts.get(row.id) ?? 0));
  }

  findById(id: number): RoomRow | undefined {
    return this.db.get<RoomRow>(`${ROOM_SELECT} WHERE r.id = ?`, id);
  }

  findByName(areaId: number, name: string): RoomRow | undefined {
    return this.db.get<RoomRow>(`${ROOM_SELECT} WHERE r.area_id = ? AND r.name = ?`, areaId, name);
  }

  resolveArea(input: Pick<RoomInput, "areaId" | "channel" | "category">, current?: RoomRow): RoomArea | undefined {
    if (input.areaId !== undefined) {
      const area = this.directory.find(input.areaId);
      return area?.parentId != null ? area : undefined;
    }
    if (current && input.channel === undefined && input.category === undefined) return this.directory.find(current.area_id);
    const areas = this.directory.list();
    const channel = input.channel?.trim() || current?.channel;
    const category = input.category?.trim();
    const root = channel ? this.directory.findByName(null, channel) : undefined;
    if (channel && !root) return undefined;
    if (root && category) return this.directory.findByName(root.id, category);
    if (category) {
      for (const area of areas) {
        if (area.parentId !== null) continue;
        const match = this.directory.findByName(area.id, category);
        if (match) return match;
      }
      return undefined;
    }
    return areas.find((area) => area.parentId !== null && (!root || area.parentId === root.id));
  }

  countRooms(): number {
    return Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM rooms")?.count ?? 0);
  }

  ownerId(row: RoomRow): number | null {
    return row.created_by ?? this.guestOwners.get(row.id) ?? null;
  }

  releaseGuestRooms(guestId: number): void {
    for (const [roomId, ownerId] of this.guestOwners) {
      if (ownerId === guestId) this.guestOwners.delete(roomId);
    }
  }

  countRoomUsers(roomId: number): number {
    return Number(
      this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM messages WHERE room_id = ?", roomId)?.count ?? 0,
    );
  }

  toSummary(row: RoomRow, userCount: number): RoomSummary {
    return {
      id: row.id,
      areaId: row.area_id,
      createdById: this.ownerId(row),
      name: row.name,
      description: row.description,
      category: row.category,
      channel: row.channel,
      icon: row.icon,
      hasPassword: row.password_hash !== null,
      maxUsers: this.maxUsersFor(row),
      userCount,
      locked: row.locked === 1,
      allowGuests: row.allow_guests === 1,
      textChatEnabled: row.text_chat_enabled === 1,
      chatHistoryDays: row.chat_history_days,
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

  create(input: CreateRoomInput, actorId: number | null, guestOwner = false): RoomRow {
    const area = this.resolveArea(input);
    if (!area) throw new Error("创建房间需要有效的子区");
    const icon = (input.icon ?? "gamepad").trim() || "gamepad";
    const passwordHash = input.password ? hashRoomPassword(input.password) : null;
    const nextSort =
      input.sortOrder ??
      (Number(
        this.db.get<{ max: number | null }>(
          "SELECT MAX(sort_order) AS max FROM rooms WHERE area_id = ?",
          area.id,
        )?.max ?? 0,
      ) + 10);
    const timestamp = nowIso();
    const result = this.db.run(
      "INSERT INTO rooms (name, description, area_id, icon, password_hash, max_users, sort_order, locked, allow_guests, text_chat_enabled, chat_history_days, screen_share_enabled, audio_override, created_by, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      input.name.trim(),
      (input.description ?? "").trim(),
      area.id,
      icon,
      passwordHash,
      clampRoomMaxUsers(input.maxUsers),
      nextSort,
      input.locked ? 1 : 0,
      input.allowGuests === false ? 0 : 1,
      input.textChatEnabled === false ? 0 : 1,
      input.chatHistoryDays ?? 30,
      input.screenShareEnabled === false ? 0 : 1,
      this.normalizeOverride(input.audioOverride),
      guestOwner ? null : actorId,
      timestamp,
      timestamp,
    );
    const row = this.findById(result.lastInsertRowid);
    if (!row) throw new Error("创建房间失败");
    if (guestOwner && actorId !== null) this.guestOwners.set(row.id, actorId);
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
    if (input.areaId !== undefined || input.channel !== undefined || input.category !== undefined) {
      const area = this.resolveArea(input, current);
      if (!area) throw new Error("移动房间需要有效的子区");
      fields.push("area_id = ?");
      params.push(area.id);
    }
    if (input.icon !== undefined) {
      fields.push("icon = ?");
      params.push(input.icon.trim() || "gamepad");
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
    if (input.allowGuests !== undefined) {
      fields.push("allow_guests = ?");
      params.push(input.allowGuests ? 1 : 0);
    }
    if (input.textChatEnabled !== undefined) {
      fields.push("text_chat_enabled = ?");
      params.push(input.textChatEnabled ? 1 : 0);
    }
    if (input.chatHistoryDays !== undefined) {
      fields.push("chat_history_days = ?");
      params.push(input.chatHistoryDays);
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
    this.db.transaction(() => {
      this.db.run("UPDATE rooms SET " + fields.join(", ") + " WHERE id = ?", ...params);
      if (input.chatHistoryDays !== undefined && input.chatHistoryDays !== current.chat_history_days) {
        this.db.run(
          "DELETE FROM messages WHERE room_id = ? AND created_at <= ?",
          id,
          historyCutoff(Math.min(input.chatHistoryDays, current.chat_history_days)),
        );
      }
    });
    return this.findById(id);
  }

  remove(id: number): void {
    this.db.run("DELETE FROM rooms WHERE id = ?", id);
    this.guestOwners.delete(id);
  }

  verifyPassword(row: RoomRow, password: string | null | undefined): boolean {
    if (!row.password_hash) return true;
    if (!password) return false;
    return verifyRoomPassword(password, row.password_hash);
  }

  hasPassword(row: RoomRow): boolean {
    return row.password_hash !== null;
  }

  listMessages(room: RoomRow, limit = 50, beforeId?: number): ChatMessage[] {
    const boundedLimit = Math.min(Math.max(1, limit), 200);
    const cutoff = historyCutoff(room.chat_history_days);
    const rows = beforeId
      ? this.db.all<MessageRow>(
          "SELECT id, room_id, user_id, sender_name, sender_role, kind, content, created_at FROM messages WHERE room_id = ? AND created_at > ? AND id < ? ORDER BY id DESC LIMIT ?",
          room.id,
          cutoff,
          beforeId,
          boundedLimit,
        )
      : this.db.all<MessageRow>(
          "SELECT id, room_id, user_id, sender_name, sender_role, kind, content, created_at FROM messages WHERE room_id = ? AND created_at > ? ORDER BY id DESC LIMIT ?",
          room.id,
          cutoff,
          boundedLimit,
        );
    return rows.reverse().map((row) => this.toMessage(row));
  }

  purgeExpiredMessages(): void {
    this.db.run(`
      DELETE FROM messages WHERE id IN (
        SELECT m.id FROM rooms r JOIN messages m ON m.room_id = r.id
        WHERE m.created_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || r.chat_history_days || ' days')
      )
    `);
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
      sender.role === "guest" ? null : sender.id,
      sender.role === "guest" ? "游客" : sender.name,
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
    return { ...this.toMessage(message), userId: sender.id, senderName: sender.name };
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

function historyCutoff(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function clampRoomMaxUsers(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(500, Math.max(0, Math.trunc(num)));
}

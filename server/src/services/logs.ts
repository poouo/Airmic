import type {
  AdminLogListResponse,
  AdminLogQuery,
  AdminLogRow,
  LogCategory,
  LogLevel,
} from "@airmic/shared";
import type { AppConfig } from "../config.js";
import type { Database } from "../db.js";
import { nowIso } from "../lib/time.js";

export interface LogInput {
  level: LogLevel;
  category: LogCategory;
  message: string;
  meta?: unknown;
  userId?: number | null;
  username?: string | null;
  ip?: string | null;
  requestId?: string | null;
}

interface PendingLog {
  createdAt: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  meta: string | null;
  userId: number | null;
  username: string | null;
  ip: string | null;
  requestId: string | null;
}

interface LogDbRow {
  id: number;
  created_at: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  meta: string | null;
  user_id: number | null;
  username: string | null;
  ip: string | null;
  request_id: string | null;
}

const LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const LOG_CATEGORIES: LogCategory[] = ["http", "ws", "auth", "admin", "system", "room", "voice", "error", "security"];
const FLUSH_INTERVAL_MS = 300;
const FLUSH_THRESHOLD = 100;
const CLEANUP_INTERVAL_MS = 10 * 60_000;
const MAX_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 50_000;

function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    if (!text) return null;
    return text.length > 8000 ? text.slice(0, 8000) + "…(truncated)" : text;
  } catch {
    return null;
  }
}

function toRow(row: LogDbRow): AdminLogRow {
  return {
    id: row.id,
    createdAt: row.created_at,
    level: row.level,
    category: row.category,
    message: row.message,
    meta: row.meta,
    userId: row.user_id,
    username: row.username,
    ip: row.ip,
    requestId: row.request_id,
  };
}

/**
 * 运行日志：写入 SQLite（app_logs 表），默认保留 3 天，自动分批清理。
 * 供管理后台分页查看与导出（CSV/JSON），用于排障。
 */
export class LogsService {
  private queue: PendingLog[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  readonly retentionDays: number;

  constructor(
    private readonly db: Database,
    config: AppConfig,
  ) {
    this.retentionDays = config.logRetentionDays;
    this.cleanup();
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  /** 记录一条日志（异步入队，批量写库，避免拖慢请求） */
  write(input: LogInput): void {
    const message = (input.message ?? "").slice(0, 4000);
    if (!message) return;
    const level = LOG_LEVELS.includes(input.level) ? input.level : "info";
    const category = LOG_CATEGORIES.includes(input.category) ? input.category : "system";
    this.queue.push({
      createdAt: nowIso(),
      level,
      category,
      message,
      meta: safeJson(input.meta),
      userId: input.userId ?? null,
      username: input.username ? input.username.slice(0, 64) : null,
      ip: input.ip ? input.ip.slice(0, 64) : null,
      requestId: input.requestId ? input.requestId.slice(0, 64) : null,
    });
    if (this.queue.length >= FLUSH_THRESHOLD) {
      this.flushNow();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushNow();
      }, FLUSH_INTERVAL_MS);
      this.flushTimer.unref?.();
    }
  }

  /** 立即把队列写入数据库（查询/导出/关闭前调用） */
  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      this.db.transaction(() => {
        for (const item of batch) {
          this.db.run(
            "INSERT INTO app_logs (created_at, level, category, message, meta, user_id, username, ip, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            item.createdAt,
            item.level,
            item.category,
            item.message,
            item.meta,
            item.userId,
            item.username,
            item.ip,
            item.requestId,
          );
        }
      });
    } catch (error) {
      console.error("[logs] 写入运行日志失败", error);
    }
  }

  list(query: AdminLogQuery): AdminLogListResponse {
    this.flushNow();
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || 50));
    const { where, params } = this.buildWhere(query);
    const total = Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM app_logs " + where, ...params)?.count ?? 0);
    const rows = this.db.all<LogDbRow>(
      "SELECT id, created_at, level, category, message, meta, user_id, username, ip, request_id FROM app_logs " +
        where +
        " ORDER BY id DESC LIMIT ? OFFSET ?",
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    const levelRows = this.db.all<{ level: LogLevel; count: number }>(
      "SELECT level, COUNT(*) AS count FROM app_logs " + where + " GROUP BY level",
      ...params,
    );
    const range = this.db.get<{ oldest: string | null; newest: string | null }>(
      "SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest FROM app_logs " + where,
      ...params,
    );
    const levelCounts: Partial<Record<LogLevel, number>> = {};
    for (const item of levelRows) levelCounts[item.level] = Number(item.count);
    return {
      items: rows.map(toRow),
      total,
      page,
      pageSize,
      retentionDays: this.retentionDays,
      oldest: range?.oldest ?? null,
      newest: range?.newest ?? null,
      levelCounts,
    };
  }

  export(query: AdminLogQuery, format: "csv" | "json"): { filename: string; contentType: string; content: string } {
    this.flushNow();
    const { where, params } = this.buildWhere(query);
    const rows = this.db.all<LogDbRow>(
      "SELECT id, created_at, level, category, message, meta, user_id, username, ip, request_id FROM app_logs " +
        where +
        " ORDER BY id DESC LIMIT ?",
      ...params,
      MAX_EXPORT_ROWS,
    );
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (format === "json") {
      return {
        filename: "airmic-logs-" + timestamp + ".json",
        contentType: "application/json; charset=utf-8",
        content: JSON.stringify(rows.map(toRow), null, 2),
      };
    }
    const header = ["时间", "级别", "分类", "消息", "用户ID", "用户名", "IP", "请求ID", "附加信息"];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.created_at,
          row.level,
          row.category,
          row.message,
          row.user_id ?? "",
          row.username ?? "",
          row.ip ?? "",
          row.request_id ?? "",
          row.meta ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return {
      filename: "airmic-logs-" + timestamp + ".csv",
      contentType: "text/csv; charset=utf-8",
      content: "\ufeff" + lines.join("\r\n"),
    };
  }

  /** 删除超过保留天数的日志，返回删除条数 */
  cleanup(): number {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.run("DELETE FROM app_logs WHERE created_at < ?", cutoff);
    return result.changes;
  }

  stats(): { total: number; retentionDays: number; oldest: string | null; newest: string | null } {
    this.flushNow();
    const total = Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM app_logs")?.count ?? 0);
    const range = this.db.get<{ oldest: string | null; newest: string | null }>(
      "SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest FROM app_logs",
    );
    return { total, retentionDays: this.retentionDays, oldest: range?.oldest ?? null, newest: range?.newest ?? null };
  }

  shutdown(): void {
    this.flushNow();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private buildWhere(query: AdminLogQuery): { where: string; params: (string | number)[] } {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (query.level && LOG_LEVELS.includes(query.level)) {
      conditions.push("level = ?");
      params.push(query.level);
    }
    if (query.category && LOG_CATEGORIES.includes(query.category)) {
      conditions.push("category = ?");
      params.push(query.category);
    }
    if (query.search) {
      const like = "%" + query.search.trim().slice(0, 100) + "%";
      conditions.push("(message LIKE ? OR username LIKE ? OR ip LIKE ? OR meta LIKE ?)");
      params.push(like, like, like, like);
    }
    if (query.from) {
      conditions.push("created_at >= ?");
      params.push(query.from);
    }
    if (query.to) {
      conditions.push("created_at <= ?");
      params.push(query.to);
    }
    return { where: conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "", params };
  }
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}
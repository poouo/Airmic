import type { AuditRow } from "@airmic/shared";
import type { Database } from "../db.js";
import { nowIso } from "../lib/time.js";

interface AuditDbRow {
  id: number;
  actor_id: number | null;
  actor_name: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  details: string | null;
  ip: string | null;
  created_at: string;
}

export interface AuditInput {
  actorId?: number | null;
  actorName: string;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  targetName?: string | null;
  details?: string | null;
  ip?: string | null;
}

export class AuditService {
  constructor(private readonly db: Database) {}

  log(input: AuditInput): void {
    this.db.run(
      "INSERT INTO audit_log (actor_id, actor_name, action, target_type, target_id, target_name, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      input.actorId ?? null,
      input.actorName,
      input.action,
      input.targetType ?? null,
      input.targetId !== undefined && input.targetId !== null ? String(input.targetId) : null,
      input.targetName ?? null,
      input.details ?? null,
      input.ip ?? null,
      nowIso(),
    );
  }

  list(options: { page: number; pageSize: number; action?: string }): { items: AuditRow[]; total: number } {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (options.action) {
      conditions.push("action = ?");
      params.push(options.action);
    }
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const total = Number(this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_log " + where, ...params)?.count ?? 0);
    const rows = this.db.all<AuditDbRow>(
      "SELECT id, actor_id, actor_name, action, target_type, target_id, target_name, details, ip, created_at FROM audit_log " +
        where +
        " ORDER BY id DESC LIMIT ? OFFSET ?",
      ...params,
      options.pageSize,
      (options.page - 1) * options.pageSize,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorName: row.actor_name,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        targetName: row.target_name,
        details: row.details,
        ip: row.ip,
        createdAt: row.created_at,
      })),
      total,
    };
  }

  recent(limit = 10): AuditRow[] {
    return this.list({ page: 1, pageSize: Math.min(Math.max(1, limit), 50) }).items;
  }
}

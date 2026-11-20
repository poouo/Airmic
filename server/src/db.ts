import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./schema.js";

export type SqlParam = string | number | bigint | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/**
 * 轻量 SQLite 封装（基于 Node 内置 node:sqlite，无需编译原生模块）。
 */
export class Database {
  readonly raw: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
    }
    this.raw = new DatabaseSync(filename);
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec("PRAGMA busy_timeout = 5000");
    if (filename !== ":memory:") {
      try {
        this.raw.exec("PRAGMA journal_mode = WAL");
        this.raw.exec("PRAGMA synchronous = NORMAL");
      } catch {
        /* WAL 在某些文件系统不可用，忽略 */
      }
    }
    this.migrate();
  }

  private migrate(): void {
    const row = this.raw.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
    const current = Number(row?.user_version ?? 0);
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      this.transaction(() => {
        this.raw.exec(migration.sql);
        this.raw.exec(`PRAGMA user_version = ${migration.version}`);
      });
    }
  }

  get<T>(sql: string, ...params: SqlParam[]): T | undefined {
    const statement = this.raw.prepare(sql);
    return statement.get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SqlParam[]): T[] {
    const statement = this.raw.prepare(sql);
    return statement.all(...params) as T[];
  }

  run(sql: string, ...params: SqlParam[]): RunResult {
    const statement = this.raw.prepare(sql);
    const result = statement.run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.raw.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw error;
    }
  }

  close(): void {
    try {
      this.raw.close();
    } catch {
      /* ignore */
    }
  }
}

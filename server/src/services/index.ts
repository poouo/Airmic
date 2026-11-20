import { Database } from "../db.js";
import { hashPassword } from "../lib/password.js";
import { nowIso } from "../lib/time.js";
import type { AppConfig } from "../config.js";
import type { Services } from "../types.js";
import { AuditService } from "./audit.js";
import { AuthService } from "./auth.js";
import { BansService } from "./bans.js";
import { RoomsService } from "./rooms.js";
import { SettingsService } from "./settings.js";
import { UsersService } from "./users.js";

export function createServices(config: AppConfig): Services {
  const db = new Database(config.databasePath);
  const settings = new SettingsService(db, config);
  const users = new UsersService(db);
  const rooms = new RoomsService(db, settings);
  const bans = new BansService(db, users);
  const audit = new AuditService(db);
  const auth = new AuthService(db, users, settings, config);

  const services: Services = {
    config,
    db,
    settings,
    users,
    rooms,
    bans,
    audit,
    auth,
    startedAt: nowIso(),
  };

  bootstrap(services);

  return services;
}

/** 启动时的数据维护：初始管理员、过期数据清理 */
function bootstrap(services: Services): void {
  const { config, users, settings, bans, audit, auth } = services;

  if (config.adminUsername && config.adminPassword && users.countAdmins() === 0) {
    const existing = users.findByUsername(config.adminUsername);
    if (existing) {
      users.updateRole(existing.id, "admin");
      audit.log({ actorName: "system", action: "bootstrap_admin_promote", targetType: "user", targetId: existing.id, targetName: existing.username });
    } else {
      const row = users.create({
        username: config.adminUsername,
        displayName: config.adminUsername,
        passwordHash: hashPassword(config.adminPassword),
        role: "admin",
        ip: null,
      });
      audit.log({ actorName: "system", action: "bootstrap_admin_create", targetType: "user", targetId: row.id, targetName: row.username });
    }
  }

  bans.expireOld();
  users.cleanupGuests(7);
  services.db.run("DELETE FROM sessions WHERE revoked = 1 OR expires_at < ?", nowIso());

  // 定期执行清理任务
  const interval = setInterval(() => {
    try {
      bans.expireOld();
      services.db.run("DELETE FROM sessions WHERE expires_at < ?", nowIso());
    } catch {
      /* 忽略清理错误 */
    }
  }, 60_000);
  interval.unref?.();
  void settings;
}

export type { Services };
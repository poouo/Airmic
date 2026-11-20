import type { UserSelf } from "@airmic/shared";
import type { AppConfig } from "./config.js";
import type { Database } from "./db.js";
import type { AuditService } from "./services/audit.js";
import type { AuthService } from "./services/auth.js";
import type { BansService } from "./services/bans.js";
import type { RoomsService } from "./services/rooms.js";
import type { SettingsService } from "./services/settings.js";
import type { UsersService } from "./services/users.js";

export interface AuthContext {
  user: UserSelf;
  sessionId: string;
  token: string;
}

export interface Services {
  config: AppConfig;
  db: Database;
  settings: SettingsService;
  users: UsersService;
  rooms: RoomsService;
  bans: BansService;
  audit: AuditService;
  auth: AuthService;
  startedAt: string;
}

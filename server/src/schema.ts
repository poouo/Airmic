/** 数据库结构与迁移定义 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const V1 = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  is_guest      INTEGER NOT NULL DEFAULT 0,
  is_banned     INTEGER NOT NULL DEFAULT 0,
  ban_reason    TEXT,
  banned_until  TEXT,
  avatar_color  TEXT NOT NULL DEFAULT '#6366f1',
  avatar_emoji  TEXT,
  status_text   TEXT NOT NULL DEFAULT '',
  last_ip       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS rooms (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description          TEXT NOT NULL DEFAULT '',
  category             TEXT NOT NULL DEFAULT '开黑房间',
  password_hash        TEXT,
  max_users            INTEGER NOT NULL DEFAULT 0,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  locked               INTEGER NOT NULL DEFAULT 0,
  screen_share_enabled INTEGER NOT NULL DEFAULT 1,
  audio_override       TEXT,
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_order ON rooms(category, sort_order, id);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'user',
  kind        TEXT NOT NULL DEFAULT 'text',
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);

CREATE TABLE IF NOT EXISTS bans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT,
  ip          TEXT,
  reason      TEXT NOT NULL,
  banned_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_bans_active ON bans(active, expires_at);
CREATE INDEX IF NOT EXISTS idx_bans_user ON bans(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  target_name TEXT,
  details     TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const V2 = `
CREATE TABLE IF NOT EXISTS app_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  level       TEXT NOT NULL,
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  meta        TEXT,
  user_id     INTEGER,
  username    TEXT,
  ip          TEXT,
  request_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_logs_created ON app_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_category ON app_logs(category, created_at DESC);
`;

const V3 = `
ALTER TABLE rooms ADD COLUMN channel TEXT NOT NULL DEFAULT '默认频道';
ALTER TABLE rooms ADD COLUMN icon TEXT NOT NULL DEFAULT 'gamepad';
CREATE INDEX IF NOT EXISTS idx_rooms_channel ON rooms(channel, category, sort_order, id);
`;

const V4 = `
CREATE TABLE room_areas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES room_areas(id) ON DELETE RESTRICT,
  name       TEXT NOT NULL COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_room_areas_root_name ON room_areas(name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX idx_room_areas_child_name ON room_areas(parent_id, name) WHERE parent_id IS NOT NULL;

INSERT INTO room_areas (name)
SELECT DISTINCT COALESCE(NULLIF(TRIM(channel), ''), '默认频道') COLLATE NOCASE FROM rooms ORDER BY 1;
INSERT INTO room_areas (parent_id, name)
SELECT DISTINCT a.id, COALESCE(NULLIF(TRIM(r.category), ''), '开黑房间') COLLATE NOCASE
FROM rooms r JOIN room_areas a ON a.parent_id IS NULL AND a.name = COALESCE(NULLIF(TRIM(r.channel), ''), '默认频道')
ORDER BY 1, 2;
INSERT INTO room_areas (name) SELECT '默认频道' WHERE NOT EXISTS (SELECT 1 FROM room_areas);
INSERT INTO room_areas (parent_id, name)
SELECT a.id, '开黑房间' FROM room_areas a WHERE NOT EXISTS (SELECT 1 FROM rooms);
INSERT OR IGNORE INTO room_areas (parent_id, name)
SELECT (SELECT id FROM room_areas WHERE parent_id IS NULL ORDER BY (name = '默认频道') DESC, id LIMIT 1), TRIM(j.value)
FROM settings s, json_each(CASE WHEN json_valid(s.value) THEN s.value ELSE '[]' END) j
WHERE s.key = 'roomCategories' AND j.type = 'text' AND LENGTH(TRIM(j.value)) BETWEEN 1 AND 20
  AND NOT EXISTS (SELECT 1 FROM room_areas a WHERE a.parent_id IS NOT NULL AND a.name = TRIM(j.value));

CREATE TEMP TABLE room_migration_sequences AS SELECT name, seq FROM sqlite_sequence WHERE name IN ('rooms', 'messages');
CREATE TABLE rooms_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id              INTEGER NOT NULL REFERENCES room_areas(id) ON DELETE RESTRICT,
  name                 TEXT NOT NULL COLLATE NOCASE,
  description          TEXT NOT NULL DEFAULT '',
  icon                 TEXT NOT NULL DEFAULT 'gamepad',
  password_hash        TEXT,
  max_users            INTEGER NOT NULL DEFAULT 0,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  locked               INTEGER NOT NULL DEFAULT 0,
  screen_share_enabled INTEGER NOT NULL DEFAULT 1,
  audio_override       TEXT,
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (area_id, name)
);
INSERT INTO rooms_new
SELECT r.id, child.id, r.name, r.description, r.icon, r.password_hash, r.max_users, r.sort_order,
       r.locked, r.screen_share_enabled, r.audio_override, r.created_by, r.created_at, r.updated_at
FROM rooms r
JOIN room_areas root ON root.parent_id IS NULL AND root.name = COALESCE(NULLIF(TRIM(r.channel), ''), '默认频道')
JOIN room_areas child ON child.parent_id = root.id AND child.name = COALESCE(NULLIF(TRIM(r.category), ''), '开黑房间');

CREATE TABLE messages_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES rooms_new(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'user',
  kind        TEXT NOT NULL DEFAULT 'text',
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
INSERT INTO messages_new SELECT * FROM messages;
DROP TABLE messages;
DROP TABLE rooms;
ALTER TABLE rooms_new RENAME TO rooms;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX idx_rooms_area_order ON rooms(area_id, sort_order, id);
CREATE INDEX idx_messages_room ON messages(room_id, id);
DELETE FROM sqlite_sequence WHERE name IN (SELECT name FROM room_migration_sequences);
INSERT INTO sqlite_sequence SELECT name, seq FROM room_migration_sequences;
DROP TABLE room_migration_sequences;

CREATE TABLE room_management_grants (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id INTEGER REFERENCES room_areas(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  CHECK ((area_id IS NULL) != (room_id IS NULL)),
  UNIQUE (area_id, user_id),
  UNIQUE (room_id, user_id)
);
CREATE INDEX idx_room_grants_user ON room_management_grants(user_id);
`;

const V5 = `
ALTER TABLE rooms ADD COLUMN allow_guests INTEGER NOT NULL DEFAULT 1;
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial-schema", sql: V1 },
  { version: 2, name: "app-logs", sql: V2 },
  { version: 3, name: "room-channel-icon", sql: V3 },
  { version: 4, name: "room-directory", sql: V4 },
  { version: 5, name: "room-guest-access", sql: V5 },
];

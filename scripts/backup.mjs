#!/usr/bin/env node
/**
 * AirMic 数据库备份脚本
 *
 * 使用 SQLite 的 VACUUM INTO 生成一致性快照（兼容 WAL 模式，服务运行中也可执行），
 * 备份完成后用 PRAGMA integrity_check 校验，并按保留份数清理旧备份。
 *
 * 用法:
 *   node scripts/backup.mjs
 *   node scripts/backup.mjs --db ./data/airmic.db --dir ./backups --retention 10
 *
 * 环境变量:
 *   DATABASE_PATH   数据库文件（默认 ./data/airmic.db，相对项目根目录）
 *   BACKUP_DIR      备份目录（默认 ./backups，相对项目根目录）
 *   RETENTION       保留最近 N 份（默认 10；也兼容 BACKUP_RETENTION）
 *
 * 项目根目录 .env 会被读取（不覆盖已有的环境变量），因此通常直接 npm run backup 即可。
 * 脚本可以从任意工作目录运行。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

const DEFAULT_DB = "./data/airmic.db";
const DEFAULT_BACKUP_DIR = "./backups";
const DEFAULT_RETENTION = 10;

function loadDotEnv(root) {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  let content = "";
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(PROJECT_ROOT);

function resolveFromRoot(input, fallback) {
  const value = (input && String(input).trim()) || fallback;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(PROJECT_ROOT, value);
}

function parseInteger(value, fallback) {
  const num = Number.parseInt(String(value === undefined ? "" : value), 10);
  return Number.isFinite(num) ? num : fallback;
}

function printHelp() {
  console.log([
    "AirMic 数据库备份",
    "",
    "用法:",
    "  node scripts/backup.mjs [选项]",
    "",
    "选项:",
    "  --db <路径>          数据库文件（默认 DATABASE_PATH 或 ./data/airmic.db）",
    "  --dir <路径>         备份目录（默认 BACKUP_DIR 或 ./backups）",
    "  --retention <数量>   保留最近 N 份（默认 RETENTION 或 10）",
    "  --verify             备份后执行完整性检查（默认开启）",
    "  --skip-verify        跳过完整性检查（超大数据库可加速）",
    "  --help               显示本帮助",
    "",
    "环境变量:",
    "  DATABASE_PATH / BACKUP_DIR / RETENTION（兼容 BACKUP_RETENTION）",
    "  项目根目录的 .env 会被读取；已存在的环境变量优先。",
  ].join("\n"));
}

function parseArgs(argv) {
  const options = { help: false, verify: true, db: undefined, dir: undefined, retention: undefined, unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--skip-verify") {
      options.verify = false;
      continue;
    }
    if (arg === "--verify") {
      options.verify = true;
      continue;
    }
    if (arg.startsWith("--db=") || arg.startsWith("--dir=") || arg.startsWith("--retention=")) {
      const eq = arg.indexOf("=");
      options[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    if (arg === "--db" || arg === "--dir" || arg === "--retention") {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        options[arg.slice(2)] = value;
        i += 1;
        continue;
      }
    }
    options.unknown.push(arg);
  }
  return options;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  if (bytes < 1024) return bytes + " B";
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let index = -1;
  do {
    value /= 1024;
    index += 1;
  } while (value >= 1024 && index < units.length - 1);
  return value.toFixed(1) + " " + units[index];
}

function timestamp(date) {
  const pad = (num) => String(num).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "-" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function sqlString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function verifyBackup(filePath) {
  const db = new DatabaseSync(filePath);
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    const value = String(Object.values(integrity || {})[0] || "");
    if (value.toLowerCase() !== "ok") throw new Error("integrity_check 返回: " + value);
    const tables = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get();
    const version = db.prepare("PRAGMA user_version").get();
    return {
      tables: Number((tables && tables.count) || 0),
      userVersion: Number(Object.values(version || {})[0] || 0),
    };
  } finally {
    db.close();
  }
}

function cleanOldBackups(backupDir, baseName, retention) {
  const prefix = baseName + "-";
  const entries = [];
  for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".db")) continue;
    const fullPath = path.join(backupDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      entries.push({ path: fullPath, name: entry.name, mtimeMs: stat.mtimeMs });
    } catch {
      /* 忽略无法读取的文件 */
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const removed = [];
  for (const entry of entries.slice(retention)) {
    try {
      fs.rmSync(entry.path, { force: true });
      removed.push(entry.name);
    } catch (error) {
      console.warn("[backup] 警告: 无法删除旧备份 " + entry.name + ": " + (error && error.message ? error.message : error));
    }
  }
  return { kept: Math.min(entries.length, retention), removed };
}

function runBackup() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.unknown.length > 0) console.warn("[backup] 忽略未知参数: " + args.unknown.join(" "));

  const dbPath = resolveFromRoot(args.db !== undefined ? args.db : process.env.DATABASE_PATH, DEFAULT_DB);
  const backupDir = resolveFromRoot(args.dir !== undefined ? args.dir : process.env.BACKUP_DIR, DEFAULT_BACKUP_DIR);
  const retention = Math.min(
    3650,
    Math.max(1, parseInteger(args.retention !== undefined ? args.retention : process.env.RETENTION !== undefined ? process.env.RETENTION : process.env.BACKUP_RETENTION, DEFAULT_RETENTION)),
  );

  if (dbPath === ":memory:") {
    console.error("[backup] ✗ 数据库路径为 :memory:，内存数据库无法备份。");
    return 1;
  }
  if (!fs.existsSync(dbPath)) {
    console.error("[backup] ✗ 数据库文件不存在: " + dbPath);
    console.error("[backup]   请先启动一次 AirMic 服务（首次启动会自动创建数据库和表结构），");
    console.error("[backup]   或用 DATABASE_PATH / --db 指定正确的路径。");
    console.error("[backup]   当前项目根目录: " + PROJECT_ROOT);
    console.error("[backup]   当前 DATABASE_PATH: " + (process.env.DATABASE_PATH || "(未设置，使用默认 " + DEFAULT_DB + ")"));
    return 1;
  }
  let dbStats;
  try {
    dbStats = fs.statSync(dbPath);
  } catch (error) {
    console.error("[backup] ✗ 无法读取数据库文件 " + dbPath + ": " + (error && error.message ? error.message : error));
    return 1;
  }
  if (!dbStats.isFile()) {
    console.error("[backup] ✗ 数据库路径不是文件: " + dbPath);
    return 1;
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const baseName = path.basename(dbPath, path.extname(dbPath)) || "airmic";
  const stamp = timestamp(new Date());
  let target = path.join(backupDir, baseName + "-" + stamp + ".db");
  let sequence = 1;
  while (fs.existsSync(target)) {
    target = path.join(backupDir, baseName + "-" + stamp + "-" + sequence + ".db");
    sequence += 1;
  }

  console.log("[backup] 数据库: " + dbPath + " (" + formatBytes(dbStats.size) + ")");
  console.log("[backup] 备份到: " + target);

  let db = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA busy_timeout = 10000");
    db.prepare("SELECT count(*) AS count FROM sqlite_master").get();
    // VACUUM INTO 在单个读事务中生成一致的数据库快照，WAL 模式下同样安全。
    db.exec("VACUUM INTO " + sqlString(target));
  } catch (error) {
    try {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    } catch {
      /* 忽略清理失败 */
    }
    console.error("[backup] ✗ 备份失败: " + (error && error.message ? error.message : error));
    return 1;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* 忽略关闭失败 */
      }
    }
  }

  let backupStats;
  try {
    backupStats = fs.statSync(target);
  } catch (error) {
    console.error("[backup] ✗ 备份文件未生成: " + target);
    return 1;
  }
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    /* Windows 上 chmod 语义有限，忽略 */
  }

  let info = { tables: 0, userVersion: 0 };
  if (args.verify) {
    try {
      info = verifyBackup(target);
    } catch (error) {
      console.error("[backup] ✗ 备份完整性检查失败: " + (error && error.message ? error.message : error));
      console.error("[backup]   备份文件保留用于排查: " + target);
      return 1;
    }
  }

  console.log(
    "[backup] ✓ 完成: " + formatBytes(backupStats.size) +
      "，表 " + info.tables + " 张" +
      (info.userVersion > 0 ? "，schema v" + info.userVersion : ""),
  );

  let cleanup = { kept: 0, removed: [] };
  try {
    cleanup = cleanOldBackups(backupDir, baseName, retention);
  } catch (error) {
    console.warn("[backup] 警告: 清理旧备份失败: " + (error && error.message ? error.message : error));
  }
  if (cleanup.removed.length > 0) {
    console.log("[backup] 已清理 " + cleanup.removed.length + " 份旧备份: " + cleanup.removed.join(", "));
  }
  console.log("[backup] 当前保留 " + cleanup.kept + " 份（RETENTION=" + retention + "），目录: " + backupDir);
  return 0;
}

try {
  process.exitCode = runBackup();
} catch (error) {
  console.error("[backup] ✗ 未预期的错误: " + (error && error.stack ? error.stack : error));
  process.exitCode = 1;
}

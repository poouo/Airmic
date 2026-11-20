import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** 项目根目录：从 server/src|server/dist 向上两级 */
export const ROOT_DIR = path.resolve(moduleDir, "../..");

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** 读取项目根目录 .env（不覆盖已有环境变量）。避免引入额外依赖。 */
export function loadDotEnv(rootDir: string = ROOT_DIR): void {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = stripQuotes(line.slice(eq + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

export interface AppConfig {
  rootDir: string;
  isProduction: boolean;
  host: string;
  port: number;
  databasePath: string;
  jwtSecret: string | null;
  adminUsername: string | null;
  adminPassword: string | null;
  trustProxy: boolean;
  webDist: string;
  logLevel: string;
  ssl: { key: string; cert: string } | null;
  /** 初始化口令；设置后只有知道口令的人能完成首次初始化 */
  setupToken: string | null;
  /** LiveKit SFU 配置（可选） */
  livekitUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
  /** GitHub 仓库（owner/repo），用于在线检查新版本 */
  githubRepo: string;
  /** GitHub Token（可选，提高 API 速率限制/访问私有仓库） */
  githubToken: string | null;
  /** 运行日志保留天数（默认 3 天，到点自动清理） */
  logRetentionDays: number;
  userSessionTtlDays: number;
  guestSessionTtlHours: number;
}

function readFileIfExists(filePath: string): string | null {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(ROOT_DIR, filePath);
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved, "utf8");
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const port = Number(process.env.PORT ?? 9811);
  const sslKey = process.env.SSL_KEY ? readFileIfExists(process.env.SSL_KEY) : null;
  const sslCert = process.env.SSL_CERT ? readFileIfExists(process.env.SSL_CERT) : null;
  const ssl = sslKey && sslCert ? { key: sslKey, cert: sslCert } : null;

  const config: AppConfig = {
    rootDir: ROOT_DIR,
    isProduction,
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.isFinite(port) && port > 0 ? port : 9811,
    databasePath: path.resolve(ROOT_DIR, process.env.DATABASE_PATH ?? "./data/airmic.db"),
    jwtSecret: process.env.JWT_SECRET?.trim() || null,
    adminUsername: process.env.ADMIN_USERNAME?.trim() || null,
    adminPassword: process.env.ADMIN_PASSWORD?.trim() || null,
    trustProxy: (process.env.TRUST_PROXY ?? "false").toLowerCase() === "true",
    webDist: path.resolve(ROOT_DIR, process.env.WEB_DIST ?? "./web/dist"),
    logLevel: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
    ssl,
    setupToken: process.env.SETUP_TOKEN?.trim() || null,
    livekitUrl: process.env.LIVEKIT_URL?.trim() || null,
    livekitApiKey: process.env.LIVEKIT_API_KEY?.trim() || null,
    livekitApiSecret: process.env.LIVEKIT_API_SECRET?.trim() || null,
    githubRepo: process.env.AIRMIC_REPO?.trim() || "poouo/Airmic",
    githubToken: process.env.GITHUB_TOKEN?.trim() || null,
    logRetentionDays: Math.min(30, Math.max(1, Number(process.env.LOG_RETENTION_DAYS ?? 3) || 3)),
    userSessionTtlDays: Number(process.env.USER_SESSION_TTL_DAYS ?? 30),
    guestSessionTtlHours: Number(process.env.GUEST_SESSION_TTL_HOURS ?? 24),
  };
  return { ...config, ...overrides };
}
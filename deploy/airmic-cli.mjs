#!/usr/bin/env node
/**
 * AirMic 部署 CLI（本地 / Docker 一键部署、状态、日志、在线更新检查、OTA 升级、卸载）
 *
 * 运行环境：Node.js >= 18（建议 >= 22.13，与应用一致）
 * 依赖：仅 Node 内置模块 + 系统命令（npm、tar、docker）；无需新增 npm 依赖
 *
 * 典型用法：
 *   node deploy/airmic-cli.mjs install --mode local --yes
 *   node deploy/airmic-cli.mjs status
 *   node deploy/airmic-cli.mjs check-update
 *   node deploy/airmic-cli.mjs upgrade
 *   node deploy/airmic-cli.mjs uninstall
 *
 * 安装目录（AIRMIC_HOME，默认 Windows: %USERPROFILE%\.airmic，macOS/Linux: ~/.airmic）：
 *   app/ data/ config/ livekit/ logs/ backups/ run/ bin/ version.json
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import http from "node:http";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_VERSION = "1.1.0";
const APP_NAME = "AirMic";
const REPO = "poouo/Airmic";
const REPO_URL = "https://github.com/" + REPO;
const DEFAULT_PORT = 9811;
const DEFAULT_LIVEKIT_VERSION = "v1.13.11";
const MIN_NODE_APP = "22.13.0";
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";

const CLI_FILE = fileURLToPath(import.meta.url);
const CLI_DIR = path.dirname(CLI_FILE);

const EXCLUDE_TOP = new Set([
  "node_modules", ".git", ".tools", "data", "logs", "backups", "certs", ".staging", ".github",
]);
const EXCLUDE_REL = new Set([
  path.join("web", "dist"),
  path.join("server", "dist"),
  path.join("shared", "dist"),
  path.join("e2e", "artifacts"),
  path.join("e2e", "screenshots"),
]);

const HOME_DIRS = ["app", "data", "config", "livekit", path.join("livekit", "bin"), "logs", "backups", "run", "bin"];

function log(message) {
  console.log(message);
}

function warn(message) {
  console.error("[警告] " + message);
}

function step(index, total, message) {
  console.log("[" + index + "/" + total + "] " + message);
}

function fail(message) {
  throw new Error(message);
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function chmodPrivate(filePath) {
  if (IS_WIN) return;
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isProcessAlive(pid) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

function readPid(home, name) {
  const pidPath = path.join(home, "run", name + ".pid");
  if (!exists(pidPath)) return null;
  const value = Number(fs.readFileSync(pidPath, "utf8").trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function writePid(home, name, pid) {
  const runDir = path.join(home, "run");
  mkdirp(runDir);
  fs.writeFileSync(path.join(runDir, name + ".pid"), String(pid) + "\n", "utf8");
}

function removePid(home, name) {
  const pidPath = path.join(home, "run", name + ".pid");
  try {
    fs.rmSync(pidPath, { force: true });
  } catch {
    /* ignore */
  }
}

// ============ 命令行参数 ============

const COMMANDS = [
  "install", "start", "stop", "restart", "status", "logs", "check-update", "upgrade", "uninstall",
  "docker-up", "docker-down", "docker-logs", "docker-status", "version", "help",
];

const OPTION_SPEC = {
  mode: "value",
  dir: "value",
  source: "value",
  port: "value",
  host: "value",
  livekit_version: "value",
  setup_token: "optional-value",
  yes: "flag",
  force: "flag",
  no_livekit: "flag",
  json: "flag",
  check: "flag",
  from: "value",
  purge: "flag",
  lines: "value",
  help: "flag",
};

function parseArgs(argv) {
  const command = argv.length > 0 && !argv[0].startsWith("-") ? argv[0] : "help";
  const options = {};
  for (let i = argv.length > 0 && !argv[0].startsWith("-") ? 1 : 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("-")) fail("无法识别的参数：" + token + "（使用 help 查看用法）");
    let key = token.replace(/^--?/, "");
    let value;
    const eq = key.indexOf("=");
    if (eq >= 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    const normalized = key.replace(/-/g, "_");
    const spec = OPTION_SPEC[normalized];
    if (!spec) fail("未知选项：" + token + "（使用 help 查看用法）");
    if (spec === "flag") {
      options[normalized] = true;
      continue;
    }
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        value = next;
        i += 1;
      }
    }
    if (spec === "optional-value") {
      options[normalized] = value === undefined ? "" : value;
      continue;
    }
    if (value === undefined) fail("选项 --" + key + " 需要一个值");
    options[normalized] = value;
  }
  if (options.no_livekit) options.noLivekit = true;
  return { command, options };
}

// ============ 路径与目录 ============

function resolveHome(options) {
  const explicit = options ? options.dir : undefined;
  if (explicit !== undefined) {
    const trimmed = String(explicit).trim();
    if (!trimmed) fail("--dir 不能为空。示例：--dir " + path.join(os.homedir(), ".airmic"));
    const resolved = path.resolve(trimmed);
    if (resolved === path.parse(resolved).root) fail("安装目录不能是磁盘根目录：" + resolved);
    return resolved;
  }
  const raw = process.env.AIRMIC_HOME || path.join(os.homedir(), ".airmic");
  const home = path.resolve(String(raw));
  if (home === path.parse(home).root) fail("安装目录不能是磁盘根目录：" + home);
  return home;
}

function cliRepoRoot() {
  const candidates = [path.resolve(CLI_DIR, ".."), path.resolve(CLI_DIR, "..", "..")];
  for (const candidate of candidates) {
    if (isProjectDir(candidate)) return candidate;
  }
  return null;
}

function isProjectDir(dir) {
  return (
    exists(path.join(dir, "package.json")) &&
    exists(path.join(dir, "server", "src")) &&
    exists(path.join(dir, "web", "src")) &&
    exists(path.join(dir, "shared", "src"))
  );
}

function ensureHomeDirs(home) {
  for (const dir of HOME_DIRS) mkdirp(path.join(home, dir));
}

function readVersionInfo(home) {
  return readJson(path.join(home, "version.json"), null);
}

function readAppVersion(home) {
  const info = readVersionInfo(home);
  if (info && info.version) return String(info.version);
  const pkg = readJson(path.join(home, "app", "package.json"), null);
  return pkg && pkg.version ? String(pkg.version) : null;
}

function installedEnvPath(home) {
  return path.join(home, "config", "airmic.env");
}

function parseEnvFile(filePath) {
  const result = {};
  if (!exists(filePath)) return result;
  const content = fs.readFileSync(filePath, "utf8");
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
    result[key] = value;
  }
  return result;
}

function loadRuntimeEnv(home) {
  const fromFile = parseEnvFile(installedEnvPath(home));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(fromFile)) env[key] = value;
  env.NODE_ENV = env.NODE_ENV || "production";
  return env;
}

// ============ 版本比较 ============

function normalizeVersion(value) {
  if (!value) return null;
  const text = String(value).trim().replace(/^v/i, "");
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] || "" };
}

function compareVersions(a, b) {
  const va = normalizeVersion(a);
  const vb = normalizeVersion(b);
  if (!va || !vb) return 0;
  for (const key of ["major", "minor", "patch"]) {
    if (va[key] !== vb[key]) return va[key] > vb[key] ? 1 : -1;
  }
  if (va.pre === vb.pre) return 0;
  if (!va.pre) return 1;
  if (!vb.pre) return -1;
  return va.pre > vb.pre ? 1 : -1;
}

function nodeSatisfies(minVersion) {
  return compareVersions(process.versions.node, minVersion) >= 0;
}

// ============ 子进程与命令 ============

function commandExists(command, args) {
  try {
    const result = spawnSync(command, args || ["--version"], { stdio: "ignore", windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

function quoteForShell(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"';
}

function runCommand(command, args, options) {
  const opts = options || {};
  const isNpm = /^npm(\.cmd)?$/i.test(command);
  const useShell = IS_WIN && isNpm;
  const printable = command + " " + args.join(" ");
  log("  > " + printable + (opts.cwd ? "   (cwd: " + opts.cwd + ")" : ""));
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    env: opts.env || process.env,
    stdio: opts.stdio || "inherit",
    shell: useShell,
    windowsHide: true,
  });
  if (result.error && !opts.allowFail) {
    throw new Error("无法执行命令 " + command + "：" + result.error.message);
  }
  if ((result.status === null || result.status !== 0) && !opts.allowFail) {
    throw new Error("命令执行失败（退出码 " + result.status + "）：" + printable);
  }
  return result;
}

function npmCommand(args, cwd, allowFail) {
  const command = IS_WIN ? "npm.cmd" : "npm";
  return runCommand(command, args, { cwd, allowFail: Boolean(allowFail) });
}

function npmInstallAndBuild(appDir) {
  const hasLock = exists(path.join(appDir, "package-lock.json"));
  if (hasLock) {
    npmCommand(["ci", "--no-audit", "--no-fund"], appDir);
  } else {
    npmCommand(["install", "--no-audit", "--no-fund"], appDir);
  }
  npmCommand(["run", "build"], appDir);
}

// ============ 文件复制/解压/下载 ============

function shouldCopy(source, root) {
  const rel = path.relative(root, source);
  if (!rel) return true;
  const parts = rel.split(path.sep);
  if (EXCLUDE_TOP.has(parts[0])) return false;
  for (const excluded of EXCLUDE_REL) {
    if (rel === excluded || rel.startsWith(excluded + path.sep)) return false;
  }
  return true;
}

function copyProjectTree(sourceDir, destDir) {
  const root = path.resolve(sourceDir);
  mkdirp(destDir);
  fs.cpSync(root, destDir, {
    recursive: true,
    force: true,
    filter: (source) => shouldCopy(source, root),
  });
}

function listFilesRecursive(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function extractArchive(archivePath, destDir) {
  mkdirp(destDir);
  const tarAvailable = commandExists("tar", ["--version"]);
  if (tarAvailable) {
    const result = spawnSync("tar", ["-xf", archivePath, "-C", destDir], { stdio: "inherit", windowsHide: true });
    if (result.status === 0) return;
  }
  if (/\.zip$/i.test(archivePath) && IS_WIN) {
    const escapedArchive = archivePath.replace(/'/g, "''");
    const escapedDest = destDir.replace(/'/g, "''");
    runCommand("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Expand-Archive -LiteralPath '" + escapedArchive + "' -DestinationPath '" + escapedDest + "' -Force",
    ]);
    return;
  }
  throw new Error("解压失败：" + archivePath + "。请安装 tar（Windows 10+ 自带 tar，或使用 PowerShell Expand-Archive 解压 zip）");
}

function findProjectRoot(dir) {
  if (isProjectDir(dir)) return dir;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries.filter((entry) => entry.isDirectory());
  if (dirs.length === 1) {
    const child = path.join(dir, dirs[0].name);
    if (isProjectDir(child)) return child;
  }
  for (const entry of dirs) {
    const child = path.join(dir, entry.name);
    if (isProjectDir(child)) return child;
  }
  return null;
}

function githubHeaders(extra) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "AirMic-CLI/" + CLI_VERSION,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = (process.env.GITHUB_TOKEN || "").trim();
  if (token) headers.Authorization = "Bearer " + token;
  return Object.assign(headers, extra || {});
}

function requestBuffer(url, options) {
  const opts = options || {};
  const headers = Object.assign(
    { "User-Agent": "AirMic-CLI/" + CLI_VERSION },
    githubHeaders(opts.api ? {} : {}),
    opts.headers || {},
  );
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const client = lib.get(url, { headers, timeout: opts.timeout || 60000 }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        requestBuffer(next, opts).then(resolve, reject);
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    client.on("timeout", () => {
      client.destroy(new Error("请求超时：" + url));
    });
    client.on("error", reject);
  });
}

async function githubJson(apiPath) {
  const url = "https://api.github.com/repos/" + REPO + apiPath;
  const response = await requestBuffer(url, { api: true });
  if (response.status >= 400) {
    const detail = response.body ? response.body.toString("utf8").slice(0, 200) : "";
    throw new Error("GitHub API 请求失败（" + response.status + "）：" + (detail || url));
  }
  return JSON.parse(response.body.toString("utf8"));
}

async function downloadFile(url, destPath) {
  mkdirp(path.dirname(destPath));
  const file = fs.createWriteStream(destPath);
  const headers = githubHeaders();
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const client = lib.get(url, { headers, timeout: 120000 }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        file.close();
        const next = new URL(response.headers.location, url).toString();
        downloadFile(next, destPath).then(resolve, reject);
        return;
      }
      if (status >= 400) {
        response.resume();
        file.close();
        reject(new Error("下载失败（HTTP " + status + "）：" + url));
        return;
      }
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve(destPath)));
    });
    client.on("timeout", () => client.destroy(new Error("下载超时：" + url)));
    client.on("error", (error) => {
      file.close();
      reject(error);
    });
  });
}

function sourceArchiveUrl(ref, kind) {
  if (kind === "branch") {
    return "https://github.com/" + REPO + "/archive/refs/heads/" + encodeURIComponent(ref) + ".tar.gz";
  }
  return "https://github.com/" + REPO + "/archive/refs/tags/" + encodeURIComponent(ref) + ".tar.gz";
}

// ============ 配置生成 ============

function generateKeys() {
  return { apiKey: "airmic" + randomHex(8), apiSecret: randomHex(32) };
}

function livekitBinaryName() {
  return IS_WIN ? "livekit-server.exe" : "livekit-server";
}

function livekitBinaryPath(home) {
  return path.join(home, "livekit", "bin", livekitBinaryName());
}

function generateLivekitConfig(keys) {
  const lines = [
    "# AirMic 本地 LiveKit 配置（由 airmic-cli 自动生成）",
    "# 修改后需要重启 LiveKit：node bin/airmic-cli.mjs restart",
    "port: 7880",
    "rtc:",
    "  tcp_port: 7881",
    "  udp_port: 7882",
    "  use_external_ip: false",
    "logging:",
    "  level: info",
    "  json: false",
    "room:",
    "  empty_timeout: 300",
    "  max_participants: 100",
    "keys:",
    "  " + keys.apiKey + ": " + keys.apiSecret,
    "",
  ];
  return lines.join("\n");
}

function writeLivekitConfig(home, keys) {
  const filePath = path.join(home, "config", "livekit.yaml");
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, generateLivekitConfig(keys), "utf8");
  return filePath;
}

function envLine(key, value) {
  const text = String(value === undefined || value === null ? "" : value);
  if (/[\s#"]/.test(text)) return key + "=" + JSON.stringify(text);
  return key + "=" + text;
}

function generateAirMicEnv(options) {
  const mode = options.mode;
  const local = mode === "local";
  const lines = [
    "# AirMic 运行配置（由 airmic-cli 自动生成）",
    "# 安装目录：" + options.home,
    "# 修改后重启：node bin/airmic-cli.mjs restart",
    "",
    "NODE_ENV=production",
    "HOST=" + (local ? options.host : "0.0.0.0"),
    "PORT=" + options.port,
    "DATABASE_PATH=" + (local ? toPosix(path.join(options.home, "data", "airmic.db")) : "/data/airmic.db"),
    "WEB_DIST=" + (local ? toPosix(path.join(options.home, "app", "web", "dist")) : "/app/web/dist"),
    "JWT_SECRET=" + (options.jwtSecret || randomHex(32)),
    "SETUP_TOKEN=" + (options.setupToken || ""),
    "TRUST_PROXY=false",
    "LOG_LEVEL=info",
    "LOG_RETENTION_DAYS=3",
    "",
    "# LiveKit SFU（语音唯一链路）",
    "# local：本机回环；docker：浏览器访问宿主机时用 localhost。局域网/公网请改成 ws://<IP>:7880 或 wss://域名",
    "LIVEKIT_URL=" + (local ? "ws://127.0.0.1:7880" : "ws://localhost:7880"),
    "LIVEKIT_API_KEY=" + options.keys.apiKey,
    "LIVEKIT_API_SECRET=" + options.keys.apiSecret,
    "",
    "# 可选：GitHub Token，用于提高管理后台/CLI 检查更新的 API 限额",
    "# GITHUB_TOKEN=",
    "",
  ];
  return lines.join("\n");
}

function writeAirMicEnv(home, options) {
  const filePath = installedEnvPath(home);
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, generateAirMicEnv(Object.assign({}, options, { home })), "utf8");
  chmodPrivate(filePath);
  return filePath;
}

function sanitizeImageTag(version) {
  return String(version || "latest").replace(/[^0-9A-Za-z._-]/g, "-");
}

function generateDockerCompose(home, options) {
  const version = options.version;
  const image = "airmic:" + sanitizeImageTag(version);
  const livekitImage = "livekit/livekit-server:" + options.livekitVersion;
  const lines = [
    "# AirMic Docker Compose（由 airmic-cli 生成）",
    "# 安装目录：" + home,
    "# 用法：docker compose -f config/docker-compose.yml up -d",
    "name: airmic",
    "",
    "services:",
    "  airmic:",
    "    build:",
    "      context: ../app",
    "      dockerfile: Dockerfile",
    "    image: " + image,
    "    container_name: airmic",
    "    restart: unless-stopped",
    "    ports:",
    '      - "' + options.port + ':9811"',
    "    env_file:",
    "      - ../config/airmic.env",
    "    environment:",
    "      NODE_ENV: production",
    "      HOST: 0.0.0.0",
    '      PORT: "9811"',
    "      DATABASE_PATH: /data/airmic.db",
    "      WEB_DIST: /app/web/dist",
    "    volumes:",
    "      - ../data:/data",
    "    depends_on:",
    "      - livekit",
    "    healthcheck:",
    "      test:",
    "        - CMD",
    "        - node",
    "        - -e",
    '        - "fetch(\'http://127.0.0.1:9811/api/health\').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"',
    "      interval: 30s",
    "      timeout: 5s",
    "      retries: 3",
    "      start_period: 20s",
    "    logging:",
    "      driver: json-file",
    "      options:",
    '        max-size: "10m"',
    '        max-file: "3"',
    "",
    "  livekit:",
    "    image: " + livekitImage,
    "    container_name: airmic-livekit",
    "    restart: unless-stopped",
    '    command: ["--config", "/etc/livekit.yaml"]',
    "    volumes:",
    "      - ../config/livekit.yaml:/etc/livekit.yaml:ro",
    "    ports:",
    '      - "7880:7880"',
    '      - "7881:7881"',
    '      - "7882:7882/udp"',
    "    logging:",
    "      driver: json-file",
    "      options:",
    '        max-size: "10m"',
    '        max-file: "3"',
    "",
  ];
  return lines.join("\n");
}

function writeDockerCompose(home, options) {
  const filePath = path.join(home, "config", "docker-compose.yml");
  fs.writeFileSync(filePath, generateDockerCompose(home, options), "utf8");
  return filePath;
}

/** 校验 app/ 目录下能否解析 @airmic/shared（server 运行时依赖）。 */
function verifyAppRuntime(appDir) {
  const checkFile = path.join(appDir, "node_modules", ".airmic-runtime-check.mjs");
  try {
    mkdirp(path.dirname(checkFile));
    fs.writeFileSync(checkFile, "import '@airmic/shared';\nprocess.exit(0);\n", "utf8");
    const result = spawnSync(process.execPath, [checkFile], {
      cwd: appDir,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    });
    if (result.status === 0) return true;
    const detail = String(result.stderr || result.stdout || "").trim();
    warn("运行时依赖预检失败（@airmic/shared 无法解析）：" + (detail ? detail.slice(0, 400) : "未知错误"));
    return false;
  } catch (error) {
    warn("运行时依赖预检异常：" + (error && error.message ? error.message : error));
    return false;
  } finally {
    try {
      fs.rmSync(checkFile, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** 兜底：把 shared 包（package.json + dist）实际复制到 node_modules/@airmic/shared，
 *  不再依赖 Windows 上容易因目录移动而失效的 workspace 链接。server 运行时只需要 @airmic/shared。 */
function fallbackCopySharedPackage(appDir) {
  try {
    const sharedDir = path.join(appDir, "shared");
    const target = path.join(appDir, "node_modules", "@airmic", "shared");
    const distDir = path.join(sharedDir, "dist");
    if (!exists(path.join(sharedDir, "package.json")) || !exists(path.join(distDir, "index.js"))) {
      warn("无法复制 shared 包：缺少 shared/package.json 或 shared/dist。请检查构建产物。");
      return false;
    }
    fs.rmSync(target, { recursive: true, force: true });
    mkdirp(target);
    fs.copyFileSync(path.join(sharedDir, "package.json"), path.join(target, "package.json"));
    fs.cpSync(distDir, path.join(target, "dist"), { recursive: true, force: true });
    log("  已把 @airmic/shared 实际复制到 app/node_modules（兜底模式）。");
    return true;
  } catch (error) {
    warn("复制 @airmic/shared 兜底失败：" + (error && error.message ? error.message : error));
    return false;
  }
}

/** 修复 npm workspaces 链接。
 *  Windows 上 npm 会为 workspace 创建绝对路径 junction；把 .staging/app-next 重命名为 app 后，
 *  这些链接仍指向旧的暂存路径，导致新版本启动时报 @airmic/shared 找不到。
 *  这里按最终 app 路径重建链接，并做一次真实的 import 预检；仍失败则实际复制 shared 包兜底。 */
function fixWorkspaceLinks(appDir) {
  const scope = path.join(appDir, "node_modules", "@airmic");
  const names = ["shared", "server", "web"];
  try {
    fs.rmSync(scope, { recursive: true, force: true });
    mkdirp(scope);
    for (const name of names) {
      const target = path.join(appDir, name);
      if (!exists(target)) continue;
      const linkPath = path.join(scope, name);
      const linkTarget = IS_WIN ? target : path.relative(path.dirname(linkPath), target);
      fs.symlinkSync(linkTarget, linkPath, IS_WIN ? "junction" : "dir");
    }
  } catch (error) {
    warn("重建 node_modules/@airmic 工作区链接失败：" + (error && error.message ? error.message : error));
  }
  if (verifyAppRuntime(appDir)) return true;
  warn("工作区链接修复后仍无法解析 @airmic/shared，尝试实际复制 shared 包兜底 ...");
  if (fallbackCopySharedPackage(appDir) && verifyAppRuntime(appDir)) return true;
  warn("运行时依赖预检失败：新版本可能无法启动。");
  return false;
}

function copyManagementScripts(home, sourceDir) {
  const binDir = path.join(home, "bin");
  mkdirp(binDir);
  const files = ["airmic-cli.mjs", "airmic.sh", "airmic.ps1", "airmic.cmd"];
  for (const name of files) {
    const source = path.join(sourceDir, name);
    if (!exists(source)) continue;
    const target = path.join(binDir, name);
    fs.copyFileSync(source, target);
    if (name.endsWith(".sh") || name.endsWith(".mjs")) {
      try {
        fs.chmodSync(target, 0o755);
      } catch {
        /* ignore */
      }
    }
  }
}

// ============ LiveKit 下载 ============

function pickLivekitAsset(assets) {
  const osName = IS_WIN ? "windows" : IS_MAC ? "darwin" : "linux";
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : process.arch === "arm" ? "armv7" : null;
  if (!arch) return null;
  const ext = IS_WIN ? ".zip" : ".tar.gz";
  const needle = "_" + osName + "_" + arch + ext;
  const list = Array.isArray(assets) ? assets : [];
  return list.find((asset) => asset && typeof asset.name === "string" && asset.name.includes(needle)) || null;
}

async function resolveLivekitRelease(versionArg) {
  if (versionArg && versionArg !== "latest") {
    const tag = String(versionArg).startsWith("v") ? String(versionArg) : "v" + versionArg;
    return githubLivekitJson("/releases/tags/" + encodeURIComponent(tag));
  }
  return githubLivekitJson("/releases/latest");
}

async function githubLivekitJson(apiPath) {
  const url = "https://api.github.com/repos/livekit/livekit-server" + apiPath;
  const response = await requestBuffer(url, { api: true });
  if (response.status >= 400) throw new Error("获取 LiveKit Release 失败（HTTP " + response.status + "）");
  return JSON.parse(response.body.toString("utf8"));
}

async function installLivekitBinary(home, versionArg) {
  const release = await resolveLivekitRelease(versionArg);
  const tag = release.tag_name ? String(release.tag_name) : versionArg || DEFAULT_LIVEKIT_VERSION;
  const asset = pickLivekitAsset(release.assets);
  if (!asset) {
    warn("LiveKit 官方 Release（" + tag + "）没有当前平台（" + process.platform + "/" + process.arch + "）的预编译包。");
    warn("可手动安装 LiveKit 后把二进制放到：" + livekitBinaryPath(home));
    return null;
  }
  const staging = path.join(home, ".staging", "livekit");
  fs.rmSync(staging, { recursive: true, force: true });
  mkdirp(staging);
  const archivePath = path.join(staging, asset.name);
  log("  下载 LiveKit " + tag + "：" + asset.browser_download_url);
  try {
    await downloadFile(asset.browser_download_url, archivePath);
  } catch (error) {
    warn("LiveKit 下载失败：" + error.message);
    warn("可稍后手动把 livekit-server 二进制放入：" + path.join(home, "livekit", "bin"));
    return null;
  }
  const extractDir = path.join(staging, "extract");
  try {
    extractArchive(archivePath, extractDir);
  } catch (error) {
    warn("LiveKit 解压失败：" + error.message);
    return null;
  }
  const candidates = listFilesRecursive(extractDir).filter((file) => /^livekit-server(\.exe)?$/i.test(path.basename(file)));
  if (candidates.length === 0) {
    warn("LiveKit 压缩包中未找到 livekit-server 二进制，请手动放入：" + path.join(home, "livekit", "bin"));
    return null;
  }
  const binDir = path.join(home, "livekit", "bin");
  mkdirp(binDir);
  const target = livekitBinaryPath(home);
  fs.copyFileSync(candidates[0], target);
  try {
    fs.chmodSync(target, 0o755);
  } catch {
    /* ignore */
  }
  fs.rmSync(staging, { recursive: true, force: true });
  return tag;
}

// ============ 进程管理 ============

function dateStamp(value) {
  const d = value || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return String(d.getFullYear()) + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function logPath(home, name) {
  const dir = path.join(home, "logs");
  mkdirp(dir);
  return path.join(dir, name + "-" + dateStamp() + ".log");
}

/** 清理按天轮转的日志，只保留最近 keepDays 天（默认 3 天） */
function cleanupOldLogs(home, keepDays) {
  const days = Math.max(1, Number(keepDays) || 3);
  const dir = path.join(home, "logs");
  if (!exists(dir)) return [];
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStamp = dateStamp(cutoff);
  const removed = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(airmic|livekit)-(\d{4}-\d{2}-\d{2})\.log$/);
    if (!match) continue;
    if (match[2] < cutoffStamp) {
      try {
        fs.rmSync(path.join(dir, entry.name), { force: true });
        removed.push(entry.name);
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

function cleanupDaemonPid(home) {
  return readPid(home, "log-cleanup");
}

/** 启动后台日志清理守护进程（每 6 小时清理一次旧日志） */
function startLogCleanupDaemon(home) {
  cleanupOldLogs(home, 3);
  const existing = cleanupDaemonPid(home);
  if (existing && isProcessAlive(existing)) return existing;
  const cliPath = path.join(home, "bin", "airmic-cli.mjs");
  const command = exists(cliPath) ? cliPath : CLI_FILE;
  const child = spawn(process.execPath, [command, "__log-cleanup", "--dir", home], {
    cwd: home,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  writePid(home, "log-cleanup", child.pid);
  return child.pid;
}

function spawnBackground(home, name, command, args, env) {
  const logFile = logPath(home, name);
  const fd = fs.openSync(logFile, "a");
  try {
    fs.writeSync(fd, "\n===== " + new Date().toISOString() + " 启动 " + name + " =====\n");
  } catch {
    /* ignore */
  }
  const child = spawn(command, args, {
    cwd: path.join(home, "app"),
    env,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  try {
    fs.closeSync(fd);
  } catch {
    /* ignore */
  }
  writePid(home, name, child.pid);
  return child.pid;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function displayHost(host) {
  if (!host || host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

async function fetchHealth(host, port, timeoutMs) {
  const targetHost = displayHost(host);
  const override = Number(process.env.AIRMIC_HEALTH_TIMEOUT_MS || 0);
  const budget = override > 0 ? override : timeoutMs || 90000;
  const deadline = Date.now() + budget;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch("http://" + targetHost + ":" + port + "/api/health", { signal: controller.signal });
        if (response.ok) {
          const body = await response.json();
          if (body && body.status === "ok") return body;
        }
        lastError = new Error("健康检查返回 HTTP " + response.status);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error("等待服务健康检查超时（http://" + targetHost + ":" + port + "/api/health）：" + (lastError ? lastError.message : "未知错误"));
}

async function quickHealth(host, port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch("http://" + displayHost(host) + ":" + port + "/api/health", { signal: controller.signal });
      if (!response.ok) return { ok: false, status: response.status };
      const body = await response.json();
      return { ok: body && body.status === "ok", body };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function startAirMic(home) {
  const env = loadRuntimeEnv(home);
  const existing = readPid(home, "airmic");
  if (existing && isProcessAlive(existing)) return { started: false, pid: existing };
  const entry = path.join(home, "app", "server", "dist", "index.js");
  if (!exists(entry)) fail("缺少构建产物：" + entry + "（请先执行 install 或重新构建）");
  const pid = spawnBackground(home, "airmic", process.execPath, [entry], env);
  return { started: true, pid };
}

function startLivekit(home, noLivekit) {
  if (noLivekit) return { started: false, skipped: true };
  const binary = livekitBinaryPath(home);
  if (!exists(binary)) return { started: false, missing: true };
  const existing = readPid(home, "livekit");
  if (existing && isProcessAlive(existing)) return { started: false, pid: existing };
  const pid = spawnBackground(home, "livekit", binary, ["--config", path.join(home, "config", "livekit.yaml")], loadRuntimeEnv(home));
  return { started: true, pid };
}

function killProcess(pid, label) {
  if (!pid || !isProcessAlive(pid)) return false;
  log("  停止 " + label + "（PID " + pid + "）");
  if (IS_WIN) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* ignore */
      }
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (!isProcessAlive(pid)) return true;
      spawnSync("sleep", ["0.2"]);
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
  return true;
}

function stopLocal(home) {
  let stopped = false;
  const cleanupPid = cleanupDaemonPid(home);
  if (cleanupPid && isProcessAlive(cleanupPid)) {
    killProcess(cleanupPid, "日志清理守护进程");
    removePid(home, "log-cleanup");
  }
  for (const name of ["airmic", "livekit"]) {
    const pid = readPid(home, name);
    if (pid && isProcessAlive(pid)) {
      killProcess(pid, name === "airmic" ? "AirMic" : "LiveKit");
      stopped = true;
    } else {
      if (pid) log("  " + name + " 进程不存在，清理 PID 文件");
    }
    removePid(home, name);
  }
  if (!stopped) log("  没有正在运行的 AirMic/LiveKit 进程");
}

function dockerComposeFile(home) {
  return path.join(home, "config", "docker-compose.yml");
}

function runDockerCompose(home, args, allowFail) {
  const composeFile = dockerComposeFile(home);
  if (!exists(composeFile)) fail("缺少 Docker Compose 配置：" + composeFile);
  return runCommand("docker", ["compose", "-f", composeFile].concat(args), { cwd: home, allowFail: Boolean(allowFail) });
}

function hasDocker() {
  return commandExists("docker", ["--version"]);
}

function hasDockerComposeV2() {
  try {
    const result = spawnSync("docker", ["compose", "version"], { stdio: "ignore", windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

function dockerRunning(home, allowFail) {
  const result = runDockerCompose(home, ["ps", "-q"], true);
  if (result.status !== 0) return false;
  const output = result.stdout ? result.stdout.toString().trim() : "";
  return output.length > 0;
}

function tailFile(filePath, lines) {
  if (!exists(filePath)) return [];
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - 256 * 1024);
    const length = stat.size - start;
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    const all = buffer.toString("utf8").split(/\r?\n/);
    if (start > 0) all.shift();
    return all.slice(-lines);
  } catch {
    return [];
  }
}

function printAccessInfo(home, env, extra) {
  const port = env.PORT || DEFAULT_PORT;
  const host = displayHost(env.HOST || "127.0.0.1");
  const url = "http://" + host + ":" + port;
  log("");
  log("==============================================");
  log(" " + APP_NAME + " 安装完成");
  log("==============================================");
  log(" 安装目录 : " + home);
  log(" 访问地址 : " + url);
  log(" 健康检查 : " + url + "/api/health");
  log(" 初始化   : " + url + "/setup" + (env.SETUP_TOKEN ? "（需要 SETUP_TOKEN 环境变量中的初始化口令）" : ""));
  log(" 管理命令 : node " + path.join(home, "bin", "airmic-cli.mjs") + " status");
  log(" 升级检查 : node " + path.join(home, "bin", "airmic-cli.mjs") + " check-update");
  log(" 日志目录 : " + path.join(home, "logs"));
  log(" 数据文件 : " + (env.DATABASE_PATH || path.join(home, "data", "airmic.db")));
  if (extra) log(" " + extra);
  log("==============================================");
  log("");
}

// ============ 安装前置检查与源码准备 ============

function hasNpm() {
  try {
    const result = spawnSync(IS_WIN ? "npm.cmd" : "npm", ["--version"], {
      stdio: "ignore",
      shell: IS_WIN,
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function validateInstallPrereqs() {
  if (!nodeSatisfies(MIN_NODE_APP)) {
    fail("Node.js 版本过低：当前 " + process.versions.node + "，AirMic 需要 >= " + MIN_NODE_APP + "（推荐 24 LTS）。请升级 Node.js 后重试。");
  }
  if (!hasNpm()) fail("未找到 npm，请安装 Node.js（自带 npm）并确保加入 PATH。");
}

function readPackageVersion(dir) {
  const pkg = readJson(path.join(dir, "package.json"), null);
  return pkg && pkg.version ? String(pkg.version) : null;
}

function detectGitRef(root) {
  try {
    const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
    if (result.status === 0) {
      const ref = String(result.stdout || "").trim();
      if (ref && ref !== "HEAD") return ref;
    }
  } catch {
    /* ignore */
  }
  return "local";
}

function sanitizeRef(ref) {
  return String(ref || "source").replace(/[^0-9A-Za-z._-]/g, "-");
}

async function resolveLatestRemote() {
  let release = null;
  try {
    release = await githubJson("/releases/latest");
  } catch (error) {
    if (!/404/.test(error.message)) warn("检查 GitHub Release 失败：" + error.message);
  }
  if (release && release.tag_name) {
    return {
      kind: "release",
      ref: String(release.tag_name),
      url: release.html_url || REPO_URL + "/releases/tag/" + encodeURIComponent(release.tag_name),
      name: release.name || release.tag_name,
      publishedAt: release.published_at || null,
    };
  }
  let tags = null;
  try {
    tags = await githubJson("/tags?per_page=100");
  } catch (error) {
    warn("检查 GitHub Tags 失败：" + error.message);
  }
  if (Array.isArray(tags) && tags.length > 0) {
    const sorted = tags
      .map((tag) => ({ name: tag && tag.name ? String(tag.name) : "", version: normalizeVersion(tag && tag.name) }))
      .filter((entry) => entry.name && entry.version)
      .sort((a, b) => compareVersions(String(b.version.major) + "." + b.version.minor + "." + b.version.patch, String(a.version.major) + "." + a.version.minor + "." + a.version.patch));
    if (sorted.length > 0) {
      return {
        kind: "tag",
        ref: sorted[0].name,
        url: REPO_URL + "/releases/tag/" + encodeURIComponent(sorted[0].name),
        name: sorted[0].name,
        publishedAt: null,
      };
    }
  }
  let repo = null;
  try {
    repo = await githubJson("");
  } catch (error) {
    fail("无法访问 GitHub 仓库 " + REPO + "：" + error.message + "。请检查网络或稍后重试。");
  }
  const branch = repo && repo.default_branch ? String(repo.default_branch) : "main";
  return {
    kind: "branch",
    ref: branch,
    url: REPO_URL + "/commits/" + encodeURIComponent(branch),
    name: "开发分支（" + branch + "）",
    publishedAt: repo && repo.pushed_at ? repo.pushed_at : null,
  };
}

async function prepareSourceFromGithub(home, remote) {
  const archive = path.join(home, ".staging", "source-" + sanitizeRef(remote.ref) + ".tar.gz");
  const extractDir = path.join(home, ".staging", "source-extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  mkdirp(path.dirname(archive));
  log("  下载源码：" + sourceArchiveUrl(remote.ref, remote.kind));
  try {
    await downloadFile(sourceArchiveUrl(remote.ref, remote.kind), archive);
  } catch (error) {
    fail("下载 GitHub 源码失败：" + error.message + "。如果仓库为空或尚无可下载代码，请使用 --source local（当前仓库）或 upgrade --from 本地压缩包。");
  }
  try {
    extractArchive(archive, extractDir);
  } catch (error) {
    fail("解压 GitHub 源码失败：" + error.message);
  }
  const root = findProjectRoot(extractDir);
  if (!root) fail("GitHub 源码包中没有找到 AirMic 项目（缺少 package.json/server/src/web/src）。");
  return { root, ref: remote.ref, kind: remote.kind, version: readPackageVersion(root) };
}

async function prepareSourceForInstall(home, options) {
  const source = options.source || "local";
  if (source === "local") {
    const root = cliRepoRoot();
    if (!root) {
      fail("未找到本地 AirMic 源码。请从仓库的 deploy/airmic-cli.mjs 运行本地安装，或使用 --source github 从 GitHub 下载。");
    }
    return { root, ref: detectGitRef(root), kind: "local", version: readPackageVersion(root) };
  }
  if (source === "github") {
    const remote = await resolveLatestRemote();
    log("  GitHub 最新来源：" + describeRemote(remote));
    return prepareSourceFromGithub(home, remote);
  }
  fail("--source 只支持 local 或 github（当前：" + source + "）");
}

function describeRemote(remote) {
  if (!remote) return "未知";
  const version = normalizeVersion(remote.ref);
  if (version) return remote.ref + "（" + remote.kind + "）";
  return remote.ref + "（" + (remote.kind === "branch" ? "默认分支，无 Tag/Release" : remote.kind) + "）";
}

// ============ 安装目标准备 ============

function stopInstalled(home, mode) {
  const info = readVersionInfo(home);
  const actualMode = mode || (info && info.mode) || "local";
  if (actualMode === "docker") {
    if (hasDocker() && exists(dockerComposeFile(home))) {
      log("  停止已有 Docker 容器...");
      runDockerCompose(home, ["down"], true);
    }
  } else {
    stopLocal(home);
  }
}

function prepareInstallTarget(home, options) {
  mkdirp(home);
  const info = readVersionInfo(home);
  const installed = Boolean(info) || exists(path.join(home, "app"));
  if (installed && !options.force) {
    fail("安装目录已存在 AirMic 部署：" + home + "。如需重新安装请加 --force（data/ 与 backups/ 会保留）。");
  }
  if (installed && options.force) {
    log("  检测到已有安装，--force 将保留 data/ 与 backups/，重建 app/config/bin/livekit。");
    stopInstalled(home, info ? info.mode : "local");
  }
  fs.rmSync(path.join(home, "app"), { recursive: true, force: true });
  fs.rmSync(path.join(home, "config"), { recursive: true, force: true });
  fs.rmSync(path.join(home, "bin"), { recursive: true, force: true });
  fs.rmSync(path.join(home, "run"), { recursive: true, force: true });
  fs.rmSync(path.join(home, "version.json"), { force: true });
  if (options.force) fs.rmSync(path.join(home, "livekit", "bin"), { recursive: true, force: true });
  ensureHomeDirs(home);
}

function resolvePort(options) {
  const port = Number(options.port || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("端口不正确：" + options.port + "（应为 1-65535）");
  return port;
}

function resolveSetupToken(options) {
  if (options.setup_token === undefined) return null;
  const provided = String(options.setup_token).trim();
  return provided || randomHex(16);
}

// ============ 安装流程 ============

async function installLocal(home, options, sourceInfo) {
  const appDir = path.join(home, "app");
  const port = resolvePort(options);
  const host = options.host || "127.0.0.1";
  const keys = generateKeys();
  const setupToken = resolveSetupToken(options);
  const jwtSecret = randomHex(32);

  step(2, 7, "复制源码到安装目录 app/ ...");
  copyProjectTree(sourceInfo.root, appDir);
  const version = readPackageVersion(appDir) || sourceInfo.version || "0.0.0";

  step(3, 7, "安装 npm 依赖并构建（npm ci + npm run build）...");
  npmInstallAndBuild(appDir);

  step(4, 7, "生成运行配置与 LiveKit 配置 ...");
  if (!fixWorkspaceLinks(appDir)) {
    fail("安装预检失败：新构建的应用无法解析 @airmic/shared，请检查 shared/dist 与 node_modules 后重试。");
  }
  writeAirMicEnv(home, { mode: "local", port, host, keys, setupToken, jwtSecret });
  writeLivekitConfig(home, keys);

  step(5, 7, "准备管理脚本 ...");
  copyManagementScripts(home, path.join(appDir, "deploy"));

  let livekitVersion = null;
  if (!options.noLivekit) {
    step(6, 7, "下载并安装 LiveKit Server ...");
    livekitVersion = await installLivekitBinary(home, options.livekit_version);
    if (!livekitVersion) warn("LiveKit 未安装成功，语音暂不可用；可手动把二进制放入 " + path.join(home, "livekit", "bin") + " 后执行 restart。");
  } else {
    step(6, 7, "跳过 LiveKit 下载（--no-livekit），语音暂不可用。");
  }

  writeVersionInfo(home, {
    version,
    ref: sourceInfo.ref,
    mode: "local",
    livekitVersion,
  });

  step(7, 7, "启动 LiveKit 与 AirMic ...");
  cleanupOldLogs(home, 3);
  startLogCleanupDaemon(home);
  const lk = startLivekit(home, Boolean(options.noLivekit));
  if (lk.started) log("  LiveKit 已启动（PID " + lk.pid + "），日志：" + logPath(home, "livekit"));
  else if (lk.missing) warn("未找到 LiveKit 二进制，AirMic 将启动但语音不可用。");
  else if (lk.skipped) warn("已按 --no-livekit 跳过 LiveKit 启动，语音暂不可用。");

  startAirMic(home);
  const env = loadRuntimeEnv(home);
  const health = await fetchHealth(env.HOST, env.PORT || DEFAULT_PORT, 120000);
  log("  健康检查通过：版本 " + (health.version || version));
  printAccessInfo(home, env);
  return 0;
}

async function installDocker(home, options, sourceInfo) {
  const appDir = path.join(home, "app");
  const port = resolvePort(options);
  const keys = generateKeys();
  const setupToken = resolveSetupToken(options);
  const jwtSecret = randomHex(32);
  const livekitVersion = options.livekit_version && options.livekit_version !== "latest" ? options.livekit_version : DEFAULT_LIVEKIT_VERSION;

  step(2, 7, "复制源码到安装目录 app/ ...");
  copyProjectTree(sourceInfo.root, appDir);
  const version = readPackageVersion(appDir) || sourceInfo.version || "0.0.0";

  step(3, 7, "生成 Docker Compose / env / LiveKit 配置 ...");
  writeAirMicEnv(home, { mode: "docker", port, host: "0.0.0.0", keys, setupToken, jwtSecret });
  writeLivekitConfig(home, keys);
  writeDockerCompose(home, { port, version, livekitVersion });

  step(4, 7, "准备管理脚本 ...");
  copyManagementScripts(home, path.join(appDir, "deploy"));
  writeVersionInfo(home, { version, ref: sourceInfo.ref, mode: "docker", livekitVersion });
  cleanupOldLogs(home, 3);

  step(5, 7, "Docker 构建并启动 AirMic + LiveKit（可能需要几分钟）...");
  runDockerCompose(home, ["up", "-d", "--build"]);

  step(6, 7, "等待健康检查 ...");
  const env = loadRuntimeEnv(home);
  const health = await fetchHealth("127.0.0.1", port, 300000);
  log("  健康检查通过：版本 " + (health.version || version));

  step(7, 7, "完成。查看日志：node " + path.join(home, "bin", "airmic-cli.mjs") + " logs");
  printAccessInfo(home, Object.assign({}, env, { DATABASE_PATH: path.join(home, "data", "airmic.db") }));
  return 0;
}

async function runInstall(options) {
  const mode = options.mode || "local";
  if (mode !== "local" && mode !== "docker") fail("--mode 只支持 local 或 docker（当前：" + mode + "）");
  const home = resolveHome(options);
  if (mode === "docker") {
    validateInstallPrereqs();
    if (!hasDocker()) fail("未找到 docker 命令，请先安装 Docker Desktop / Docker Engine，或使用 --mode local 本地部署。");
    if (!hasDockerComposeV2()) fail("未找到 docker compose v2，请升级 Docker Compose。");
  } else {
    validateInstallPrereqs();
  }
  log("");
  log("AirMic 部署 CLI v" + CLI_VERSION + "  模式：" + (mode === "docker" ? "Docker" : "本地") + "  安装目录：" + home);
  log("");
  prepareInstallTarget(home, options);
  step(1, 7, "准备源码（" + (options.source || "local") + "）...");
  const sourceInfo = await prepareSourceForInstall(home, options);
  log("  源码版本：" + (sourceInfo.version || "未知") + "，ref：" + sourceInfo.ref);
  if (mode === "docker") return installDocker(home, options, sourceInfo);
  return installLocal(home, options, sourceInfo);
}

// ============ 启动 / 停止 / 状态 / 日志 ============

function writeVersionInfo(home, info) {
  writeJson(path.join(home, "version.json"), {
    version: info.version,
    ref: info.ref,
    mode: info.mode,
    repo: REPO,
    installedAt: info.installedAt || new Date().toISOString(),
    livekitVersion: info.livekitVersion || null,
  });
}

function installedMode(home) {
  const info = readVersionInfo(home);
  return info && info.mode === "docker" ? "docker" : "local";
}

function ensureInstalled(home) {
  if (!exists(path.join(home, "version.json")) && !exists(path.join(home, "app"))) {
    fail("未找到 AirMic 安装（" + home + "）。请先执行 install。");
  }
}

async function startLocalMode(home) {
  const env = loadRuntimeEnv(home);
  cleanupOldLogs(home, 3);
  startLogCleanupDaemon(home);
  const lk = startLivekit(home, false);
  if (lk.started) log("  LiveKit 已启动（PID " + lk.pid + "）");
  else if (lk.missing) warn("未找到 LiveKit 二进制（" + livekitBinaryPath(home) + "），语音不可用。");
  else if (lk.pid) log("  LiveKit 已在运行（PID " + lk.pid + "）");
  const app = startAirMic(home);
  if (app.started) log("  AirMic 已启动（PID " + app.pid + "），日志：" + logPath(home, "airmic"));
  else log("  AirMic 已在运行（PID " + app.pid + "）");
  const health = await fetchHealth(env.HOST, env.PORT || DEFAULT_PORT, 90000);
  log("  健康检查通过：版本 " + (health.version || readAppVersion(home) || "未知"));
  log("  访问地址：http://" + displayHost(env.HOST) + ":" + (env.PORT || DEFAULT_PORT));
  return 0;
}

async function startDockerMode(home) {
  if (!hasDocker()) fail("未找到 docker 命令，无法启动 Docker 部署。");
  runDockerCompose(home, ["up", "-d"]);
  const env = loadRuntimeEnv(home);
  const port = Number(env.PORT || (readVersionInfo(home) && readVersionInfo(home).port) || DEFAULT_PORT);
  const health = await fetchHealth("127.0.0.1", port, 180000);
  log("  健康检查通过：版本 " + (health.version || readAppVersion(home) || "未知"));
  log("  访问地址：http://127.0.0.1:" + port);
  return 0;
}

async function startCommand(options) {
  const home = resolveHome(options);
  ensureInstalled(home);
  const mode = options.mode || installedMode(home);
  log("AirMic 启动（" + (mode === "docker" ? "Docker" : "本地") + "模式，目录 " + home + "）");
  return mode === "docker" ? startDockerMode(home) : startLocalMode(home);
}

async function stopCommand(options) {
  const home = resolveHome(options);
  if (!exists(home)) fail("安装目录不存在：" + home);
  const mode = options.mode || installedMode(home);
  log("AirMic 停止（" + (mode === "docker" ? "Docker" : "本地") + "模式）");
  if (mode === "docker") {
    if (hasDocker()) runDockerCompose(home, ["down"], true);
    else warn("未找到 docker 命令，跳过容器停止。");
  } else {
    stopLocal(home);
  }
  log("已停止。");
  return 0;
}

async function restartCommand(options) {
  await stopCommand(options);
  log("");
  return startCommand(options);
}

async function statusCommand(options) {
  const home = resolveHome(options);
  ensureInstalled(home);
  const info = readVersionInfo(home) || {};
  const mode = options.mode || (info.mode === "docker" ? "docker" : "local");
  const env = loadRuntimeEnv(home);
  const port = Number(env.PORT || DEFAULT_PORT);
  log("");
  log("AirMic 部署状态");
  log("  安装目录 : " + home);
  log("  部署模式 : " + (mode === "docker" ? "Docker" : "本地"));
  log("  当前版本 : v" + (readAppVersion(home) || info.version || "未知"));
  log("  Git ref  : " + (info.ref || "未知"));
  log("  LiveKit  : " + (info.livekitVersion ? info.livekitVersion : mode === "docker" ? DEFAULT_LIVEKIT_VERSION + "（容器）" : "未安装/未记录"));
  log("  访问地址 : http://" + displayHost(env.HOST) + ":" + port);
  if (mode === "docker") {
    if (!hasDocker()) warn("未找到 docker 命令，无法读取容器状态。");
    else runDockerCompose(home, ["ps"], true);
  } else {
    const cleanupPid = cleanupDaemonPid(home);
    log("  日志清理 : " + (cleanupPid && isProcessAlive(cleanupPid) ? "运行中（PID " + cleanupPid + "）" : "未运行"));
    for (const name of ["airmic", "livekit"]) {
      const pid = readPid(home, name);
      const alive = pid && isProcessAlive(pid);
      log("  " + name + " 进程 : " + (alive ? "运行中（PID " + pid + "）" : pid ? "已退出（PID " + pid + "）" : "未运行"));
    }
  }
  const health = await quickHealth(env.HOST, port);
  if (health.ok) log("  健康检查 : 正常" + (health.body && health.body.version ? "（v" + health.body.version + "）" : ""));
  else log("  健康检查 : 异常" + (health.error ? "（" + health.error + "）" : health.status ? "（HTTP " + health.status + "）" : ""));
  log("  日志目录 : " + path.join(home, "logs"));
  log("");
  return 0;
}

async function logsCommand(options) {
  const home = resolveHome(options);
  ensureInstalled(home);
  const mode = options.mode || installedMode(home);
  const lines = Math.max(1, Math.min(5000, Number(options.lines || 100)));
  if (mode === "docker") {
    if (!hasDocker()) fail("未找到 docker 命令，无法读取容器日志。");
    runDockerCompose(home, ["logs", "--tail", String(lines)], true);
    return 0;
  }
  for (const name of ["airmic", "livekit"]) {
    const filePath = logPath(home, name);
    log("");
    log("--- " + name + " 日志（" + filePath + "，最近 " + lines + " 行）---");
    const linesOut = tailFile(filePath, lines);
    if (linesOut.length === 0) log("（暂无日志）");
    else for (const line of linesOut) log(line);
  }
  log("");
  log("提示：本地模式日志按天轮转（logs/airmic-YYYY-MM-DD.log、logs/livekit-YYYY-MM-DD.log），保留最近 3 天。");
  return 0;
}

// ============ 在线更新检查 ============

async function checkUpdateCommand(options) {
  const home = resolveHome(options);
  const info = readVersionInfo(home);
  let localVersion = info && info.version ? String(info.version) : readAppVersion(home);
  if (!localVersion) {
    const root = cliRepoRoot();
    if (root) localVersion = readPackageVersion(root);
  }
  if (!localVersion) localVersion = CLI_VERSION;
  const jsonMode = Boolean(options.json);
  const emitLog = jsonMode ? (line) => console.error(line) : (line) => console.log(line);
  let remote;
  try {
    remote = await resolveLatestRemote();
  } catch (error) {
    const payload = { ok: false, currentVersion: localVersion, error: error.message, checkedAt: new Date().toISOString() };
    if (jsonMode) console.log(JSON.stringify(payload, null, 2));
    else console.error("检查更新失败：" + error.message);
    return 1;
  }
  let latestVersion = null;
  let updateAvailable = false;
  let error = null;
  if (remote.kind === "release" || remote.kind === "tag") {
    const normalized = normalizeVersion(remote.ref);
    latestVersion = normalized ? String(remote.ref).replace(/^v/i, "") : null;
    updateAvailable = latestVersion ? compareVersions(latestVersion, localVersion) > 0 : false;
  } else {
    updateAvailable = true;
    error = "仓库尚未发布版本 Tag/Release，已回退默认分支 " + remote.ref + "；升级将使用该分支最新代码。建议在 GitHub 上打标签（如 v1.1.0）以获得版本化更新。";
  }
  const result = {
    ok: true,
    currentVersion: localVersion,
    latestVersion,
    latestRef: remote.ref,
    latestSource: remote.kind,
    updateAvailable,
    repo: REPO,
    repoUrl: REPO_URL,
    releaseUrl: remote.url || null,
    releaseName: remote.name || null,
    publishedAt: remote.publishedAt || null,
    checkedAt: new Date().toISOString(),
    error,
  };
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    log("");
    log("AirMic 在线更新检查");
    log("  当前版本 : v" + localVersion);
    log("  GitHub   : " + REPO);
    log("  最新来源 : " + describeRemote(remote));
    log("  最新版本 : " + (latestVersion ? "v" + latestVersion : "（无 Tag/Release）"));
    log("  更新状态 : " + (updateAvailable ? "有新版本可用" : "已是最新"));
    if (remote.url) log("  发布页面 : " + remote.url);
    if (error) log("  说明     : " + error);
    log("  升级命令 : node " + path.join(home, "bin", "airmic-cli.mjs") + " upgrade");
    if (!updateAvailable) log("  如需强制从 GitHub 重新安装：upgrade --force");
    log("");
  }
  return updateAvailable ? 10 : 0;
}

// ============ 升级（OTA） ============

function backupDatabase(home) {
  const db = path.join(home, "data", "airmic.db");
  if (!exists(db)) return null;
  const base = path.join(home, "backups", "airmic-db-" + nowStamp());
  mkdirp(path.dirname(base));
  fs.copyFileSync(db, base + ".db");
  for (const ext of ["-wal", "-shm"]) {
    if (exists(db + ext)) fs.copyFileSync(db + ext, base + ".db" + ext);
  }
  return base + ".db";
}

function restoreDatabase(home, backupDb) {
  if (!backupDb || !exists(backupDb)) return;
  const db = path.join(home, "data", "airmic.db");
  mkdirp(path.dirname(db));
  for (const ext of ["", "-wal", "-shm"]) {
    const source = backupDb + ext;
    const target = db + ext;
    if (exists(source)) fs.copyFileSync(source, target);
    else if (ext) fs.rmSync(target, { force: true });
  }
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value));
}

async function extractSourceArchive(home, archivePath, label) {
  const extractDir = path.join(home, ".staging", "extract-" + label + "-" + nowStamp());
  mkdirp(extractDir);
  extractArchive(archivePath, extractDir);
  const root = findProjectRoot(extractDir);
  if (!root) fail("压缩包中没有找到 AirMic 项目（缺少 package.json/server/src/web/src）：" + archivePath);
  return { root, ref: "local-archive", kind: "local" };
}

async function prepareUpgradeSource(home, options) {
  const staging = path.join(home, ".staging");
  fs.rmSync(staging, { recursive: true, force: true });
  mkdirp(staging);
  const from = options.from;
  let sourceInfo;
  if (from) {
    if (isUrl(from)) {
      const ext = /\.zip(?:[?#]|$)/i.test(from) ? ".zip" : ".tar.gz";
      const archive = path.join(staging, "download" + ext);
      log("  下载升级包：" + from);
      await downloadFile(from, archive);
      sourceInfo = await extractSourceArchive(home, archive, "url");
    } else {
      const resolved = path.resolve(process.cwd(), from);
      if (!exists(resolved)) fail("--from 指定的路径不存在：" + resolved);
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        sourceInfo = { root: resolved, ref: "local-dir", kind: "local" };
      } else {
        log("  解压升级包：" + resolved);
        sourceInfo = await extractSourceArchive(home, resolved, "archive");
      }
    }
  } else {
    const remote = options.remote || (await resolveLatestRemote());
    log("  下载 GitHub 源码：" + describeRemote(remote));
    sourceInfo = await prepareSourceFromGithub(home, remote);
  }
  const appNext = path.join(staging, "app-next");
  copyProjectTree(sourceInfo.root, appNext);
  const version = readPackageVersion(appNext);
  if (!version) fail("新版本源码缺少 package.json 版本号，升级中止。");
  return { appNext, version, ref: sourceInfo.ref, kind: sourceInfo.kind };
}

async function upgradeCommand(options) {
  const home = resolveHome(options);
  ensureInstalled(home);
  const info = readVersionInfo(home) || {};
  const mode = info.mode === "docker" ? "docker" : "local";
  if (options.check) return checkUpdateCommand(options);

  let remote = null;
  if (!options.from) {
    try {
      remote = await resolveLatestRemote();
    } catch (error) {
      fail("检查更新失败：" + error.message + "（可加 --force 跳过检查，或使用 --from 指定本地压缩包/目录/URL）");
    }
    if (!options.force) {
      let updateAvailable = true;
      if (remote.kind === "release" || remote.kind === "tag") {
        const latest = String(remote.ref).replace(/^v/i, "");
        updateAvailable = compareVersions(latest, info.version || "0.0.0") > 0;
      }
      if (!updateAvailable) {
        log("已是最新版本（当前 v" + (info.version || "未知") + "，GitHub：" + describeRemote(remote) + "），无需升级。");
        log("如需强制从 GitHub 重新安装：upgrade --force");
        return 0;
      }
      log("发现新版本：" + describeRemote(remote));
    } else {
      log("--force：忽略版本检查，直接从 GitHub " + describeRemote(remote) + " 升级。");
    }
  }

  log("");
  log("AirMic OTA 升级（当前 v" + (info.version || "未知") + "，模式：" + (mode === "docker" ? "Docker" : "本地") + "）");
  log("");
  step(1, 7, "准备新版本源码 ...");
  const prepared = await prepareUpgradeSource(home, { from: options.from, remote });
  log("  新版本：v" + prepared.version + "（ref：" + prepared.ref + "）");

  step(2, 7, mode === "local" ? "构建新版本（npm ci + npm run build）..." : "检查新版本源码（Docker 模式由镜像构建）...");
  if (mode === "local") npmInstallAndBuild(prepared.appNext);

  step(3, 7, "停止当前服务 ...");
  stopInstalled(home, mode);

  step(4, 7, "备份数据库与旧版本 ...");
  const dbBackup = backupDatabase(home);
  log("  " + (dbBackup ? "数据库备份：" + dbBackup : "未找到数据库文件，跳过备份"));
  const oldVersion = info.version || "unknown";
  const backupApp = path.join(home, "backups", "app-" + oldVersion + "-" + nowStamp());
  const oldApp = path.join(home, "app");
  let appMoved = false;
  if (exists(oldApp)) {
    mkdirp(path.dirname(backupApp));
    fs.renameSync(oldApp, backupApp);
    appMoved = true;
  }
  fs.renameSync(prepared.appNext, oldApp);
  copyManagementScripts(home, path.join(oldApp, "deploy"));
  const oldCompose = mode === "docker" && exists(dockerComposeFile(home)) ? fs.readFileSync(dockerComposeFile(home), "utf8") : null;
  const env = loadRuntimeEnv(home);
  const port = Number(env.PORT || DEFAULT_PORT);
  writeVersionInfo(home, {
    version: prepared.version,
    ref: prepared.ref,
    mode,
    livekitVersion: info.livekitVersion || null,
    installedAt: new Date().toISOString(),
  });

  step(5, 7, "启动新版本 ...");
  try {
    if (mode === "local") {
      log("  检查新版本运行时依赖（@airmic/shared）...");
      if (!fixWorkspaceLinks(oldApp)) {
        throw new Error("新版本运行时依赖预检失败：无法解析 @airmic/shared（app/node_modules 工作区链接异常）");
      }
    }
    if (mode === "docker") {
      const livekitVersion = info.livekitVersion && /^v/.test(String(info.livekitVersion)) ? info.livekitVersion : DEFAULT_LIVEKIT_VERSION;
      writeDockerCompose(home, { port, version: prepared.version, livekitVersion });
      runDockerCompose(home, ["up", "-d", "--build"]);
      const health = await fetchHealth("127.0.0.1", port, 300000);
      log("  健康检查通过：v" + (health.version || prepared.version));
    } else {
      startLogCleanupDaemon(home);
      const lk = startLivekit(home, false);
      if (lk.missing) warn("未找到 LiveKit 二进制，语音暂不可用。");
      startAirMic(home);
      const health = await fetchHealth(env.HOST, port, 120000);
      log("  健康检查通过：v" + (health.version || prepared.version));
    }
  } catch (error) {
    warn("升级失败：" + error.message);
    warn("开始自动回滚到 v" + oldVersion + " ...");
    try {
      if (mode === "docker") {
        if (hasDocker()) runDockerCompose(home, ["down"], true);
      } else {
        stopLocal(home);
      }
    } catch {
      /* ignore */
    }
    restoreDatabase(home, dbBackup);
    fs.rmSync(oldApp, { recursive: true, force: true });
    if (appMoved && exists(backupApp)) fs.renameSync(backupApp, oldApp);
    if (oldCompose) fs.writeFileSync(dockerComposeFile(home), oldCompose, "utf8");
    fs.rmSync(path.join(home, ".staging"), { recursive: true, force: true });
    if (info && info.version) writeVersionInfo(home, info);
    else fs.rmSync(path.join(home, "version.json"), { force: true });
    try {
      if (mode === "docker") {
        if (hasDocker()) runDockerCompose(home, ["up", "-d"], true);
        await fetchHealth("127.0.0.1", port, 180000);
      } else {
        startLogCleanupDaemon(home);
        startLivekit(home, false);
        startAirMic(home);
        await fetchHealth(env.HOST, port, 120000);
      }
      warn("回滚成功，已恢复旧版本 v" + oldVersion + " 与升级前数据库。");
    } catch (rollbackError) {
      warn("回滚后服务启动失败：" + rollbackError.message);
      warn("请手动检查日志：node " + path.join(home, "bin", "airmic-cli.mjs") + " logs");
      warn("数据库备份位于：" + (dbBackup || "无") + "；旧版本 app 位于：" + backupApp);
    }
    return 1;
  }

  step(6, 7, "清理临时文件 ...");
  fs.rmSync(path.join(home, ".staging"), { recursive: true, force: true });
  step(7, 7, "升级完成：v" + oldVersion + " -> v" + prepared.version);
  log("  旧版本 app 备份：" + backupApp);
  log("  数据库备份    ：" + (dbBackup || "无"));
  log("  查看状态      ：node " + path.join(home, "bin", "airmic-cli.mjs") + " status");
  log("");
  return 0;
}

// ============ 卸载 ============

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + " (y/N) ", (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

async function uninstallCommand(options) {
  const home = resolveHome(options);
  const info = readVersionInfo(home);
  if (!exists(home) || (!info && !exists(path.join(home, "app")))) {
    fail("未找到 AirMic 安装目录（" + home + "）。");
  }
  const mode = info && info.mode === "docker" ? "docker" : "local";
  if (!options.yes) {
    if (!process.stdin.isTTY) fail("当前为非交互环境，请加 --yes 确认卸载。");
    const ok = await confirm("确认卸载 " + home + " 下的 AirMic（data/ 与 backups/ 默认保留）？");
    if (!ok) {
      log("已取消。");
      return 0;
    }
  }
  log("正在停止服务 ...");
  stopInstalled(home, mode);
  if (mode === "docker" && hasDocker()) {
    try {
      runDockerCompose(home, ["down"], true);
    } catch {
      /* ignore */
    }
  }
  if (options.purge) {
    fs.rmSync(home, { recursive: true, force: true });
    log("已删除整个安装目录：" + home);
    return 0;
  }
  for (const dir of ["app", "bin", "config", "livekit", "logs", "run", ".staging"]) {
    fs.rmSync(path.join(home, dir), { recursive: true, force: true });
  }
  fs.rmSync(path.join(home, "version.json"), { force: true });
  log("");
  log("已卸载 AirMic 程序文件，以下数据已保留：");
  log("  data/    : " + path.join(home, "data"));
  log("  backups/ : " + path.join(home, "backups"));
  log("如需全部删除：node " + CLI_FILE + " uninstall --dir \"" + home + "\" --purge --yes");
  log("或直接删除目录：" + home);
  return 0;
}

// ============ 帮助与入口 ============

function printHelp() {
  const lines = [
    "",
    APP_NAME + " 部署 CLI v" + CLI_VERSION,
    "",
    "用法：node airmic-cli.mjs <命令> [选项]",
    "（安装后也可直接使用安装目录 bin/airmic、bin/airmic.ps1、bin/airmic.cmd）",
    "",
    "命令：",
    "  install              安装部署（默认本地模式；需要 Node >= " + MIN_NODE_APP + "）",
    "  start                启动已安装的服务",
    "  stop                 停止服务",
    "  restart              重启服务",
    "  status               查看进程、健康检查、版本与访问地址",
    "  logs                 查看日志（本地每日文件 / Docker compose logs）",
    "  check-update         检查 GitHub 最新版本（退出码：0 最新、10 有更新、1 失败）",
    "  upgrade              在线 OTA 升级（自动备份数据库、构建、原子切换、失败回滚）",
    "  uninstall            卸载（默认保留 data/ 与 backups/）",
    "  docker-up            以 Docker 模式启动",
    "  docker-down          以 Docker 模式停止",
    "  docker-logs          查看 Docker 日志",
    "  docker-status        查看 Docker 状态",
    "  version              显示 CLI 与已安装版本",
    "  help                 显示本帮助",
    "",
    "install 选项：",
    "  --mode local|docker      部署模式（默认 local）",
    "  --dir <路径>             安装目录（默认 Windows: %USERPROFILE%\\.airmic，Linux/macOS: ~/.airmic；或环境变量 AIRMIC_HOME）",
    "  --source local|github    源码来源（默认 local=当前仓库；github=GitHub 最新 Release/Tag/默认分支）",
    "  --port <端口>            AirMic 端口（默认 " + DEFAULT_PORT + "）",
    "  --host <地址>            本地模式监听地址（默认 127.0.0.1，可选 0.0.0.0）",
    "  --no-livekit             跳过 LiveKit 下载与启动（语音不可用，适合快速验证）",
    "  --livekit-version <vX>   指定 LiveKit 版本（默认最新 Release）",
    "  --setup-token [值]       设置初始化口令；不带值时自动生成随机口令",
    "  --yes                    自动确认（非交互环境）",
    "  --force                  目标已存在时强制重装（保留 data/ 与 backups/）",
    "",
    "upgrade 选项：",
    "  --check                  只检查是否有新版本（同 check-update）",
    "  --force                  跳过版本检查，强制升级（默认从 GitHub 最新 Release/Tag/分支）",
    "  --from <目录|zip|tar.gz|URL>  从指定来源升级（离线/回滚测试）",
    "",
    "uninstall 选项：",
    "  --yes                    跳过确认（非交互环境必须）",
    "  --purge                  连同 data/、backups/ 删除整个安装目录",
    "",
    "check-update 选项：",
    "  --json                   以 JSON 输出检查结果（便于脚本集成）",
    "",
    "其他：",
    "  --dir <路径>             对所有命令生效，用于指定安装目录",
    "  logs --lines <N>         显示最近 N 行日志（默认 100）",
    "  GITHUB_TOKEN             可选环境变量，提高 GitHub API 限额",
    "",
    "示例：",
    "  node deploy/airmic-cli.mjs install --mode local --yes",
    "  node deploy/airmic-cli.mjs install --mode docker --port 9811 --yes",
    "  node deploy/airmic-cli.mjs check-update --json",
    "  node deploy/airmic-cli.mjs upgrade --from ./airmic-src.tar.gz --force",
    "  node deploy/airmic-cli.mjs uninstall --purge --yes",
    "",
  ];
  for (const line of lines) console.log(line);
}

function versionCommand(options) {
  const home = resolveHome(options);
  log(APP_NAME + " CLI v" + CLI_VERSION);
  log("仓库：" + REPO_URL);
  if (exists(path.join(home, "version.json")) || exists(path.join(home, "app"))) {
    const info = readVersionInfo(home) || {};
    log("安装目录：" + home);
    log("已安装版本：v" + (readAppVersion(home) || info.version || "未知"));
    log("部署模式：" + (info.mode || "local"));
    if (info.livekitVersion) log("LiveKit：" + info.livekitVersion);
  } else {
    log("当前目录未检测到已安装部署（可用 install 安装）。");
  }
  return 0;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.command;
  const options = parsed.options;

  if (options.help) {
    printHelp();
    return 0;
  }

  if (command === "__log-cleanup") {
    const home = resolveHome(options);
    cleanupOldLogs(home, 3);
    setInterval(() => {
      try {
        cleanupOldLogs(home, 3);
      } catch {
        /* ignore */
      }
    }, 6 * 60 * 60 * 1000);
    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));
    return new Promise(() => {});
  }

  switch (command) {
    case "install":
      return runInstall(options);
    case "start":
      return startCommand(options);
    case "stop":
      return stopCommand(options);
    case "restart":
      return restartCommand(options);
    case "status":
      return statusCommand(options);
    case "logs":
      return logsCommand(options);
    case "check-update":
      return checkUpdateCommand(options);
    case "upgrade":
      return upgradeCommand(options);
    case "uninstall":
      return uninstallCommand(options);
    case "docker-up":
      options.mode = "docker";
      return startCommand(options);
    case "docker-down":
      options.mode = "docker";
      return stopCommand(options);
    case "docker-logs":
      options.mode = "docker";
      return logsCommand(options);
    case "docker-status":
      options.mode = "docker";
      return statusCommand(options);
    case "version":
      return versionCommand(options);
    case "help":
    default:
      if (command !== "help") {
        printHelp();
        fail("未知命令：" + command + "（使用 help 查看用法）");
      }
      printHelp();
      return 0;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(CLI_FILE);
if (isDirectRun) {
  main()
    .then((code) => {
      if (typeof code === "number") process.exitCode = code;
    })
    .catch((error) => {
      console.error("");
      console.error("[错误] " + (error && error.message ? error.message : String(error)));
      process.exitCode = 1;
    });
}

export {
  generateDockerCompose,
  generateAirMicEnv,
  generateLivekitConfig,
  generateKeys,
  pickLivekitAsset,
  shouldCopy,
  findProjectRoot,
  compareVersions,
  normalizeVersion,
  parseEnvFile,
  resolveLatestRemote,
  checkUpdateCommand,
};

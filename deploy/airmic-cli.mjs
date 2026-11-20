#!/usr/bin/env node
/**
 * AirMic 部署 CLI（本地 / Docker 一键部署、状态、日志、在线更新检查、OTA 升级、卸载）
 *
 * 运行环境：Node.js >= 18（建议 >= 22.13，与应用一致）
 * 依赖：仅 Node 内置模块 + 系统命令（npm、tar、docker）；无需新增 npm 依赖
 *
 * 典型用法：
 *   node deploy/airmic-cli.mjs install --mode local --yes      # 默认从 GitHub Release 下载预构建包，不编译
 *   node deploy/airmic-cli.mjs install --source local --build   # 开发者：源码构建
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
import { pipeline } from "node:stream/promises";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_VERSION = "1.2.2";
const APP_NAME = "AirMic";
const DEFAULT_REPO = "poouo/Airmic";
const HOME_MARKER = ".airmic-install.json";
let REPO = DEFAULT_REPO;
let GHCR_IMAGE = "ghcr.io/" + REPO.toLowerCase();
let REPO_URL = "https://github.com/" + REPO;
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
  ".dsh-acl-recovery", ".dsh-tests", "dist-release",
]);
const EXCLUDE_REL = new Set([
  path.join("web", "dist"),
  path.join("server", "dist"),
  path.join("shared", "dist"),
  path.join("e2e", "artifacts"),
  path.join("e2e", "screenshots"),
]);

const HOME_DIRS = ["app", "data", "config", "livekit", path.join("livekit", "bin"), "logs", "backups", "run", "bin"];

/* ============ 终端输出 ============ */

const ANSI = { reset: "\u001b[0m", bold: "\u001b[1m", dim: "\u001b[2m", cyan: "\u001b[36m", green: "\u001b[32m", yellow: "\u001b[33m", red: "\u001b[31m" };
const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !process.argv.includes("--no-color");

function paint(name, text) {
  return COLOR_ENABLED ? ANSI[name] + text + ANSI.reset : text;
}

const bold = (text) => paint("bold", text);
const dim = (text) => paint("dim", text);
const cyan = (text) => paint("cyan", text);
const green = (text) => paint("green", text);

/** 全角字符按 2 列计算，保证中英文标签对齐 */
function textWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    width += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  }
  return width;
}

/** 生成对齐的「标签 : 值」行，中文标签不会错位 */
function field(label, value) {
  const width = 12;
  return " " + label + " ".repeat(Math.max(0, width - textWidth(label))) + " : " + value;
}

/** 统一的分区标题：安装 / 升级 / 卸载 / 状态 / 完成摘要共用同一套观感 */
function printHeader(title, rows) {
  const line = "=".repeat(46);
  log("");
  log(cyan(line));
  log(" " + bold(title));
  if (rows && rows.length > 0) {
    log(cyan("-".repeat(46)));
    for (const row of rows) log(row);
  }
  log(cyan(line));
  log("");
}

function log(message) {
  console.log(message);
}

function warn(message) {
  console.error(paint("yellow", "[警告]") + " " + message);
}

function step(index, total, message) {
  console.log(cyan("[" + index + "/" + total + "]") + " " + message);
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
  repo: "value",
  ref: "value",
  action: "value",
  prepare_runtime: "flag",
  port: "value",
  host: "value",
  livekit_version: "value",
  setup_token: "optional-value",
  yes: "flag",
  force: "flag",
  no_livekit: "flag",
  build: "flag",
  json: "flag",
  check: "flag",
  from: "value",
  purge: "flag",
  lines: "value",
  no_color: "flag",
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
  const installedHome = path.basename(CLI_DIR) === "bin" ? path.dirname(CLI_DIR) : null;
  let raw = String(options?.dir ?? process.env.AIRMIC_HOME ?? installedHome ?? path.join(os.homedir(), ".airmic"));
  if (!raw.trim()) fail("--dir 不能为空。");
  if (raw === "~" || /^~[/\\]/.test(raw)) raw = path.join(os.homedir(), raw.slice(2));
  if (IS_WIN && (raw !== raw.trim() || /^[\\/]|^[a-z]:(?![/\\])/i.test(raw) || raw.replace(/^[a-z]:/i, "").includes(":") ||
      raw.replace(/^[a-z]:/i, "").split(/[/\\]/).some((part) => /[. ]$/.test(part) && ![".", ".."].includes(part)))) {
    fail("安装目录必须是本地磁盘上的普通路径：" + raw);
  }
  let home = path.resolve(raw);
  const ancestors = [];
  for (let current = home; current !== path.parse(current).root; current = path.dirname(current)) ancestors.unshift(current);
  let existingAncestor = path.parse(home).root;
  for (const current of ancestors) {
    if (!assertPlainPath(current, "directory")) break;
    existingAncestor = current;
  }
  home = path.resolve(fs.realpathSync.native(existingAncestor), path.relative(existingAncestor, home));
  const systemDrive = process.env.SystemDrive || "C:";
  const protectedPaths = [
    path.parse(home).root, os.homedir(), os.tmpdir(), process.env.HOME, process.env.USERPROFILE,
    process.env.PUBLIC, process.env.SystemRoot, process.env.ProgramFiles, process.env["ProgramFiles(x86)"],
    process.env.ProgramData, process.env.OneDrive, process.env.APPDATA, process.env.LOCALAPPDATA,
    ...["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "OneDrive"].map((name) => path.join(os.homedir(), name)),
    ...(IS_WIN ? [systemDrive + "\\Users", systemDrive + "\\Windows"] :
      ["/home", "/Users", "/root", "/etc", "/usr", "/var", "/opt", "/srv", "/bin", "/sbin", "/dev", "/proc", "/sys"]),
  ];
  for (const anchor of protectedPaths.filter(Boolean)) {
    if (pathIsWithin(home, path.resolve(anchor))) {
      fail("安装目录指向受保护的路径：" + home);
    }
  }
  if (installedHome && path.relative(home, installedHome) !== "") {
    fail("已安装的管理命令只操作自身安装目录：" + installedHome);
  }
  return home;
}

function pathIsWithin(parent, target) {
  const relative = path.relative(parent, target);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
}

function assertPlainPath(target, type) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return false;
  if (stat.isSymbolicLink() || (type === "directory" ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1)) {
    fail("拒绝访问链接或非预期类型的路径：" + target);
  }
  return true;
}

const MANAGED_DIRS = ["app", "config", "bin", "run", "livekit", "logs", ".staging", ".runtime"];
const RETAINED_DIRS = ["data", "backups"];

function validateHome(home, action) {
  if (!assertPlainPath(home, "directory")) {
    if (action !== "install") fail("未找到 AirMic 安装目录：" + home);
    return { owned: false, installed: false };
  }
  for (const dir of [...MANAGED_DIRS, ...RETAINED_DIRS]) assertPlainPath(path.join(home, dir), "directory");
  assertPlainPath(path.join(home, "livekit", "bin"), "directory");
  for (const file of [
    HOME_MARKER, "version.json", "bin/airmic-cli.mjs", "bin/airmic.sh", "bin/airmic.ps1", "bin/airmic.cmd",
    "config/airmic.env", "config/docker-compose.yml", "config/livekit.yaml",
    "run/airmic.pid", "run/livekit.pid", "run/log-cleanup.pid",
    "data/airmic.db", "data/airmic.db-wal", "data/airmic.db-shm",
    path.relative(home, livekitBinaryPath(home)),
  ]) assertPlainPath(path.join(home, file), "file");
  const marker = readJson(path.join(home, HOME_MARKER), null);
  const owned = isHomeMarker(marker, home);
  const info = readVersionInfo(home);
  const cli = path.join(home, "bin", "airmic-cli.mjs");
  const legacy = Boolean(info && typeof info.repo === "string" && validRepo(info.repo) &&
    normalizeVersion(info.version) && ["local", "docker"].includes(info.mode) &&
    exists(cli) && fs.readFileSync(cli, "utf8").slice(0, 2048).includes("AirMic 部署 CLI"));
  if (owned || legacy) return { owned, installed: legacy || (owned && Boolean(info?.version)) };
  if (action === "install" && fs.readdirSync(home).length === 0) return { owned: false, installed: false };
  fail("目录没有 AirMic 安装标记，且无法核验为已有部署：" + home + "。首次安装请使用新建或空目录。");
}

function markHome(home) {
  mkdirp(home);
  const marker = path.join(home, HOME_MARKER);
  if (!isHomeMarker(readJson(marker, null), home)) {
    const flag = assertPlainPath(marker, "file") ? "w" : "wx";
    fs.writeFileSync(marker, JSON.stringify({ product: "AirMic", schema: 1, home }) + "\n", { flag });
  }
}

function isHomeMarker(marker, home) {
  return marker?.product === "AirMic" && marker.schema === 1 &&
    typeof marker.home === "string" && path.relative(home, marker.home) === "";
}

async function withDeploymentLock(home, action, work) {
  const state = validateHome(home, action);
  if (action === "install" || action === "upgrade") markHome(home);
  const lock = path.join(home, ".airmic-deploy.lock");
  let handle;
  try {
    handle = fs.openSync(lock, "wx");
  } catch (error) {
    if (error.code === "EEXIST") fail("安装目录已有部署操作锁：" + lock + "。若上次操作意外结束，请确认锁内记录的进程已退出后再移除此文件。");
    throw error;
  }
  try {
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
    return await work(state);
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lock);
  }
}

async function withStaging(home, work) {
  const base = path.join(home, ".staging");
  assertPlainPath(base, "directory");
  mkdirp(base);
  const staging = fs.mkdtempSync(path.join(base, "operation-"));
  try {
    return await work(staging);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function validRepo(repo) {
  return /^[\w-]+\/[\w.-]+$/.test(repo) && !/\/\.{1,2}$/.test(repo);
}

function configureRepository(options, installedRepo) {
  const repo = options.repo ?? (process.env.AIRMIC_REPO || installedRepo || DEFAULT_REPO);
  if (!validRepo(repo)) fail("--repo 需要有效的 GitHub owner/name。");
  REPO = repo;
  GHCR_IMAGE = "ghcr.io/" + REPO.toLowerCase();
  REPO_URL = "https://github.com/" + REPO;
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
  if (/^\.env(?:\.|$)/.test(parts[0]) && parts[0] !== ".env.example") return false;
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
  assertSafeArchive(archivePath);
  mkdirp(destDir);
  const result = spawnSync("tar", ["-xf", archivePath, "-C", destDir], { stdio: "inherit", windowsHide: true });
  if (result.status === 0) return;
  throw new Error("解压失败：" + archivePath + "。请检查压缩包和系统 tar。");
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

function requestResponse(url, options = {}, redirects = 0) {
  const target = new URL(url);
  if (!["https:", "http:"].includes(target.protocol)) throw new Error("不支持的下载协议：" + target.protocol);
  const api = target.origin === "https://api.github.com";
  const headers = {
    ...(api ? githubHeaders() : { "User-Agent": "AirMic-CLI/" + CLI_VERSION }),
    ...options.headers,
  };
  return new Promise((resolve, reject) => {
    const lib = target.protocol === "https:" ? https : http;
    const client = lib.get(target, { headers, timeout: options.timeout || 60000 }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        try {
          const next = new URL(response.headers.location, target);
          if (redirects >= 5 || (target.protocol === "https:" && next.protocol !== "https:")) {
            throw new Error("下载重定向无效：" + url);
          }
          const nextOptions = next.origin === target.origin ? options : { timeout: options.timeout };
          requestResponse(next, nextOptions, redirects + 1).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
        return;
      }
      resolve(response);
    });
    client.on("timeout", () => {
      client.destroy(new Error("请求超时：" + url));
    });
    client.on("error", reject);
  });
}

async function requestBuffer(url, options) {
  const response = await requestResponse(url, options);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) };
}

async function githubJson(apiPath) {
  const url = "https://api.github.com/repos/" + REPO + apiPath;
  const response = await requestBuffer(url, { api: true });
  if (response.status >= 400) {
    const detail = response.body ? response.body.toString("utf8").slice(0, 200) : "";
    const error = new Error("GitHub API 请求失败（" + response.status + "）：" + (detail || url));
    error.status = response.status;
    throw error;
  }
  return JSON.parse(response.body.toString("utf8"));
}

async function downloadFile(url, destPath, options) {
  const response = await requestResponse(url, { timeout: 120000, ...options });
  const status = response.statusCode || 0;
  if (status < 200 || status >= 300) {
    response.resume();
    throw new Error("下载失败（HTTP " + status + "）：" + url);
  }
  mkdirp(path.dirname(destPath));
  await pipeline(response, fs.createWriteStream(destPath, { flags: "wx" }));
}

function sourceArchiveUrl(ref, kind, commit) {
  if (commit) return "https://api.github.com/repos/" + REPO + "/tarball/" + encodeURIComponent(commit);
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
    "HOST=" + (options.host || "0.0.0.0"),
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
  const livekitImage = "livekit/livekit-server:" + options.livekitVersion;
  const useImage = options.imageMode !== "build";
  const image = useImage ? GHCR_IMAGE + ":" + sanitizeImageTag(version) : "airmic:" + sanitizeImageTag(version);
  const lines = [
    "# AirMic Docker Compose（由 airmic-cli 生成）",
    "# 安装目录：" + home,
    "# 部署方式：" + (useImage ? "拉取 GHCR 预构建镜像（不编译）" : "从 GitHub 源码本地构建镜像（首次构建需要数分钟）"),
    "# 用法：docker compose -f config/docker-compose.yml up -d",
    "name: airmic",
    "",
    "services:",
    "  airmic:",
  ];
  if (useImage) {
    lines.push("    image: " + image);
    lines.push("    pull_policy: always");
  } else {
    lines.push("    build:");
    lines.push("      context: ../app");
    lines.push("      dockerfile: Dockerfile");
    lines.push("    image: " + image);
  }
  lines.push(
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
  );
  return lines.join("\n");
}
function writeDockerCompose(home, options) {
  const filePath = path.join(home, "config", "docker-compose.yml");
  fs.writeFileSync(filePath, generateDockerCompose(home, options), "utf8");
  return filePath;
}

/** 校验 app/ 目录下能否解析 @airmic/shared（server 运行时依赖）。 */
function verifyAppRuntime(appDir) {
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", 'await import("@airmic/shared")'], {
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

/** 从远端引导安装时只下载了 airmic-cli.mjs，这里生成缺失的包装脚本，保证 bin/airmic 可用。 */
function writeManagementWrapper(binDir, name) {
  const target = path.join(binDir, name);
  if (name === "airmic.sh") {
    fs.writeFileSync(
      target,
      [
        "#!/usr/bin/env bash",
        "# AirMic 部署 CLI 包装脚本（由 airmic-cli 生成）：优先使用安装目录内的 Node，其次使用系统 Node",
        "set -euo pipefail",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'HOME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"',
        'NODE_BIN="${AIRMIC_NODE:-}"',
        'if [ -z "$NODE_BIN" ] && [ -d "$HOME_DIR/.runtime" ]; then',
        '  for candidate in "$HOME_DIR"/.runtime/node-*/bin/node; do',
        '    if [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi',
        "  done",
        "fi",
        'if [ -z "$NODE_BIN" ]; then NODE_BIN="$(command -v node || true)"; fi',
        'if [ -z "$NODE_BIN" ]; then echo "[AirMic] 未找到 Node.js，请先重新运行 install.sh 或设置 AIRMIC_NODE" >&2; exit 1; fi',
        'exec "$NODE_BIN" "$SCRIPT_DIR/airmic-cli.mjs" "$@"',
        "",
      ].join("\n"),
      "utf8",
    );
  } else if (name === "airmic.ps1") {
    fs.writeFileSync(
      target,
      [
        "\uFEFF# AirMic 部署 CLI 包装脚本（由 airmic-cli 生成）",
        '$ErrorActionPreference = "Stop"',
        "$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path",
        "$homeDir = Split-Path -Parent $scriptDir",
        "$node = $null",
        'foreach ($dir in Get-ChildItem -LiteralPath (Join-Path $homeDir ".runtime") -Directory -Filter "node-*" -ErrorAction SilentlyContinue) {',
        "  if ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }",
        '  $candidate = Get-Item -LiteralPath (Join-Path $dir.FullName "node.exe") -ErrorAction SilentlyContinue',
        "  if ($candidate -and -not ($candidate.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $node = $candidate.FullName; break }",
        "}",
        "if (-not $node) {",
        "  $cmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
        "  if ($cmd) { $node = $cmd.Source }",
        "}",
        'if (-not $node) { throw "[AirMic] 未找到 Node.js，请先重新运行 install.ps1 或安装 Node.js 22.13+" }',
        '& $node (Join-Path $scriptDir "airmic-cli.mjs") @args',
        "exit $LASTEXITCODE",
        "",
      ].join("\n"),
      "utf8",
    );
  } else if (name === "airmic.cmd") {
    fs.writeFileSync(
      target,
      [
        "@echo off",
        "rem AirMic 部署 CLI 包装脚本（由 airmic-cli 生成）",
        "setlocal DisableDelayedExpansion",
        'set "SCRIPT_DIR=%~dp0"',
        'set "NODE_BIN="',
        'if not defined NODE_BIN for /d %%D in ("%SCRIPT_DIR%..\\.runtime\\node-*") do if exist "%%D\\node.exe" set "NODE_BIN=%%D\\node.exe"',
        'if not defined NODE_BIN for %%I in (node.exe) do set "NODE_BIN=%%~$PATH:I"',
        "if not defined NODE_BIN (",
        "  echo [AirMic] Node.js not found. Run install.ps1 or install Node.js 22.13+. 1>&2",
        "  exit /b 1",
        ")",
        '"%NODE_BIN%" "%SCRIPT_DIR%airmic-cli.mjs" %*',
        "exit /b %ERRORLEVEL%",
        "",
      ].join("\r\n"),
      "utf8",
    );
  }
  return target;
}

function copyManagementScripts(home, sourceDir) {
  const binDir = path.join(home, "bin");
  mkdirp(binDir);
  const files = ["airmic-cli.mjs", "airmic.sh", "airmic.ps1", "airmic.cmd"];
  for (const name of files) {
    let source = path.join(CLI_DIR, name);
    if (name !== "airmic-cli.mjs" && !exists(source) && sourceDir) source = path.join(sourceDir, name);
    const target = path.join(binDir, name);
    if (exists(source)) {
      if (path.relative(source, target) !== "") {
        if (name === "airmic-cli.mjs") {
          fs.copyFileSync(source, target);
        } else {
          const script = fs.readFileSync(source, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
          const contents = name === "airmic.cmd" ? script.replace(/\n/g, "\r\n") : name === "airmic.ps1" ? "\uFEFF" + script : script;
          fs.writeFileSync(target, contents, "utf8");
        }
      }
    }
    else if (name !== "airmic-cli.mjs") writeManagementWrapper(binDir, name);
    if (exists(target) && (name.endsWith(".sh") || name.endsWith(".mjs"))) {
      try {
        fs.chmodSync(target, 0o755);
      } catch {
        /* ignore */
      }
    }
  }
  // Linux/macOS 提供无扩展名入口：<安装目录>/bin/airmic status
  if (!IS_WIN) {
    const launcher = path.join(binDir, "airmic");
    try {
      fs.rmSync(launcher, { force: true });
      fs.symlinkSync("airmic.sh", launcher);
    } catch {
      /* ignore */
    }
  }
}
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

async function installLivekitBinary(home, versionArg, workspace) {
  const release = await resolveLivekitRelease(versionArg);
  const tag = release.tag_name ? String(release.tag_name) : versionArg || DEFAULT_LIVEKIT_VERSION;
  const asset = pickLivekitAsset(release.assets);
  if (!asset) {
    warn("LiveKit 官方 Release（" + tag + "）没有当前平台（" + process.platform + "/" + process.arch + "）的预编译包。");
    warn("可手动安装 LiveKit 后把二进制放到：" + livekitBinaryPath(home));
    return null;
  }
  const staging = path.join(workspace, "livekit");
  mkdirp(staging);
  const archivePath = path.join(staging, IS_WIN ? "livekit.zip" : "livekit.tar.gz");
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
  assertPlainPath(dir, "directory");
  mkdirp(dir);
  const target = path.join(dir, name + "-" + dateStamp() + ".log");
  assertPlainPath(target, "file");
  return target;
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

/** 监听所有网卡（0.0.0.0/::）时枚举本机非回环 IPv4，给出部署后可直接访问的地址。 */
function accessUrls(host, port) {
  if (!host || host === "0.0.0.0" || host === "::") {
    const ips = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const item of list || []) {
        if (item && item.family === "IPv4" && !item.internal && !ips.includes(item.address)) ips.push(item.address);
      }
    }
    if (ips.length === 0) ips.push("127.0.0.1");
    return ips.map((ip) => "http://" + ip + ":" + port);
  }
  return ["http://" + displayHost(host) + ":" + port];
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
  const urls = accessUrls(env.HOST || "0.0.0.0", port);
  const url = urls[0];
  const launcher = IS_WIN ? path.join(home, "bin", "airmic.cmd") : path.join(home, "bin", "airmic");
  printHeader(APP_NAME + " 安装完成", [
    field("访问地址", bold(urls.join("  "))),
    field("本机自测", "http://127.0.0.1:" + port),
    field("初始化", url + "/setup" + (env.SETUP_TOKEN ? "（需要 SETUP_TOKEN 环境变量中的初始化口令）" : "")),
    field("健康检查", "http://127.0.0.1:" + port + "/api/health"),
    field("安装目录", home),
    field("管理命令", launcher + " status"),
    field("升级命令", launcher + " upgrade"),
    field("日志目录", path.join(home, "logs")),
    field("数据文件", env.DATABASE_PATH || path.join(home, "data", "airmic.db")),
  ]);
  if (extra) log(" " + extra);
  if (!env.HOST || env.HOST === "0.0.0.0" || env.HOST === "::") {
    log(" 提示：已在所有网卡监听。公网访问请在云安全组/防火墙放行 " + port + " 端口；");
    log("       语音需要 HTTPS（反向代理或证书），并在后台把 LiveKit 地址填成浏览器可达的 wss:// 地址。");
  }
  log(" 下一步：用浏览器打开上面的访问地址，按向导创建管理员并完成语音配置。");
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

/** 读取指定 ref（分支/Tag）上的 package.json 版本号；仓库尚未打 Tag 时用于展示与比较。 */
async function fetchRawPackageVersion(ref) {
  if (!ref) return null;
  try {
    const url = "https://raw.githubusercontent.com/" + REPO + "/" + encodeURIComponent(ref) + "/package.json";
    const response = await requestBuffer(url, { timeout: 20000 });
    if (response.status >= 400) return null;
    const pkg = JSON.parse(response.body.toString("utf8"));
    return pkg && pkg.version ? String(pkg.version) : null;
  } catch {
    return null;
  }
}

/** 解析 ref 对应提交 SHA。无 Release 时用它与已安装提交比较，判断是否需要升级。 */
async function resolveCommitSha(ref) {
  if (!ref) return null;
  try {
    const commit = await githubJson("/commits/" + encodeURIComponent(ref));
    return commit && commit.sha ? String(commit.sha) : null;
  } catch {
    return null;
  }
}

async function resolveLatestRemote() {
  let release = null;
  try {
    release = await githubJson("/releases/latest");
  } catch (error) {
    if (error.status !== 404) warn("检查 GitHub Release 失败：" + error.message);
  }
  if (release && release.tag_name) {
    const ref = String(release.tag_name);
    return {
      kind: "release",
      ref,
      url: release.html_url || REPO_URL + "/releases/tag/" + encodeURIComponent(ref),
      name: release.name || ref,
      publishedAt: release.published_at || null,
      version: ref.replace(/^v/i, ""),
      sha: await resolveCommitSha(ref),
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
      const tagName = sorted[0].name;
      return {
        kind: "tag",
        ref: tagName,
        url: REPO_URL + "/releases/tag/" + encodeURIComponent(tagName),
        name: tagName,
        publishedAt: null,
        version: tagName.replace(/^v/i, ""),
        sha: await resolveCommitSha(tagName),
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
    version: await fetchRawPackageVersion(branch),
    sha: await resolveCommitSha(branch),
  };
}

async function resolveSourceRemote(options) {
  const ref = options.ref || process.env.AIRMIC_REF;
  if (!ref) return resolveLatestRemote();
  const commit = await githubJson("/commits/" + encodeURIComponent(ref));
  if (!/^[0-9a-f]{40}$/i.test(commit?.sha || "")) fail("无法解析 GitHub ref：" + ref);
  return { kind: "ref", ref, sha: commit.sha, version: await fetchRawPackageVersion(commit.sha) };
}

async function prepareSourceFromGithub(workspace, remote) {
  const archive = path.join(workspace, "source.tar.gz");
  const extractDir = path.join(workspace, "source-extract");
  const url = sourceArchiveUrl(remote.ref, remote.kind, remote.sha);
  log("  下载源码：" + url);
  try {
    await downloadFile(url, archive);
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
  return {
    type: "source",
    root,
    ref: remote.ref,
    kind: remote.kind,
    version: readPackageVersion(root),
    commit: remote.sha || null,
  };
}

async function fetchLatestRelease(options) {
  try {
    const ref = options.ref || process.env.AIRMIC_REF;
    const release = await githubJson(ref ? "/releases/tags/" + encodeURIComponent(ref) : "/releases/latest");
    if (release && release.tag_name) {
      const tag = String(release.tag_name);
      return {
        tag,
        version: tag.replace(/^v/i, ""),
        assets: Array.isArray(release.assets) ? release.assets : [],
        htmlUrl: release.html_url || REPO_URL + "/releases/tag/" + encodeURIComponent(tag),
        name: release.name || tag,
        publishedAt: release.published_at || null,
      };
    }
    return null;
  } catch (error) {
    if (error.status === 404) return null;
    throw new Error("无法获取 GitHub Release：" + error.message);
  }
}

async function requireLatestRelease(options) {
  const release = await fetchLatestRelease(options);
  if (!release) {
    fail(
      "GitHub 仓库 " + REPO + " 没有对应的 Release。\n" +
        "当前使用 --source release 强制要求预构建包/镜像。\n" +
        "去掉 --source（默认 auto）或改用 --source github，即可直接从 GitHub 源码安装并在本机构建。",
    );
  }
  return release;
}

/** Release 中是否同时带预构建包与 .sha256 校验文件；auto 模式据此决定是否回退到源码直装。 */
function releaseHasBundle(release) {
  const version = release && release.tag ? String(release.tag).replace(/^v/i, "") : "";
  if (!version) return false;
  const expected = bundleArchiveName(version);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const hasArchive = assets.some((asset) => asset && asset.name === expected);
  const hasSha = assets.some((asset) => asset && asset.name === expected + ".sha256");
  return hasArchive && hasSha;
}

/** 通过 GHCR 匿名 token 探测镜像是否可用；不存在/私有/网络异常都返回 false，由调用方回退本地构建。 */
async function ghcrImageAvailable(tag) {
  const repository = REPO.toLowerCase();
  try {
    const tokenUrl = "https://ghcr.io/token?service=ghcr.io&scope=" + encodeURIComponent("repository:" + repository + ":pull");
    const tokenResponse = await requestBuffer(tokenUrl, { timeout: 20000, headers: { Accept: "application/json" } });
    if (tokenResponse.status < 200 || tokenResponse.status >= 300) return false;
    const tokenData = JSON.parse(tokenResponse.body.toString("utf8"));
    const token = tokenData && tokenData.token ? String(tokenData.token) : "";
    if (!token) return false;
    const manifestResponse = await requestBuffer("https://ghcr.io/v2/" + repository + "/manifests/" + encodeURIComponent(tag), {
      timeout: 20000,
      headers: {
        Authorization: "Bearer " + token,
        Accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json",
      },
    });
    return manifestResponse.status >= 200 && manifestResponse.status < 300;
  } catch {
    return false;
  }
}

async function prepareSourceForInstall(workspace, options) {
  const source = options.source;
  if (source === "local") {
    if (!options.build) {
      fail(
        "--source local 使用当前仓库源码在本机编译，需要显式加 --build。\n" +
          "VPS 一键安装请直接使用默认 --source auto：有 Release 预构建包时用预构建包，缺失时自动改为从 GitHub 源码构建。",
      );
    }
    const root = cliRepoRoot();
    if (!root) {
      fail("未找到本地 AirMic 源码。请从仓库的 deploy/airmic-cli.mjs 运行，或使用 --source github 直接从 GitHub 源码安装。");
    }
    return { type: "source", root, ref: detectGitRef(root), kind: "local", version: readPackageVersion(root), commit: null };
  }
  if (source === "github") {
    const remote = await resolveSourceRemote(options);
    log("  GitHub 源码来源：" + describeRemote(remote) + (remote.sha ? "，提交 " + String(remote.sha).slice(0, 8) : ""));
    return prepareSourceFromGithub(workspace, remote);
  }
  fail("--source 只支持 auto、release、github 或 local（当前：" + source + "）");
}

async function resolveInstallSource(workspace, options) {
  if (options.from) {
    log("  使用 --from 指定的安装包/目录 ...");
    return prepareFromLocalOrArchive(workspace, options.from, options);
  }
  const build = Boolean(options.build);
  let source = options.source || "auto";
  if (build && (source === "auto" || source === "release")) source = "local";
  if (source === "auto") {
    const release = await fetchLatestRelease(options);
    if (release && releaseHasBundle(release)) {
      log("  GitHub 最新 Release：" + release.tag + "（含预构建包，无需编译）");
      return downloadReleaseBundle(workspace, release);
    }
    if (release) {
      warn("GitHub Release " + release.tag + " 未提供预构建包（" + bundleArchiveName(release.version) + "），改为从 GitHub 源码安装（本机编译）。");
    } else {
      warn("GitHub 仓库尚未发布 Release 预构建包，改为直接从 GitHub 源码安装（本机 npm ci + build）。");
    }
    source = "github";
  }
  if (source === "release") {
    const release = await requireLatestRelease(options);
    log("  GitHub 最新 Release：" + release.tag + (release.assets.length ? "（资产 " + release.assets.length + " 个）" : "（无资产）"));
    return downloadReleaseBundle(workspace, release);
  }
  const prepared = await prepareSourceForInstall(workspace, { ...options, source });
  return Object.assign({}, prepared, { type: "source", source: "source-build" });
}

async function resolveDockerInstallSource(workspace, options) {
  if (options.from) {
    const prepared = await prepareFromLocalOrArchive(workspace, options.from, options);
    if (prepared.type === "bundle") {
      return { type: "image", version: prepared.version, ref: prepared.ref, source: "image" };
    }
    if (!options.build) {
      fail("Docker 模式使用源码包需要显式 --build（在本地构建镜像）；也可去掉 --from，使用默认 --source auto 直接从 GitHub 安装。");
    }
    return Object.assign({}, prepared, { source: "source-build" });
  }
  const build = Boolean(options.build);
  let source = options.source || "auto";
  if (build && (source === "auto" || source === "release")) source = "local";
  if (source === "auto") {
    const release = await fetchLatestRelease(options);
    if (release) {
      const imageTag = sanitizeImageTag(release.version);
      log("  检查 GHCR 预构建镜像：" + GHCR_IMAGE + ":" + imageTag + " ...");
      if (await ghcrImageAvailable(imageTag)) {
        log("  GitHub 最新 Release：" + release.tag + "（GHCR 镜像可用，无需本地构建）");
        return { type: "image", version: release.version, ref: release.tag, source: "image", release };
      }
      warn("GHCR 镜像 " + imageTag + " 不可用，改为从 GitHub 源码本地构建 Docker 镜像（首次构建需要数分钟）。");
    } else {
      warn("GitHub 仓库尚未发布 Release/GHCR 镜像，改为从 GitHub 源码本地构建 Docker 镜像（首次构建需要数分钟）。");
    }
    source = "github";
  }
  if (source === "release") {
    const release = await requireLatestRelease(options);
    return { type: "image", version: release.version, ref: release.tag, source: "image", release };
  }
  const prepared = await prepareSourceForInstall(workspace, { ...options, source });
  return Object.assign({}, prepared, { type: "source", source: "source-build" });
}

function describeRemote(remote) {
  if (!remote) return "未知";
  const version = normalizeVersion(remote.ref);
  if (version) return remote.ref + "（" + remote.kind + "）";
  return remote.ref + "（" + (remote.kind === "branch" ? "默认分支，无 Tag/Release" : remote.kind) + "）";
}

function stopInstalled(home, mode) {
  const info = readVersionInfo(home);
  const actualMode = mode || (info && info.mode) || "local";
  if (actualMode === "docker") {
    if (exists(dockerComposeFile(home))) {
      if (!hasDocker()) fail("未找到 docker 命令，无法停止当前 AirMic 容器。");
      log("  停止已有 Docker 容器...");
      runDockerCompose(home, ["down"]);
    }
  } else {
    stopLocal(home);
  }
}

function prepareInstallTarget(home, { installed }) {
  if (installed) {
    log("  检测到已有安装，--force 将保留 data/ 与 backups/，重建 app/config/bin/livekit。");
    stopInstalled(home, installedMode(home));
  }
  fs.rmSync(path.join(home, "app"), { recursive: true, force: true });
  fs.rmSync(path.join(home, "config"), { recursive: true, force: true });
  fs.rmSync(path.join(home, "run"), { recursive: true, force: true });
  fs.rmSync(path.join(home, "version.json"), { force: true });
  if (installed) fs.rmSync(path.join(home, "livekit", "bin"), { recursive: true, force: true });
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

/**
 * 监听非回环地址时，安装阶段必须给初始化向导加口令：
 * 否则公网任何人都能抢在站长之前打开 /setup 成为管理员。
 * 显式传了 --setup-token 就用传入值；只监听本机（127.0.0.1/localhost/::1）则不加口令。
 */
function resolveSetupTokenForHost(options, host) {
  const explicit = resolveSetupToken(options);
  if (explicit) return explicit;
  const loopback = !host || host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (loopback) return null;
  const token = randomHex(16);
  warn("监听地址不是本机回环（" + host + "）：已自动生成初始化口令，防止公网用户抢先完成初始化。");
  log("  初始化口令：" + token + "（初始化向导会要求输入，完成后即可忽略）");
  return token;
}

// ============ 预构建包（Release Bundle）工具 ============

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readSha256File(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const match = text.match(/[0-9a-f]{64}/i);
  if (!match) fail("无法解析 SHA-256 文件：" + filePath);
  return match[0].toLowerCase();
}

/** 读取压缩包条目并拒绝绝对路径 / 路径穿越（安全解压） */
function assertSafeArchive(archivePath) {
  const result = spawnSync("tar", ["-tf", archivePath], { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    fail("无法读取压缩包列表（文件损坏或缺少 tar）：" + (result.stderr ? String(result.stderr).trim() : "未知错误"));
  }
  const entries = String(result.stdout || "").split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) fail("压缩包为空：" + archivePath);
  for (const entry of entries) {
    const normalized = entry.split("\\").join("/");
    const parts = normalized.split("/");
    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || parts.includes("..") ||
        (IS_WIN && parts.some((part) => part !== "." && /[:<>|?*]|[. ]$|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) {
      fail("压缩包包含不安全路径，拒绝解压：" + entry);
    }
  }
  const listing = spawnSync("tar", ["-tvf", archivePath], { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (listing.status !== 0 || String(listing.stdout).split(/\r?\n/).filter(Boolean).some((entry) => !/^[-d]/.test(entry))) {
    fail("压缩包包含链接或特殊文件，拒绝解压：" + archivePath);
  }
}

function isBundleDir(dir) {
  return (
    exists(path.join(dir, "package.json")) &&
    exists(path.join(dir, "server", "dist", "index.js")) &&
    exists(path.join(dir, "web", "dist", "index.html")) &&
    exists(path.join(dir, "node_modules"))
  );
}

function isSourceDir(dir) {
  return (
    exists(path.join(dir, "package.json")) &&
    exists(path.join(dir, "server", "src")) &&
    exists(path.join(dir, "web", "src")) &&
    exists(path.join(dir, "shared", "src"))
  );
}

function findBundleRoot(dir) {
  if (isBundleDir(dir)) return dir;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    if (isBundleDir(child)) return child;
  }
  return null;
}

function validateBundleRoot(root) {
  if (!isBundleDir(root)) {
    fail("预构建包结构不正确：需要包含 package.json、server/dist/index.js、web/dist/index.html 与 node_modules。");
  }
  const sharedDir = path.join(root, "node_modules", "@airmic", "shared");
  if (!exists(sharedDir)) {
    warn("预构建包中未找到 node_modules/@airmic/shared，将尝试运行时预检与兜底复制。");
  }
  if (!verifyAppRuntime(root)) {
    fail("预构建包运行时预检失败：无法解析 @airmic/shared，包可能不完整，请重新下载或联系发布者。");
  }
}

function copyBundleTree(sourceDir, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  mkdirp(destDir);
  fs.cpSync(sourceDir, destDir, { recursive: true, force: true });
}

function bundleArchiveName(version) {
  return "airmic-" + String(version).replace(/^v/i, "") + ".tar.gz";
}

async function downloadReleaseBundle(workspace, release) {
  const version = String(release.tag || release.ref || "").replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) fail("Release 版本号无效：" + version);
  const expected = bundleArchiveName(version);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const archiveAsset = assets.find((asset) => asset && asset.name === expected);
  if (!archiveAsset) {
    fail(
      "该版本未提供预构建包（Release " + release.tag + " 中缺少 " + expected + "）。\n" +
        "可改用 --source github 直接从 GitHub 源码安装（本机编译），或使用 --from 指定离线预构建包。",
    );
  }
  const shaAsset = assets.find((asset) => asset && asset.name === expected + ".sha256");
  if (!shaAsset) {
    fail("Release 中缺少 " + expected + ".sha256 校验文件，出于安全考虑拒绝安装。可使用 --source github 从 GitHub 源码安装，或用 --from 指定本地预构建包。");
  }
  const staging = path.join(workspace, "release-bundle");
  mkdirp(staging);
  const archivePath = path.join(staging, expected);
  const shaPath = path.join(staging, expected + ".sha256");
  log("  下载预构建包：" + archiveAsset.browser_download_url);
  await downloadFile(archiveAsset.browser_download_url, archivePath);
  log("  下载校验文件：" + shaAsset.browser_download_url);
  await downloadFile(shaAsset.browser_download_url, shaPath);
  const expectedHash = readSha256File(shaPath);
  const actualHash = sha256File(archivePath);
  if (expectedHash !== actualHash) {
    fail("预构建包 SHA-256 校验失败：期望 " + expectedHash + "，实际 " + actualHash + "。文件可能损坏或被篡改，已中止。");
  }
  log("  SHA-256 校验通过：" + actualHash.slice(0, 16) + "...");
  const extractDir = path.join(staging, "extract");
  mkdirp(extractDir);
  extractArchive(archivePath, extractDir);
  const root = findBundleRoot(extractDir);
  if (!root) fail("预构建包解压后未找到 AirMic 应用目录（package.json/server/dist/web/dist/node_modules）。");
  validateBundleRoot(root);
  const versionFromPkg = readPackageVersion(root) || version;
  if (versionFromPkg !== version) fail("Release 标签与预构建包版本不一致：" + release.tag + " / " + versionFromPkg);
  return {
    type: "bundle",
    root,
    version: versionFromPkg,
    ref: release.tag || "v" + version,
    source: "release-bundle",
    archivePath,
  };
}

async function prepareFromLocalOrArchive(workspace, from, options) {
  const staging = path.join(workspace, "from");
  mkdirp(staging);
  let candidate = null;
  if (isUrl(from)) {
    const ext = /\.zip(?:[?#]|$)/i.test(from) ? ".zip" : ".tar.gz";
    const archive = path.join(staging, "download" + ext);
    log("  下载安装包：" + from);
    await downloadFile(from, archive);
    const extractDir = path.join(staging, "extract");
    mkdirp(extractDir);
    extractArchive(archive, extractDir);
    candidate = isBundleDir(extractDir) || isSourceDir(extractDir) ? extractDir : findBundleRoot(extractDir) || findProjectRoot(extractDir);
  } else {
    const resolved = path.resolve(process.cwd(), from);
    if (!exists(resolved)) fail("--from 指定的路径不存在：" + resolved);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      candidate = isBundleDir(resolved) || isSourceDir(resolved) ? resolved : findBundleRoot(resolved) || findProjectRoot(resolved);
    } else {
      log("  解压安装包：" + resolved);
      const extractDir = path.join(staging, "extract");
      mkdirp(extractDir);
      extractArchive(resolved, extractDir);
      candidate = isBundleDir(extractDir) || isSourceDir(extractDir) ? extractDir : findBundleRoot(extractDir) || findProjectRoot(extractDir);
    }
  }
  if (!candidate) fail("--from 指定的包无法识别：既不是 AirMic 预构建包，也不是源码包。");
  const version = readPackageVersion(candidate);
  if (isBundleDir(candidate)) {
    validateBundleRoot(candidate);
    return { type: "bundle", root: candidate, version, ref: "local-bundle", source: "release-bundle" };
  }
  if (isSourceDir(candidate)) {
    if (!options.build) {
      fail(
        "该压缩包是源码包，需要在目标机器编译（npm ci + npm run build）。\n" +
          "请改用官方预构建包，或显式加 --build 确认在本机构建。",
      );
    }
    return { type: "source", root: candidate, version, ref: "local-source", source: "source-build" };
  }
  fail("无法识别包结构：" + candidate);
}

// ============ 安装流程 ============

async function installLocal(home, options, sourceInfo, workspace) {
  const appDir = path.join(home, "app");
  const port = resolvePort(options);
  // 默认监听所有网卡：装完即可从公网/局域网访问（只给本机用可显式 --host 127.0.0.1）
  const host = options.host || "0.0.0.0";
  const keys = generateKeys();
  const setupToken = resolveSetupTokenForHost(options, host);
  const jwtSecret = randomHex(32);
  const isBundle = sourceInfo.type === "bundle";
  let version = sourceInfo.version || "0.0.0";

  fs.rmdirSync(appDir);
  fs.renameSync(sourceInfo.appSource, appDir);
  version = readPackageVersion(appDir) || version;
  const runtimeOk = isBundle ? verifyAppRuntime(appDir) : fixWorkspaceLinks(appDir);
  if (!runtimeOk) fail("安装预检失败：应用无法解析 @airmic/shared。");

  step(3, 7, "生成运行配置与 LiveKit 配置 ...");
  writeAirMicEnv(home, { mode: "local", port, host, keys, setupToken, jwtSecret });
  writeLivekitConfig(home, keys);

  step(4, 7, "准备管理脚本 ...");
  if (isBundle) copyManagementScripts(home, null);
  else copyManagementScripts(home, path.join(appDir, "deploy"));

  let livekitVersion = null;
  if (!options.noLivekit) {
    step(5, 7, "下载并安装 LiveKit Server ...");
    livekitVersion = await installLivekitBinary(home, options.livekit_version, workspace);
    if (!livekitVersion) warn("LiveKit 未安装成功，语音暂不可用；可手动把二进制放入 " + path.join(home, "livekit", "bin") + " 后执行 restart。");
  } else {
    step(5, 7, "跳过 LiveKit 下载（--no-livekit），语音暂不可用。");
  }

  writeVersionInfo(home, {
    version,
    ref: sourceInfo.ref,
    commit: sourceInfo.commit || null,
    source: isBundle ? "release-bundle" : "source-build",
    mode: "local",
    livekitVersion,
  });

  step(6, 7, "启动 LiveKit 与 AirMic ...");
  cleanupOldLogs(home, 3);
  startLogCleanupDaemon(home);
  const lk = startLivekit(home, Boolean(options.noLivekit));
  if (lk.started) log("  LiveKit 已启动（PID " + lk.pid + "），日志：" + logPath(home, "livekit"));
  else if (lk.missing) warn("未找到 LiveKit 二进制，AirMic 将启动但语音不可用。");
  else if (lk.skipped) warn("已按 --no-livekit 跳过 LiveKit 启动，语音暂不可用。");

  startAirMic(home);
  const env = loadRuntimeEnv(home);
  const health = await fetchHealth(env.HOST, env.PORT || DEFAULT_PORT, 120000);
  step(7, 7, "完成。");
  log("  健康检查通过：版本 " + (health.version || version) + (isBundle ? "（预构建包，未编译）" : "（源码构建）"));
  printAccessInfo(home, env);
  return 0;
}
async function installDocker(home, options, sourceInfo) {
  const appDir = path.join(home, "app");
  const port = resolvePort(options);
  const keys = generateKeys();
  const setupToken = resolveSetupTokenForHost(options, "0.0.0.0");
  const jwtSecret = randomHex(32);
  const livekitVersion = options.livekit_version && options.livekit_version !== "latest" ? options.livekit_version : DEFAULT_LIVEKIT_VERSION;
  const useImage = sourceInfo.type === "image";
  let version = sourceInfo.version || "0.0.0";

  if (useImage) {
    step(2, 7, "使用 GHCR 预构建镜像，无需编译（" + GHCR_IMAGE + ":" + version + "）...");
  } else {
    step(2, 7, "复制 GitHub 源码，准备本地 Docker 镜像构建（首次构建需要数分钟）...");
    copyProjectTree(sourceInfo.root, appDir);
    version = readPackageVersion(appDir) || version;
  }

  step(3, 7, "生成 Docker Compose / env / LiveKit 配置 ...");
  writeAirMicEnv(home, { mode: "docker", port, host: "0.0.0.0", keys, setupToken, jwtSecret });
  writeLivekitConfig(home, keys);
  writeDockerCompose(home, { port, version, livekitVersion, imageMode: useImage ? "ghcr" : "build" });

  step(4, 7, "准备管理脚本 ...");
  copyManagementScripts(home, useImage ? null : path.join(appDir, "deploy"));
  writeVersionInfo(home, { version, ref: sourceInfo.ref, commit: sourceInfo.commit || null, source: useImage ? "image" : "source-build", mode: "docker", livekitVersion });
  cleanupOldLogs(home, 3);

  if (useImage) {
    step(5, 7, "拉取 GHCR 镜像（不在 VPS 上构建）...");
    try {
      runDockerCompose(home, ["pull", "airmic"]);
    } catch (error) {
      fail(
        "拉取 GHCR 镜像失败：" + (error && error.message ? error.message : error) + "\n" +
          "请检查：\n" +
          "  1) 镜像与标签是否存在：" + GHCR_IMAGE + ":" + version + "\n" +
          "  2) GHCR 包可见性：public 包可直接拉取；private 包需先执行 docker login ghcr.io（用户名 + PAT）\n" +
          "  3) 网络/代理是否可访问 ghcr.io\n" +
          "开发者也可使用 --build 在本地构建镜像。",
      );
    }
    runDockerCompose(home, ["pull", "livekit"], true);
    step(6, 7, "启动容器 ...");
    runDockerCompose(home, ["up", "-d"]);
  } else {
    step(5, 7, "本地构建并启动 Docker 镜像（从 GitHub 源码构建，首次可能较慢）...");
    runDockerCompose(home, ["up", "-d", "--build"]);
    step(6, 7, "等待服务启动 ...");
  }

  const env = loadRuntimeEnv(home);
  const health = await fetchHealth("127.0.0.1", port, 300000);
  step(7, 7, "完成。查看日志：node " + path.join(home, "bin", "airmic-cli.mjs") + " logs");
  log("  健康检查通过：版本 " + (health.version || version) + (useImage ? "（GHCR 镜像，未编译）" : "（源码构建）"));
  printAccessInfo(home, Object.assign({}, env, { DATABASE_PATH: path.join(home, "data", "airmic.db") }));
  return 0;
}
async function runInstall(options) {
  const mode = options.mode || "local";
  if (mode !== "local" && mode !== "docker") fail("--mode 只支持 local 或 docker（当前：" + mode + "）");
  const home = resolveHome(options);
  if (mode === "docker") {
    if (!hasDocker()) fail("未找到 docker 命令，请先安装 Docker Desktop / Docker Engine，或使用 --mode local 本地部署。");
    if (!hasDockerComposeV2()) fail("未找到 docker compose v2，请升级 Docker Compose。");
  } else if (!nodeSatisfies(MIN_NODE_APP)) {
    fail("Node.js 版本过低：当前 " + process.versions.node + "，本地运行 AirMic 需要 >= " + MIN_NODE_APP + "（推荐 24 LTS）。");
  }
  printHeader(APP_NAME + " 安装 · " + (mode === "docker" ? "Docker 模式" : "本地模式"), [
    field("安装目录", home),
    field("CLI 版本", "v" + CLI_VERSION),
    field("来源策略", "GitHub Release 预构建包/镜像优先，缺失时直接从 GitHub 源码构建"),
  ]);
  return withDeploymentLock(home, "install", async (state) => {
    if (state.installed && !options.force) fail("该目录已有 AirMic 部署。请使用 upgrade，或加 --force 重新安装：" + home);
    return withStaging(home, async (workspace) => {
      step(1, 7, "解析部署来源（Release 预构建包 / GHCR 镜像 / GitHub 源码 / --from 离线包）...");
      const sourceInfo = mode === "docker" ? await resolveDockerInstallSource(workspace, options) : await resolveInstallSource(workspace, options);
      log("  版本：v" + (sourceInfo.version || "未知") + "，来源：" + describeSource(sourceInfo.source) + "，ref：" + (sourceInfo.ref || "未知"));
      if (mode === "local") {
        step(2, 7, sourceInfo.type === "bundle" ? "准备预构建包，无需编译 ..." : "在临时目录构建源码 ...");
        sourceInfo.appSource = await prepareUpgradeApp(workspace, { ...sourceInfo, kind: sourceInfo.type }, mode);
        const runtimeOk = sourceInfo.type === "bundle" ? verifyAppRuntime(sourceInfo.appSource) : fixWorkspaceLinks(sourceInfo.appSource);
        if (!runtimeOk) fail("待安装应用无法解析 @airmic/shared。");
      }
      validateHome(resolveHome(options), "install");
      prepareInstallTarget(home, state);
      if (mode === "docker") return installDocker(home, options, sourceInfo);
      return installLocal(home, options, sourceInfo, workspace);
    });
  });
}
function writeVersionInfo(home, info) {
  writeJson(path.join(home, "version.json"), {
    version: info.version,
    ref: info.ref,
    commit: info.commit || null,
    source: info.source || "source-build",
    mode: info.mode,
    repo: info.repo || REPO,
    installedAt: info.installedAt || new Date().toISOString(),
    livekitVersion: info.livekitVersion || null,
  });
}
function describeSource(source) {
  if (source === "release-bundle") return "Release 预构建包（无需编译）";
  if (source === "image") return "GHCR 预构建镜像（无需编译）";
  if (source === "source-build") return "源码构建（从 GitHub 源码或本地仓库构建）";
  return "未知/旧版安装";
}

function installedMode(home) {
  const info = readVersionInfo(home);
  return info && info.mode === "docker" ? "docker" : "local";
}

function ensureInstalled(home) {
  if (!validateHome(home, "manage").installed) {
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
  log("  访问地址：" + accessUrls(env.HOST || "0.0.0.0", env.PORT || DEFAULT_PORT).join("  "));
  return 0;
}

async function startDockerMode(home) {
  if (!hasDocker()) fail("未找到 docker 命令，无法启动 Docker 部署。");
  runDockerCompose(home, ["up", "-d"]);
  const env = loadRuntimeEnv(home);
  const port = Number(env.PORT || (readVersionInfo(home) && readVersionInfo(home).port) || DEFAULT_PORT);
  const health = await fetchHealth("127.0.0.1", port, 180000);
  log("  健康检查通过：版本 " + (health.version || readAppVersion(home) || "未知"));
  log("  访问地址：" + accessUrls("0.0.0.0", port).join("  "));
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
  ensureInstalled(home);
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
  const health = await quickHealth(env.HOST, port);
  const healthText = health.ok
    ? "正常" + (health.body && health.body.version ? "（v" + health.body.version + "）" : "")
    : "异常" + (health.error ? "（" + health.error + "）" : health.status ? "（HTTP " + health.status + "）" : "");
  const rows = [
    field("安装目录", home),
    field("部署模式", mode === "docker" ? "Docker" : "本地"),
    field("当前版本", "v" + (readAppVersion(home) || info.version || "未知")),
    field("Git ref", info.ref || "未知"),
    field("提交版本", info.commit ? String(info.commit).slice(0, 8) : "未记录（旧版安装）"),
    field("安装来源", describeSource(info.source)),
    field("LiveKit", info.livekitVersion ? info.livekitVersion : mode === "docker" ? DEFAULT_LIVEKIT_VERSION + "（容器）" : "未安装/未记录"),
    field("访问地址", accessUrls(env.HOST || "0.0.0.0", port).join("  ")),
  ];
  if (mode !== "docker") {
    const cleanupPid = cleanupDaemonPid(home);
    rows.push(field("日志清理", cleanupPid && isProcessAlive(cleanupPid) ? "运行中（PID " + cleanupPid + "）" : "未运行"));
    for (const name of ["airmic", "livekit"]) {
      const pid = readPid(home, name);
      const alive = pid && isProcessAlive(pid);
      rows.push(field(name + " 进程", alive ? "运行中（PID " + pid + "）" : pid ? "已退出（PID " + pid + "）" : "未运行"));
    }
  }
  rows.push(field("健康检查", paint(health.ok ? "green" : "yellow", healthText)));
  rows.push(field("日志目录", path.join(home, "logs")));
  printHeader(APP_NAME + " 部署状态", rows);
  if (mode === "docker") {
    if (!hasDocker()) warn("未找到 docker 命令，无法读取容器状态。");
    else runDockerCompose(home, ["ps"], true);
  }
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
    remote = await resolveSourceRemote(options);
  } catch (error) {
    const payload = { ok: false, currentVersion: localVersion, error: error.message, checkedAt: new Date().toISOString() };
    if (jsonMode) console.log(JSON.stringify(payload, null, 2));
    else console.error("检查更新失败：" + error.message);
    return 1;
  }
  let latestVersion = null;
  let updateAvailable = false;
  let error = null;
  const installedCommit = info && info.commit ? String(info.commit) : null;
  const latestCommit = remote.sha ? String(remote.sha) : null;
  if (remote.kind === "release" || remote.kind === "tag") {
    const normalized = normalizeVersion(remote.ref);
    latestVersion = normalized ? String(remote.ref).replace(/^v/i, "") : null;
    updateAvailable = latestVersion ? compareVersions(latestVersion, localVersion) > 0 : false;
  } else {
    latestVersion = remote.version || null;
    if (latestCommit && installedCommit) {
      updateAvailable = latestCommit !== installedCommit;
    } else if (latestVersion) {
      updateAvailable = compareVersions(latestVersion, localVersion) > 0;
    } else {
      updateAvailable = true;
    }
    if (remote.kind === "branch") {
      error =
        "仓库尚未发布版本 Tag/Release：upgrade 会直接从默认分支 " + remote.ref + " 的 GitHub 源码重新构建安装（本机编译，无需 clone 仓库）。" +
        "建议在 GitHub 上打标签（如 v1.1.0）以获得预构建包与版本化更新。";
    }
  }
  const result = {
    ok: true,
    currentVersion: localVersion,
    currentCommit: installedCommit,
    latestVersion,
    latestCommit,
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
    log("  当前版本 : v" + localVersion + (installedCommit ? "（提交 " + installedCommit.slice(0, 8) + "）" : ""));
    log("  GitHub   : " + REPO);
    log("  最新来源 : " + describeRemote(remote));
    log("  最新版本 : " + (latestVersion ? "v" + latestVersion : "（无 Tag/Release，使用 " + remote.ref + " 源码）"));
    if (latestCommit) log("  最新提交 : " + latestCommit.slice(0, 8));
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
  const base = path.join(home, "backups", "airmic-db-" + nowStamp() + "-" + randomHex(4));
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

function releaseAlreadyInstalled(release, info, source, options) {
  const order = compareVersions(release.version, info.version || "0.0.0");
  return !options.force && (order < 0 || (order === 0 && info.source === source));
}

async function resolveUpgradeTarget(workspace, info, options) {
  const mode = info.mode === "docker" ? "docker" : "local";
  if (options.from) {
    const prepared = await prepareFromLocalOrArchive(workspace, options.from, options);
    if (prepared.type === "bundle") {
      log("  使用预构建包，无需编译：" + prepared.version);
      return {
        kind: mode === "docker" ? "image" : "bundle",
        version: prepared.version,
        ref: prepared.ref,
        source: mode === "docker" ? "image" : "release-bundle",
        appSource: prepared.root,
      };
    }
    return Object.assign({}, prepared, { kind: "source", source: "source-build" });
  }
  const build = Boolean(options.build);
  let source = options.source || "auto";
  if (build && (source === "auto" || source === "release")) source = "local";

  if (source === "auto") {
    const release = await fetchLatestRelease(options);
    if (mode === "docker") {
      const imageTag = release ? sanitizeImageTag(release.version) : null;
      if (release && imageTag && (await ghcrImageAvailable(imageTag))) {
        log("  GitHub 最新 Release：" + release.tag + "（GHCR 镜像可用）");
        if (releaseAlreadyInstalled(release, info, "image", options)) {
          return { kind: "latest", version: release.version, ref: release.tag, release };
        }
        return { kind: "image", version: release.version, ref: release.tag, source: "image", release };
      }
      warn(release ? "GHCR 镜像 " + imageTag + " 不可用，改为从 GitHub 源码升级（本地重建镜像）。" : "仓库尚未发布 Release/GHCR 镜像，改为从 GitHub 源码升级（本地重建镜像）。");
      source = "github";
    } else if (release && releaseHasBundle(release)) {
      log("  GitHub 最新 Release：" + release.tag + "（含预构建包）");
      if (releaseAlreadyInstalled(release, info, "release-bundle", options)) {
        return { kind: "latest", version: release.version, ref: release.tag, release };
      }
      const bundle = await downloadReleaseBundle(workspace, release);
      return Object.assign({}, bundle, { kind: "bundle", source: "release-bundle" });
    } else {
      warn(release ? "Release " + release.tag + " 未提供预构建包，改为从 GitHub 源码升级（本机重新构建）。" : "仓库尚未发布 Release，改为直接从 GitHub 源码升级（本机重新构建）。");
      source = "github";
    }
  }

  if (source === "release") {
    const release = await requireLatestRelease(options);
    log("  GitHub 最新 Release：" + release.tag);
    if (releaseAlreadyInstalled(release, info, mode === "docker" ? "image" : "release-bundle", options)) {
      return { kind: "latest", version: release.version, ref: release.tag, release };
    }
    if (mode === "docker") {
      return { kind: "image", version: release.version, ref: release.tag, source: "image", release };
    }
    const bundle = await downloadReleaseBundle(workspace, release);
    return Object.assign({}, bundle, { kind: "bundle", source: "release-bundle" });
  }

  if (source === "local" || source === "github") {
    if (source === "github") {
      const remote = await resolveSourceRemote(options);
      log("  GitHub 源码来源：" + describeRemote(remote) + (remote.sha ? "，提交 " + String(remote.sha).slice(0, 8) : ""));
      if (!options.force && remote.sha && info.commit && String(remote.sha) === String(info.commit)) {
        return { kind: "latest", version: info.version || null, ref: remote.ref, commit: remote.sha };
      }
      const prepared = await prepareSourceFromGithub(workspace, remote);
      return Object.assign({}, prepared, { kind: "source", source: "source-build" });
    }
    const prepared = await prepareSourceForInstall(workspace, { ...options, source });
    return Object.assign({}, prepared, { kind: "source", source: "source-build" });
  }
  fail("--source 只支持 auto、release、github 或 local（当前：" + source + "）");
}

async function prepareUpgradeApp(workspace, target, mode) {
  if (target.kind === "image") return null;
  const appNext = path.join(workspace, "app-next");
  if (target.kind === "bundle") {
    const bundle = target.appSource || target.root;
    if (pathIsWithin(workspace, bundle)) fs.renameSync(bundle, appNext);
    else copyBundleTree(bundle, appNext);
    return appNext;
  }
  if (target.kind === "source") {
    copyProjectTree(target.root, appNext);
    if (mode === "local") {
      log("  构建新版本（从 GitHub 源码构建，npm ci + npm run build）...");
      if (!hasNpm()) fail("源码升级需要 npm；VPS 请使用 Release 预构建包，或安装 Node/npm 后重试。");
      npmInstallAndBuild(appNext);
    }
    return appNext;
  }
  return null;
}

async function upgradeCommand(options) {
  const home = resolveHome(options);
  ensureInstalled(home);
  if (options.check) return checkUpdateCommand(options);
  return withDeploymentLock(home, "upgrade", () =>
    withStaging(home, (workspace) => upgradeInstalled(home, workspace, options)));
}

async function upgradeInstalled(home, workspace, options) {
  const info = readVersionInfo(home) || {};
  const mode = info.mode === "docker" ? "docker" : "local";

  printHeader(APP_NAME + " OTA 升级", [
    field("当前版本", "v" + (info.version || "未知") + (info.commit ? "（提交 " + String(info.commit).slice(0, 8) + "）" : "")),
    field("部署模式", mode === "docker" ? "Docker" : "本地"),
    field("安装目录", home),
    field("来源策略", "Release 预构建包/镜像优先，缺失时直接从 GitHub 源码重建"),
  ]);

  step(1, 7, "解析升级来源（Release 预构建包 / GHCR 镜像 / GitHub 源码 / --from 离线包）...");
  const target = await resolveUpgradeTarget(workspace, info, options);
  if (target.kind === "latest") {
    log(
      "  已是最新版本（当前 v" + (info.version || "未知") + (info.commit ? "，提交 " + String(info.commit).slice(0, 8) : "") + "，GitHub：" + target.ref + "），无需升级。",
    );
    log("  如需强制重新安装同版本：upgrade --force");
    return 0;
  }
  log("  目标版本：" + (target.version ? "v" + target.version : target.ref) + "，来源：" + describeSource(target.source) + "，ref：" + (target.ref || "未知"));

  const oldCompose = mode === "docker" && exists(dockerComposeFile(home)) ? fs.readFileSync(dockerComposeFile(home), "utf8") : null;

  step(2, 7, target.kind === "image" ? "拉取 GHCR 镜像（不编译）..." : "准备新版本应用（预构建包直接使用 / 源码构建）...");
  let appSource = null;
  if (target.kind === "image") {
    try {
      if (!hasDocker()) fail("未找到 docker 命令，无法升级 Docker 部署。");
      runCommand("docker", ["pull", GHCR_IMAGE + ":" + sanitizeImageTag(target.version)], { cwd: home });
    } catch (error) {
      fail(
        "拉取新版本镜像失败：" + (error && error.message ? error.message : error) + "\n" +
          "请检查 GHCR 包可见性 / docker login ghcr.io / 网络；旧版本服务未做任何改动。",
      );
    }
  } else {
    appSource = await prepareUpgradeApp(workspace, target, mode);
    if (target.kind === "source" && mode === "local" && !fixWorkspaceLinks(appSource)) {
      fail("新版本源码构建后无法解析 @airmic/shared，升级中止（旧版本服务未改动）。");
    }
  }

  validateHome(resolveHome(options), "upgrade");
  const env = loadRuntimeEnv(home);
  const port = Number(env.PORT || DEFAULT_PORT);
  const oldVersion = sanitizeRef(info.version || "unknown");
  const oldApp = path.join(home, "app");
  const backupApp = path.join(home, "backups", "app-" + oldVersion + "-" + nowStamp() + "-" + randomHex(4));
  let appMoved = false;
  let appReplaced = false;
  let dbBackup;
  try {
    step(3, 7, "停止当前服务 ...");
    stopInstalled(home, mode);
    step(4, 7, "备份数据库与旧版本 ...");
    dbBackup = backupDatabase(home);
    log("  " + (dbBackup ? "数据库备份：" + dbBackup : "未找到数据库文件，跳过备份"));
    if (appSource) {
      if (exists(oldApp)) {
        mkdirp(path.dirname(backupApp));
        fs.renameSync(oldApp, backupApp);
        appMoved = true;
      }
      fs.renameSync(appSource, oldApp);
      appReplaced = true;
      if (mode === "local") {
        const runtimeOk = target.kind === "source" ? fixWorkspaceLinks(oldApp) : verifyAppRuntime(oldApp);
        if (!runtimeOk) fail("新版本无法解析 @airmic/shared。");
      }
    }
    step(5, 7, "启动新版本 ...");
    if (mode === "docker") {
      const livekitVersion = info.livekitVersion && /^v/.test(String(info.livekitVersion)) ? info.livekitVersion : DEFAULT_LIVEKIT_VERSION;
      if (target.kind === "image") {
        writeDockerCompose(home, { port, version: target.version, livekitVersion, imageMode: "ghcr" });
        runDockerCompose(home, ["pull", "airmic"], true);
        runDockerCompose(home, ["up", "-d"]);
      } else {
        writeDockerCompose(home, { port, version: target.version, livekitVersion, imageMode: "build" });
        runDockerCompose(home, ["up", "-d", "--build"]);
      }
      const health = await fetchHealth("127.0.0.1", port, 300000);
      log("  健康检查通过：v" + (health.version || target.version));
    } else {
      startLogCleanupDaemon(home);
      const lk = startLivekit(home, false);
      if (lk.missing) warn("未找到 LiveKit 二进制，语音暂不可用。");
      startAirMic(home);
      const health = await fetchHealth(env.HOST, port, 120000);
      log("  健康检查通过：v" + (health.version || target.version));
    }
    copyManagementScripts(home, appSource ? path.join(oldApp, "deploy") : null);
    writeVersionInfo(home, {
      version: target.version,
      ref: target.ref,
      commit: target.commit || null,
      source: target.source,
      mode,
      livekitVersion: info.livekitVersion || null,
    });
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
    if (appReplaced) fs.rmSync(oldApp, { recursive: true, force: true });
    if (appMoved) fs.renameSync(backupApp, oldApp);
    if (oldCompose) fs.writeFileSync(dockerComposeFile(home), oldCompose, "utf8");
    if (info && info.version) writeVersionInfo(home, info);
    else fs.rmSync(path.join(home, "version.json"), { force: true });
    try {
      if (mode === "docker") {
        if (hasDocker()) {
          const pullNever = runDockerCompose(home, ["up", "-d", "--pull", "never"], true);
          if (pullNever.status !== 0) runDockerCompose(home, ["up", "-d"], true);
        }
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
  step(7, 7, "升级完成：v" + oldVersion + " -> v" + target.version + "（" + describeSource(target.source) + "）");
  if (appMoved) log("  旧版本 app 备份：" + backupApp);
  log("  数据库备份    ：" + (dbBackup || "无"));
  log("  查看状态      ：node " + path.join(home, "bin", "airmic-cli.mjs") + " status");
  log("");
  return 0;
}
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
  printHeader(APP_NAME + " 卸载", [
    field("安装目录", home),
    field("清理范围", options.purge ? "程序 + 数据/备份（--purge）" : "仅程序，保留 data/ 与 backups/"),
  ]);
  const completed = await withDeploymentLock(home, "uninstall", async (state) => {
    if (!state.installed && !state.owned) fail("未找到 AirMic 安装目录：" + home);
    if (!options.yes) {
      if (!process.stdin.isTTY) fail("当前为非交互环境，请加 --yes 确认卸载。");
      const scope = options.purge ? "（同时删除 AirMic 的 data/ 与 backups/）" : "（保留 data/ 与 backups/）";
      if (!(await confirm("确认卸载 " + home + " 下的 AirMic" + scope + "？"))) {
        log("已取消。");
        return false;
      }
    }
    validateHome(resolveHome(options), "uninstall");
    if (options.purge && IS_WIN && pathIsWithin(path.join(home, ".runtime"), process.execPath)) {
      fail("Windows 正在使用安装目录里的 Node。请通过仓库的一键脚本执行 uninstall --purge，以便从临时目录运行。");
    }
    markHome(home);
    if (state.installed) stopInstalled(home, installedMode(home));
    const directories = options.purge ? [...MANAGED_DIRS, ...RETAINED_DIRS] : MANAGED_DIRS.filter((dir) => dir !== ".runtime");
    for (const dir of directories) {
      const target = path.join(home, dir);
      if (assertPlainPath(target, "directory")) fs.rmSync(target, { recursive: true });
    }
    fs.rmSync(path.join(home, "version.json"), { force: true });
    if (options.purge) fs.unlinkSync(path.join(home, HOME_MARKER));
    return true;
  });
  if (!completed) return 0;
  if (options.purge) {
    try {
      fs.rmdirSync(home);
      log("已删除 AirMic 安装目录：" + home);
    } catch (error) {
      if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
      log("已清除 AirMic 文件与数据，安装目录中的其他文件已保留：" + home);
    }
  } else {
    log("已卸载 AirMic 程序，data/ 与 backups/ 保留于：" + home);
  }
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
    "  install              安装部署（默认本地模式；优先 Release 预构建包，无 Release 时直接从 GitHub 源码构建）",
    "  start                启动已安装的服务",
    "  stop                 停止服务",
    "  restart              重启服务",
    "  status               查看进程、健康检查、版本、安装来源与访问地址",
    "  logs                 查看日志（本地每日文件 / Docker compose logs）",
    "  check-update         检查 GitHub 最新版本（退出码：0 最新、10 有更新、1 失败）",
    "  upgrade              在线 OTA 升级（自动识别 Release/源码来源；自动备份、原子切换、失败自动回滚）",
    "  uninstall            卸载（默认保留 data/ 与 backups/）",
    "  docker-up            以 Docker 模式启动",
    "  docker-down          以 Docker 模式停止",
    "  docker-logs          查看 Docker 日志",
    "  docker-status        查看 Docker 状态",
    "  version              显示 CLI 已安装版本",
    "  help                 显示本帮助",
    "",
    "install 选项：",
    "  --mode local|docker      部署模式（默认 local）",
    "  --dir <路径>             安装目录（默认 Windows: %USERPROFILE%\\.airmic，Linux/macOS: ~/.airmic；或环境变量 AIRMIC_HOME）",
    "  --source auto|release|github|local",
    "                           部署来源（默认 auto：Release 预构建包/镜像优先，缺失时直接用 GitHub 源码构建）",
    "  --build                  开发者模式：使用当前仓库源码构建（等价 --source local；VPS 不推荐）",
    "  --from <tar.gz|zip|URL|目录>  从离线预构建包安装（自动识别预构建包/源码包）",
    "  --port <端口>            AirMic 端口（默认 " + DEFAULT_PORT + "）",
    "  --host <地址>            本地模式监听地址（默认 0.0.0.0 所有网卡；仅本机使用可设 127.0.0.1）",
    "  --no-livekit             跳过 LiveKit 下载与启动（语音不可用，适合快速验证）",
    "  --livekit-version <vX>   指定 LiveKit 版本（默认最新 Release）",
    "  --setup-token [值]       设置初始化口令；不带值时自动生成随机口令",
    "  --yes                    自动确认（非交互环境）",
    "  --force                  目标已存在时强制重装（保留 data/ 与 backups/）",
    "",
    "upgrade 选项：",
    "  --check                  只检查是否有新版本（同 check-update）",
    "  --force                  强制升级/重装当前版本（默认 Release 优先，缺失时从 GitHub 源码重建）",
    "  --source auto|release|github  升级来源（默认 auto，含义同 install）",
    "  --from <tar.gz|zip|URL|目录>  从离线预构建包升级（自动识别预构建包；源码包需 --build）",
    "  --build                  开发者模式：允许源码升级构建（VPS 不推荐）",
    "",
    "uninstall 选项：",
    "  --yes                    跳过确认（非交互环境必须）",
    "  --purge                  同时删除 AirMic 数据和备份",
    "",
    "check-update 选项：",
    "  --json                   以 JSON 输出检查结果（便于脚本集成）",
    "",
    "其他：",
    "  --dir <路径>             对所有命令生效，用于指定安装目录",
    "  --repo <owner/name>      GitHub 仓库",
    "  --ref <分支|Tag|提交>     指定安装或升级的 GitHub 版本",
    "  logs --lines <N>         显示最近 N 行日志（默认 100）",
    "  --no-color               关闭彩色输出（也可设置 NO_COLOR=1）",
    "  GITHUB_TOKEN             可选环境变量，提高 GitHub API 限额",
    "",
    "示例：",
    "  node deploy/airmic-cli.mjs install --yes                       # auto：Release 优先，缺失则 GitHub 源码构建",
    "  node deploy/airmic-cli.mjs install --source github --yes       # 强制从 GitHub 源码安装（本机编译）",
    "  node deploy/airmic-cli.mjs install --mode docker --yes         # Docker：GHCR 镜像优先，缺失则本地构建",
    "  node deploy/airmic-cli.mjs install --from ./airmic-1.1.0.tar.gz --yes   # 离线预构建包",
    "  node deploy/airmic-cli.mjs install --source local --build      # 开发者：当前仓库源码构建",
    "  node deploy/airmic-cli.mjs install --mode docker --port 9811 --yes",
    "  node deploy/airmic-cli.mjs check-update --json",
    "  node deploy/airmic-cli.mjs upgrade --from ./airmic-1.1.0.tar.gz --force",
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
    log("安装来源：" + describeSource(info.source));
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

  if (command === "__validate-home") {
    if (!COMMANDS.includes(options.action) || options.action === "help") fail("未知部署动作。");
    const home = resolveHome(options);
    if (["version", "check-update"].includes(options.action) && !options.prepare_runtime) {
      log(home);
      return 0;
    }
    const state = validateHome(home, options.action);
    if (options.action === "install" && state.installed && !options.force) {
      fail("该目录已有 AirMic 部署。请使用 upgrade，或加 --force 重新安装：" + home);
    }
    if (options.prepare_runtime) {
      markHome(home);
      const runtime = path.join(home, ".runtime");
      assertPlainPath(runtime, "directory");
      mkdirp(runtime);
    }
    log(home);
    return 0;
  }

  if (command === "__log-cleanup") {
    const home = resolveHome(options);
    ensureInstalled(home);
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

  if (COMMANDS.includes(command) && command !== "help") {
    const home = resolveHome(options);
    const installedRepo = assertPlainPath(path.join(home, "version.json"), "file") ? readVersionInfo(home)?.repo : null;
    configureRepository(options, installedRepo);
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
      const message = error && error.message ? error.message : String(error);
      console.error("");
      console.error(paint("red", "[错误]") + " " + message);
      console.error(dim("  提示：执行 help 查看用法与参数；问题反馈：" + REPO_URL + "/issues"));
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
  accessUrls,
};

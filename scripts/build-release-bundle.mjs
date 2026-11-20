#!/usr/bin/env node
/**
 * AirMic 发布预构建包（仅开发/CI 使用）
 *
 * 目标：在没有 Node 构建环境的 VPS 上，直接解压运行，不需要 npm ci / npm run build。
 *
 * 用法：
 *   node scripts/build-release-bundle.mjs [--out-dir dist-release] [--skip-smoke]
 *
 * 产物：
 *   dist-release/airmic-<version>.tar.gz
 *   dist-release/airmic-<version>.tar.gz.sha256
 *
 * 包内结构：
 *   airmic-<version>/
 *     package.json
 *     server/package.json
 *     server/dist/**
 *     web/dist/**
 *     shared/package.json
 *     shared/dist/**
 *     node_modules/**（仅生产依赖，@airmic/shared 为真实目录）
 *
 * 依赖：Node.js（建议 22.13+）、npm、系统 tar。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const IS_WIN = process.platform === "win32";

const EXCLUDE_TOP = new Set([
  "node_modules",
  ".git",
  ".tools",
  "data",
  "logs",
  "backups",
  "certs",
  ".staging",
  ".dsh-acl-recovery",
  ".dsh-tests",
  "dist-release",
  "e2e",
]);
const EXCLUDE_REL = new Set([
  path.join("web", "dist"),
  path.join("server", "dist"),
  path.join("shared", "dist"),
  path.join("e2e", "artifacts"),
  path.join("e2e", "screenshots"),
]);

function log(message) {
  console.log(message);
}

function fail(message) {
  throw new Error(message);
}

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const options = { outDir: path.join(ROOT, "dist-release"), skipSmoke: false, keepWork: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skip-smoke") options.skipSmoke = true;
    else if (arg === "--keep-work") options.keepWork = true;
    else if (arg === "--out-dir") options.outDir = path.resolve(process.cwd(), argv[++i] || options.outDir);
    else if (arg === "--help" || arg === "-h") {
      console.log("用法：node scripts/build-release-bundle.mjs [--out-dir dist-release] [--skip-smoke] [--keep-work]");
      process.exit(0);
    } else fail("未知参数：" + arg);
  }
  return options;
}

function npmCommand() {
  return IS_WIN ? "npm.cmd" : "npm";
}

function run(command, args, cwd) {
  log("  > " + command + " " + args.join(" "));
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true, shell: IS_WIN });
  if (result.error) fail("命令执行失败：" + command + " " + result.error.message);
  if (result.status !== 0) fail("命令失败（退出码 " + result.status + "）：" + command + " " + args.join(" "));
}

function copyProjectTree(sourceDir, destDir) {
  fs.cpSync(sourceDir, destDir, {
    recursive: true,
    force: true,
    filter: (source) => {
      const rel = path.relative(sourceDir, source);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      if (/^\.env(?:\.|$)/.test(parts[0]) && parts[0] !== ".env.example") return false;
      if (parts.length === 1) return !EXCLUDE_TOP.has(parts[0]);
      return !EXCLUDE_REL.has(rel);
    },
  });
}

function removeDir(dir) {
  if (exists(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function pruneDevLeftovers(stageDir) {
  // Windows 上 npm prune --omit=dev 可能因 EPERM 残留部分开发依赖；
  // 用 npm ls --omit=dev 的生产依赖树做一次兜底清理（只删顶层未被生产树引用的包）。
  log("  检查并清理残留的开发依赖 ...");
  const result = spawnSync(npmCommand(), ["ls", "--omit=dev", "--all", "--parseable"], {
    cwd: stageDir,
    encoding: "utf8",
    windowsHide: true,
    shell: IS_WIN,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.warn("[警告] npm ls --omit=dev 失败，跳过残留开发依赖清理：" + (result.stderr ? String(result.stderr).slice(0, 300) : "未知错误"));
    return;
  }
  const prodPaths = new Set();
  for (const line of String(result.stdout || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const rel = path.relative(stageDir, trimmed).split(path.sep).join("/");
    if (rel.startsWith("node_modules/")) prodPaths.add(rel);
  }
  if (prodPaths.size === 0) {
    console.warn("[警告] 生产依赖树为空，跳过清理。");
    return;
  }
  const nodeModules = path.join(stageDir, "node_modules");
  if (!exists(nodeModules)) return;
  let removed = 0;
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      const scopeDir = path.join(nodeModules, entry.name);
      for (const child of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        const rel = "node_modules/" + entry.name + "/" + child.name;
        if (!prodPaths.has(rel)) {
          removeDir(path.join(scopeDir, child.name));
          removed += 1;
        }
      }
      if (fs.readdirSync(scopeDir).length === 0) removeDir(scopeDir);
    } else {
      const rel = "node_modules/" + entry.name;
      if (!prodPaths.has(rel)) {
        removeDir(path.join(nodeModules, entry.name));
        removed += 1;
      }
    }
  }
  log("  已清理残留开发依赖：" + removed + " 个顶层包");
}

/**
 * 删除打包目录里的软链/硬链/设备等非普通文件。
 * Linux 上 npm 会给依赖生成 node_modules/**.bin 软链，目标指向构建机的绝对路径
 * （安装后必然是死链）；而安装端的解压安全校验只接受普通文件与目录，
 * 带链接的包会被直接拒绝：`压缩包包含链接或特殊文件，拒绝解压`。
 */
function stripNonRegularEntries(rootDir) {
  const removed = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(rootDir, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        let target = "";
        try { target = fs.readlinkSync(full); } catch { /* 读不到链接目标也不影响删除 */ }
        fs.unlinkSync(full);
        removed.push(relative + " -> " + target);
      } else if (entry.isDirectory()) {
        walk(full);
      } else if (!entry.isFile()) {
        fs.unlinkSync(full);
        removed.push(relative + " (特殊文件)");
      }
    }
  };
  walk(rootDir);
  return removed;
}

function writeBundlePayload(stageDir, bundleDir, version) {
  const items = ["package.json", "server/package.json", "server/dist", "web/dist", "shared/package.json", "shared/dist"];
  for (const item of items) {
    const source = path.join(stageDir, item);
    if (!exists(source)) fail("构建产物缺少：" + item + "（npm run build 是否成功？）");
    const target = path.join(bundleDir, item);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
  }
  const license = path.join(stageDir, "LICENSE");
  if (exists(license)) fs.copyFileSync(license, path.join(bundleDir, "LICENSE"));

  // 生产依赖（npm prune --omit=dev 后）
  const nodeModules = path.join(stageDir, "node_modules");
  if (!exists(nodeModules)) fail("缺少 node_modules（npm prune 是否失败？）");
  fs.cpSync(nodeModules, path.join(bundleDir, "node_modules"), { recursive: true, force: true });
  removeDir(path.join(bundleDir, "node_modules", ".bin"));

  // @airmic/shared 必须为真实目录，避免 workspace 链接在跨机器/移动后失效
  const scopeDir = path.join(bundleDir, "node_modules", "@airmic");
  removeDir(scopeDir);
  fs.mkdirSync(scopeDir, { recursive: true });
  const sharedTarget = path.join(scopeDir, "shared");
  fs.cpSync(path.join(stageDir, "shared", "package.json"), path.join(sharedTarget, "package.json"), { recursive: true, force: true });
  fs.cpSync(path.join(stageDir, "shared", "dist"), path.join(sharedTarget, "dist"), { recursive: true, force: true });
  // 移除 @fastify/send 的测试夹具：包含空格/Unicode 路径，Windows 自带 bsdtar 解压会报错且运行时不需要
  const fastifySendTest = path.join(bundleDir, "node_modules", "@fastify", "send", "test");
  removeDir(fastifySendTest);
  log("  已打包 @airmic/shared（真实目录）");

  // 去掉所有链接与特殊文件（Linux 上 npm 生成的 node_modules/**.bin 软链）
  const stripped = stripNonRegularEntries(bundleDir);
  if (stripped.length) {
    log("  已移除 " + stripped.length + " 个链接/特殊文件：" + stripped.slice(0, 3).join("；") +
      (stripped.length > 3 ? " …" : ""));
  }
}

function tarCandidates() {
  const candidates = [];
  if (process.env.AIRMIC_TAR) candidates.push({ command: process.env.AIRMIC_TAR, extra: [] });
  if (IS_WIN) {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const gitTar = path.join(programFiles, "Git", "usr", "bin", "tar.exe");
    if (exists(gitTar)) candidates.push({ command: gitTar, extra: ["--force-local"] });
  }
  candidates.push({ command: "tar", extra: [] });
  return candidates;
}

function createTarGz(bundleParentDir, bundleName, tarPath) {
  if (exists(tarPath)) fs.rmSync(tarPath, { force: true });
  const tarOnlyPath = tarPath.replace(/\.gz$/, "");
  if (exists(tarOnlyPath)) fs.rmSync(tarOnlyPath, { force: true });

  // 使用未压缩 tar + Node zlib 压缩：Windows 自带 bsdtar 在压缩大目录时可能异常退出，
  // 且部分 GNU tar 缺少 gzip 子命令；此方式只依赖 tar 写归档 + Node 内置 zlib。
  let lastError = "";
  let created = false;
  let usedCandidate = null;
  for (const candidate of tarCandidates()) {
    const result = spawnSync(candidate.command, candidate.extra.concat(["-cf", tarOnlyPath, "-C", bundleParentDir, bundleName]), {
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) {
      lastError = result.error.message;
      continue;
    }
    if (result.status === 0 && exists(tarOnlyPath) && fs.statSync(tarOnlyPath).size > 0) {
      created = true;
      usedCandidate = candidate;
      break;
    }
    lastError = "退出码 " + result.status;
  }
  if (!created) fail("创建 tar 归档失败：" + lastError);

  // 发布前自检：安装端只接受普通文件与目录，带链接的包会在解压阶段被拒绝。
  // 这里提前失败，避免把坏包发到 Release 上。
  const listing = spawnSync(usedCandidate.command, usedCandidate.extra.concat(["-tvf", tarOnlyPath]), {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listing.status !== 0) fail("无法读取刚创建的 tar 归档：退出码 " + listing.status);
  const badEntries = String(listing.stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((entry) => !/^[-d]/.test(entry));
  if (badEntries.length) {
    fail("tar 归档包含链接或特殊文件（安装端会拒绝解压）：\n  " + badEntries.slice(0, 5).join("\n  "));
  }

  fs.writeFileSync(tarPath, zlib.gzipSync(fs.readFileSync(tarOnlyPath), { level: 9 }));
  fs.rmSync(tarOnlyPath, { force: true });
  if (!exists(tarPath) || fs.statSync(tarPath).size === 0) fail("tar.gz 未生成：" + tarPath);
}
function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = spawnSync(process.execPath, ["-e", "const n=require('net');const s=n.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();})"], { encoding: "utf8" });
    if (server.status !== 0) reject(new Error("无法获取空闲端口：" + (server.stderr || "")));
    else resolve(Number(String(server.stdout).trim()));
  });
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* ignore */
      }
      spawnSync("sleep", ["1"]);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

async function smokeTest(tarPath, version) {
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "airmic-bundle-smoke-"));
  const extractDir = path.join(smokeRoot, "extract");
  fs.mkdirSync(extractDir, { recursive: true });
  log("  [冒烟] 解压到临时目录：" + extractDir);
  const untar = spawnSync("tar", ["-xzf", tarPath, "-C", extractDir], { stdio: "inherit", windowsHide: true });
  if (untar.status !== 0) fail("冒烟测试：解压失败");
  const bundleDir = path.join(extractDir, "airmic-" + version);
  if (!exists(path.join(bundleDir, "server", "dist", "index.js"))) fail("冒烟测试：包结构不正确");
  const port = await getFreePort();
  const dataDir = path.join(smokeRoot, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const env = Object.assign({}, process.env, {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_PATH: path.join(dataDir, "airmic.db"),
    WEB_DIST: path.join(bundleDir, "web", "dist"),
    LOG_LEVEL: "silent",
  });
  log("  [冒烟] 启动 node server/dist/index.js（PORT=" + port + "）...");
  const child = spawn(process.execPath, [path.join(bundleDir, "server", "dist", "index.js")], {
    cwd: bundleDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  const deadline = Date.now() + 30000;
  let health = null;
  try {
    while (Date.now() < deadline) {
      if (exited) break;
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/api/health");
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch {
        /* retry */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    killTree(child.pid);
  }
  if (!health) {
    fail("冒烟测试失败：/api/health 未通过。子进程输出：\n" + (output || "(无输出)"));
  }
  log("  [冒烟] 通过：/api/health = " + JSON.stringify(health));
  removeDir(smokeRoot);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!exists(path.join(ROOT, "package.json"))) fail("未找到项目根目录：" + ROOT);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = String(pkg.version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) fail("package.json 版本号无效：" + version);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const nodeMinor = Number(process.versions.node.split(".")[1]);
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
    fail("构建需要 Node.js >= 22.13（当前 " + process.versions.node + "）。");
  }
  log("AirMic 预构建包 v" + version);
  log("项目目录：" + ROOT);

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "airmic-bundle-"));
  const stageDir = path.join(workRoot, "src");
  const bundleParent = path.join(workRoot, "bundle");
  const bundleName = "airmic-" + version;
  const bundleDir = path.join(bundleParent, bundleName);
  try {
    log("");
    log("[1/6] 复制仓库到临时构建目录（排除 node_modules/.git/data 等）...");
    fs.mkdirSync(stageDir, { recursive: true });
    copyProjectTree(ROOT, stageDir);

    log("[2/6] npm ci ...");
    run(npmCommand(), ["ci", "--no-audit", "--no-fund"], stageDir);

    log("[3/6] npm run build ...");
    run(npmCommand(), ["run", "build"], stageDir);

    log("[4/6] npm prune --omit=dev ...");
    run(npmCommand(), ["prune", "--omit=dev", "--no-audit", "--no-fund"], stageDir);

    pruneDevLeftovers(stageDir);

    log("[5/6] 组装预构建包 ...");
    fs.mkdirSync(bundleDir, { recursive: true });
    writeBundlePayload(stageDir, bundleDir, version);

    fs.mkdirSync(options.outDir, { recursive: true });
    const tarPath = path.join(options.outDir, bundleName + ".tar.gz");
    log("[6/6] 生成 tar.gz 与 SHA-256 ...");
    createTarGz(bundleParent, bundleName, tarPath);
    const sha = sha256File(tarPath);
    const shaPath = tarPath + ".sha256";
    fs.writeFileSync(shaPath, sha + "  " + path.basename(tarPath) + "\n", "utf8");
    const sizeMb = (fs.statSync(tarPath).size / 1024 / 1024).toFixed(2);
    log("");
    log("完成：");
    log("  预构建包：" + tarPath + "（" + sizeMb + " MB）");
    log("  校验文件：" + shaPath);
    log("  SHA-256 ：" + sha);

    if (!options.skipSmoke) {
      log("");
      log("开始冒烟测试（解压后启动 /api/health）...");
      await smokeTest(tarPath, version);
    } else {
      log("");
      log("已跳过冒烟测试（--skip-smoke）。");
    }
    if (options.keepWork) log("临时构建目录保留：" + workRoot);
    return 0;
  } finally {
    if (!options.keepWork) removeDir(workRoot);
  }
}

main()
  .then((code) => {
    if (typeof code === "number") process.exitCode = code;
  })
  .catch((error) => {
    console.error("");
    console.error("[错误] " + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  });

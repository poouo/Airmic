#!/usr/bin/env node
/**
 * AirMic 局域网自签 HTTPS 证书生成脚本
 *
 * 生成 certs/key.pem 与 certs/cert.pem，SAN 自动包含 localhost、127.0.0.1、::1、
 * 本机 hostname 以及所有局域网 IPv4 地址。浏览器只在 HTTPS 或 localhost 下允许使用麦克风，
 * 因此局域网访问必须使用 HTTPS（自签证书或反向代理 + 正式证书）。
 *
 * 依赖 OpenSSL 命令行（不新增 npm 依赖）：
 *   - Linux/macOS: 通常已安装（apt install openssl / brew install openssl）
 *   - Windows: Git for Windows 自带，可用 OPENSSL_BIN 指定路径
 *
 * 用法:
 *   node scripts/generate-cert.mjs
 *   node scripts/generate-cert.mjs 192.168.1.50 airmic.local
 *   node scripts/generate-cert.mjs --force --days=825
 *
 * 环境变量:
 *   CERT_DIR    输出目录（默认 ./certs）
 *   CERT_DAYS   有效期天数（默认 825）
 *   CERT_HOSTS  额外 SAN，逗号/空格分隔
 *   OPENSSL_BIN OpenSSL 可执行文件路径
 *
 * 生成的证书仅用于内网/开发；公网域名请使用 Let's Encrypt（见 docs/DEPLOY.md）。
 * certs/ 已在 .gitignore 中忽略，请勿提交私钥。
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

const DEFAULT_CERT_DIR = "./certs";
const DEFAULT_DAYS = 825;

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

function printHelp() {
  console.log([
    "AirMic 局域网自签 HTTPS 证书生成",
    "",
    "用法:",
    "  node scripts/generate-cert.mjs [额外主机名或 IP ...] [选项]",
    "",
    "选项:",
    "  --force       覆盖 certs/ 下已有证书",
    "  --dir=<路径>  输出目录（默认 CERT_DIR 或 ./certs）",
    "  --days=<天数> 证书有效期（默认 CERT_DAYS 或 825）",
    "  --help        显示本帮助",
    "",
    "示例:",
    "  node scripts/generate-cert.mjs",
    "  node scripts/generate-cert.mjs 192.168.1.50 airmic.local",
    "",
    "环境变量: CERT_DIR / CERT_DAYS / CERT_HOSTS / OPENSSL_BIN",
  ].join("\n"));
}

function parseArgs(argv) {
  const options = { help: false, force: false, dir: undefined, days: undefined, extraHosts: [] };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--force" || arg === "-f") {
      options.force = true;
      continue;
    }
    if (arg.startsWith("--dir=")) {
      options.dir = arg.slice("--dir=".length);
      continue;
    }
    if (arg.startsWith("--days=")) {
      options.days = arg.slice("--days=".length);
      continue;
    }
    if (!arg.startsWith("-")) options.extraHosts.push(arg);
  }
  return options;
}

function canRun(command) {
  try {
    const result = spawnSync(command, ["version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

function findOpenssl() {
  const explicit = (process.env.OPENSSL_BIN || "").trim();
  if (explicit) {
    if (canRun(explicit)) return explicit;
    console.warn("[cert] 警告: OPENSSL_BIN 指定的路径无法运行: " + explicit);
  }
  const candidates = ["openssl"];
  if (process.platform === "win32") {
    candidates.push("openssl.exe");
    const programFiles = process.env.ProgramFiles || "C:" + path.sep + "Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:" + path.sep + "Program Files (x86)";
    const programData = process.env.ProgramData || "C:" + path.sep + "ProgramData";
    const localAppData = process.env.LOCALAPPDATA;
    candidates.push(
      path.join(programFiles, "Git", "usr", "bin", "openssl.exe"),
      path.join(programFiles, "Git", "mingw64", "bin", "openssl.exe"),
      path.join(programFilesX86, "Git", "usr", "bin", "openssl.exe"),
      path.join(programFiles, "OpenSSL-Win64", "bin", "openssl.exe"),
      path.join(programFilesX86, "OpenSSL-Win32", "bin", "openssl.exe"),
      path.join(programData, "chocolatey", "bin", "openssl.exe"),
    );
    if (localAppData) candidates.push(path.join(localAppData, "Programs", "Git", "usr", "bin", "openssl.exe"));
  } else {
    candidates.push("/usr/bin/openssl", "/usr/local/bin/openssl", "/opt/homebrew/bin/openssl", "/opt/local/bin/openssl");
  }
  for (const candidate of candidates) {
    if (canRun(candidate)) return candidate;
  }
  return null;
}

function printNoOpenssl() {
  console.error("[cert] ✗ 未找到 OpenSSL 可执行文件（openssl）。");
  console.error("");
  console.error("可选方案：");
  console.error("  A. 安装 OpenSSL 并加入 PATH：");
  console.error("     - Windows: Git for Windows 自带 OpenSSL，可设置环境变量");
  console.error("       OPENSSL_BIN=C:/Program Files/Git/usr/bin/openssl.exe");
  console.error("     - Debian/Ubuntu: sudo apt install openssl");
  console.error("     - macOS: brew install openssl");
  console.error("  B. 使用 mkcert 生成受信任的本地证书；");
  console.error("  C. 由 Caddy（tls internal）或 Nginx + Let's Encrypt 终止 TLS；");
  console.error("  D. 公网域名请直接使用 Let's Encrypt / certbot（见 docs/DEPLOY.md）。");
}

function collectNames(extraHosts) {
  const dns = [];
  const ips = [];
  const seenDns = new Set();
  const seenIp = new Set();
  const addDns = (value) => {
    const normalized = String(value).trim().toLowerCase();
    if (!normalized || seenDns.has(normalized)) return;
    seenDns.add(normalized);
    dns.push(normalized);
  };
  const addIp = (value) => {
    const normalized = String(value).trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!normalized || seenIp.has(normalized) || net.isIP(normalized) === 0) return;
    seenIp.add(normalized);
    ips.push(normalized);
  };

  addDns("localhost");
  addIp("127.0.0.1");
  addIp("::1");

  let hostname = "";
  try {
    hostname = os.hostname().toLowerCase();
  } catch {
    hostname = "";
  }
  const safeHost = hostname.replace(/[^a-z0-9.-]/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  if (safeHost && net.isIP(safeHost) === 0) {
    addDns(safeHost);
    if (!safeHost.includes(".")) addDns(safeHost + ".local");
  }

  const extra = [];
  const fromEnv = (process.env.CERT_HOSTS || "").trim();
  if (fromEnv) extra.push(...fromEnv.split(/[,\s]+/));
  extra.push(...extraHosts);
  for (const raw of extra) {
    if (!raw) continue;
    const value = String(raw)
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .replace(/^\[/, "")
      .replace(/\]$/, "");
    if (!value) continue;
    if (net.isIP(value) !== 0) addIp(value);
    else if (/^[a-z0-9.-]+$/i.test(value)) addDns(value);
    else console.warn("[cert] 忽略无法识别的 SAN: " + raw);
  }

  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.internal || address.family !== "IPv4") continue;
      addIp(address.address);
    }
  }

  return { dns, ips };
}

function buildConfig(names) {
  const lines = [
    "[req]",
    "default_bits = 2048",
    "prompt = no",
    "default_md = sha256",
    "distinguished_name = dn",
    "x509_extensions = v3_req",
    "",
    "[dn]",
    "CN = AirMic Local",
    "O = AirMic",
    "OU = Self-signed",
    "",
    "[v3_req]",
    "basicConstraints = critical,CA:FALSE",
    "keyUsage = critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "subjectAltName = @alt_names",
    "",
    "[alt_names]",
  ];
  let dnsIndex = 1;
  for (const name of names.dns) {
    lines.push("DNS." + dnsIndex + " = " + name);
    dnsIndex += 1;
  }
  let ipIndex = 1;
  for (const ip of names.ips) {
    lines.push("IP." + ipIndex + " = " + ip);
    ipIndex += 1;
  }
  return lines.join("\n") + "\n";
}

function resolveCertDir(value) {
  const input = (value && String(value).trim()) || DEFAULT_CERT_DIR;
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(PROJECT_ROOT, input);
}

function generate(options) {
  const openssl = findOpenssl();
  if (!openssl) {
    printNoOpenssl();
    return 1;
  }

  const certDir = resolveCertDir(options.dir || process.env.CERT_DIR);
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");

  if ((fs.existsSync(keyPath) || fs.existsSync(certPath)) && !options.force) {
    console.error("[cert] ✗ 已存在证书文件：");
    console.error("       " + keyPath);
    console.error("       " + certPath);
    console.error("       如需覆盖，请加 --force，或先删除 certs/ 目录。");
    return 1;
  }

  const daysValue = Number.parseInt(String(options.days !== undefined ? options.days : process.env.CERT_DAYS || DEFAULT_DAYS), 10);
  const days = Math.min(3650, Math.max(1, Number.isFinite(daysValue) ? daysValue : DEFAULT_DAYS));
  const names = collectNames(options.extraHosts);

  fs.mkdirSync(certDir, { recursive: true });
  const configPath = path.join(certDir, ".airmic-openssl.cnf");
  fs.writeFileSync(configPath, buildConfig(names), "utf8");

  try {
    console.log("[cert] 使用 OpenSSL: " + openssl);
    console.log("[cert] 证书目录: " + certDir);
    console.log("[cert] SAN: DNS=" + names.dns.join(", ") + " | IP=" + names.ips.join(", "));
    const result = spawnSync(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-days",
        String(days),
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-config",
        configPath,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (result.status !== 0) {
      console.error("[cert] ✗ OpenSSL 执行失败（退出码 " + result.status + "）");
      if (result.error) console.error(String(result.error.message || result.error));
      if (result.stderr) console.error(result.stderr.trim());
      return 1;
    }
  } finally {
    try {
      fs.rmSync(configPath, { force: true });
    } catch {
      /* 忽略临时文件清理失败 */
    }
  }

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error("[cert] ✗ 证书文件未生成: " + certDir);
    return 1;
  }
  try {
    if (fs.statSync(certPath).size === 0 || fs.statSync(keyPath).size === 0) {
      console.error("[cert] ✗ 证书文件为空，请检查 OpenSSL 输出。");
      return 1;
    }
  } catch (error) {
    console.error("[cert] ✗ 无法读取生成的证书: " + (error && error.message ? error.message : error));
    return 1;
  }
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    /* Windows 上 chmod 语义有限，忽略 */
  }

  const info = spawnSync(openssl, ["x509", "-in", certPath, "-noout", "-subject", "-dates", "-ext", "subjectAltName"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const summary = info.status === 0 && info.stdout ? info.stdout.trim() : "";

  console.log("");
  console.log("[cert] ✓ 已生成自签证书");
  console.log("       私钥: " + keyPath);
  console.log("       证书: " + certPath);
  console.log("       有效期: " + days + " 天");
  if (summary) {
    console.log("");
    for (const line of summary.split(/\r?\n/)) console.log("       " + line);
  }
  console.log("");
  console.log("下一步：");
  console.log("  1. 在项目根目录 .env 中设置（或修改为实际路径）：");
  console.log("       SSL_KEY=./certs/key.pem");
  console.log("       SSL_CERT=./certs/cert.pem");
  console.log("  2. 重启 AirMic，然后用 https://<本机IP>:3000 访问。");
  console.log("  3. 首次访问浏览器会提示证书不受信任；需要在每台设备上导入并信任 cert.pem，");
  console.log("     Windows/macOS/iOS/Android 的具体步骤见 docs/DEPLOY.md 的 TLS 章节。");
  console.log("  4. 局域网 IP 变化后需要重新生成（node scripts/generate-cert.mjs --force）。");
  console.log("");
  console.log("提示：certs/ 已被 .gitignore 忽略，请勿提交私钥。");
  return 0;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exitCode = 0;
  } else {
    process.exitCode = generate(options);
  }
} catch (error) {
  console.error("[cert] ✗ 未预期的错误: " + (error && error.stack ? error.stack : error));
  process.exitCode = 1;
}

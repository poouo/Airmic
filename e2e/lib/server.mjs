import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 以生产构建启动 AirMic 服务，使用临时数据库与随机端口。
 * 返回 { url, dataDir, stop() }。
 */
export async function startServer(options = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(path.join(os.tmpdir(), "airmic-e2e-"));
  const port = options.port ?? 3100 + Math.floor(Math.random() * 500);
  const entry = path.join(projectRoot, "server", "dist", "index.js");
  if (!existsSync(entry)) {
    throw new Error("未找到 " + entry + "，请先执行 npm run build");
  }
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOST: "127.0.0.1",
    DATABASE_PATH: path.join(dataDir, "airmic.db"),
    JWT_SECRET: "e2e-secret-" + Date.now(),
    LOG_LEVEL: options.logLevel ?? "warn",
    WEB_DIST: path.join(projectRoot, "web", "dist"),
    ADMIN_USERNAME: "",
    ADMIN_PASSWORD: "",
    TRUST_PROXY: "false",
  };

  const child = spawn(process.execPath, [entry], {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    if (options.verbose) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
    if (options.verbose) process.stderr.write(chunk);
  });

  const url = "http://127.0.0.1:" + port;
  const deadline = Date.now() + 20_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("服务进程退出（" + child.exitCode + "）：" + output);
    try {
      const response = await fetch(url + "/api/health");
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* 尚未就绪 */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!healthy) {
    child.kill();
    throw new Error("服务启动超时：" + output);
  }

  return {
    url,
    port,
    dataDir,
    output: () => output,
    async stop() {
      child.kill();
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (!options.keepData) {
        try {
          rmSync(dataDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    },
  };
}

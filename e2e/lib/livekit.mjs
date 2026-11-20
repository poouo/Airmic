import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function resolveLivekitBinary() {
  const candidates = [
    process.env.AIRMIC_LIVEKIT_BIN,
    path.join(projectRoot, ".tools", "livekit", "livekit-server.exe"),
    path.join(projectRoot, ".tools", "livekit", "livekit-server"),
    "/usr/local/bin/livekit-server",
    "/usr/bin/livekit-server",
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

async function isHealthy(port) {
  try {
    const response = await fetch("http://127.0.0.1:" + port + "/");
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 启动（或复用）LiveKit 开发服务器。开发模式固定使用 devkey/secret。
 * 返回 null 表示本机没有 LiveKit 可执行文件。
 */
export async function startLivekit(options = {}) {
  const port = options.port ?? 7880;
  if (await isHealthy(port)) {
    console.log("  (复用已在运行的 LiveKit 开发服务器 " + port + ")");
    return {
      url: "ws://127.0.0.1:" + port,
      apiKey: "devkey",
      apiSecret: "secret",
      reused: true,
      async stop() {},
    };
  }
  const binary = resolveLivekitBinary();
  if (!binary) return null;

  const child = spawn(binary, ["--dev", "--bind", "127.0.0.1"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    if (process.env.E2E_VERBOSE === "1") process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
    if (process.env.E2E_VERBOSE === "1") process.stderr.write(chunk);
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("LiveKit 进程退出（" + child.exitCode + "）：" + output.slice(-800));
    if (await isHealthy(port)) {
      return {
        url: "ws://127.0.0.1:" + port,
        apiKey: "devkey",
        apiSecret: "secret",
        reused: false,
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
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error("LiveKit 启动超时：" + output.slice(-800));
}

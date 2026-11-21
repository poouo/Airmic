import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { SystemUpgradeResponse, UpdateCheckResponse } from "@airmic/shared";
import { ROOT_DIR } from "../config.js";
import { requireAuth } from "../plugins/auth.js";
import { getClientIp } from "../lib/http.js";
import { badRequest, conflict, internalError } from "../lib/errors.js";
import type { Services } from "../types.js";

/** 升级进行中的短期锁，防止连点触发多次升级 */
let upgradeStartedAt: number | null = null;
const UPGRADE_LOCK_MS = 10 * 60_000;

interface InstallInfo {
  home: string;
  mode: string;
  cli: string;
}

/**
 * 识别标准安装目录：服务端运行在 <home>/app/server/dist，ROOT_DIR 即 <home>/app。
 * 源码开发目录（仓库根）没有 version.json / bin/airmic-cli.mjs，会被判为不可一键升级。
 */
function detectInstall(): InstallInfo | null {
  if (path.basename(ROOT_DIR) !== "app") return null;
  const home = path.resolve(ROOT_DIR, "..");
  const cli = path.join(home, "bin", "airmic-cli.mjs");
  const versionFile = path.join(home, "version.json");
  if (!fs.existsSync(cli) || !fs.existsSync(versionFile)) return null;
  try {
    const info = JSON.parse(fs.readFileSync(versionFile, "utf8")) as { mode?: string };
    const mode = typeof info.mode === "string" ? info.mode : "local";
    return { home, mode, cli };
  } catch {
    return null;
  }
}

/** 系统信息与在线更新检查、网页端一键升级（管理员） */
export async function registerSystemRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get(
    "/api/system/update",
    { preHandler: app.requirePermission("manage_server") },
    async (request): Promise<UpdateCheckResponse> => {
      requireAuth(request);
      const force = String((request.query as { force?: string }).force ?? "") === "1";
      const info = await services.update.check(force);
      return { ...info, webUpgradeAvailable: detectInstall()?.mode === "local" };
    },
  );

  // 网页后台一键升级：以独立进程跑 `airmic upgrade --yes`，由它备份、替换、重启服务。
  // 当前进程会在升级过程中被重启，所以这里只负责“启动升级”并立刻返回。
  app.post(
    "/api/system/upgrade",
    { preHandler: app.requirePermission("manage_server") },
    async (request): Promise<SystemUpgradeResponse> => {
      const auth = requireAuth(request);
      const ip = getClientIp(request);
      if (upgradeStartedAt !== null && Date.now() - upgradeStartedAt < UPGRADE_LOCK_MS) {
        throw conflict("已有升级正在进行，请等待完成后再试", "upgrade_running");
      }
      const install = detectInstall();
      if (!install) {
        throw badRequest(
          "当前进程不在标准安装目录中（缺少 bin/airmic-cli.mjs 或 version.json），请在服务器上手动执行升级。",
          "not_installed",
        );
      }
      if (install.mode !== "local") {
        throw badRequest("Docker 部署不支持网页端升级，请在宿主机执行 airmic upgrade 重建镜像。", "docker_mode");
      }

      const logDir = path.join(install.home, "logs");
      fs.mkdirSync(logDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const logPath = path.join(logDir, "upgrade-" + stamp + ".log");

      const fd = fs.openSync(logPath, "a");
      const startedAt = Date.now();
      upgradeStartedAt = startedAt;
      const releaseLock = () => { if (upgradeStartedAt === startedAt) upgradeStartedAt = null; };
      try {
        const child = spawn(process.execPath, [install.cli, "upgrade", "--dir", install.home, "--source", "release", "--yes"], {
          cwd: install.home,
          detached: true,
          stdio: ["ignore", fd, fd],
          windowsHide: true,
          env: { ...process.env, AIRMIC_UPGRADE_SOURCE: "web-admin" },
        });
        child.once("exit", releaseLock);
        await new Promise<void>((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
      } catch (error) {
        releaseLock();
        request.log.error(error, "无法启动网页升级进程");
        throw internalError("无法启动升级，请检查安装目录及运行权限", "upgrade_start_failed");
      } finally {
        fs.closeSync(fd);
      }

      services.logs.write({
        level: "info",
        category: "system",
        message: "网页后台触发系统升级：" + logPath,
        meta: { userId: auth.user.id, logPath },
        userId: auth.user.id,
        username: auth.user.username,
        ip,
        requestId: request.id,
      });
      services.audit.log({
        actorId: auth.user.id,
        actorName: auth.user.displayName,
        action: "system_upgrade_start",
        details: "网页后台触发升级，日志：" + logPath,
        ip,
      });
      return { started: true, logPath };
    },
  );
}

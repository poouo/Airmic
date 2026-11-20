/**
 * UI 预览截图脚本（开发辅助，不参与端到端断言）
 *
 * 用法：node e2e/ui-preview.mjs
 * 前置：npm run build；本机有 Chrome/Edge。
 *
 * 输出：e2e/artifacts/ui/*.png
 * 覆盖：初始化向导、登录页（桌面/移动端）、大厅（浅色/深色/移动端）、
 *       房间（浅色/深色）、语音设置弹窗（浅色/深色）、管理后台主要页面。
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./lib/server.mjs";
import { ApiClient } from "./lib/api.mjs";
import { launchBrowser } from "./lib/browser.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(projectRoot, "e2e", "artifacts", "ui");
if (!existsSync(shotDir)) mkdirSync(shotDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const server = await startServer({});
  const browser = await launchBrowser();
  const problems = [];
  const shot = async (page, name) => {
    await sleep(450);
    const file = path.join(shotDir, name + ".png");
    await page.screenshot({ path: file });
    console.log("  截图 " + path.relative(projectRoot, file));
  };
  const recordConsole = (entry) => {
    for (const text of entry.consoleErrors || []) {
      if (/favicon|AudioContext was not allowed|autoplay|status of 401|status of 404/i.test(text)) continue;
      problems.push("[" + entry.label + "] " + text);
    }
  };

  console.log("UI 预览  " + server.url);
  const admin = await browser.newPage("admin");
  const anon = await browser.newPage("anon");
  recordConsole(admin);
  recordConsole(anon);
  let roomId = 0;

  try {
    // ---------- 初始化向导 ----------
    await admin.page.goto(server.url + "/", { waitUntil: "networkidle" });
    await admin.page.waitForURL(/\/setup$/, { timeout: 20000 });
    await admin.page.getByText("第 1 步", { exact: false }).first().waitFor({ timeout: 8000 });
    await shot(admin.page, "01-setup-step1");

    await admin.page.getByPlaceholder("周末开黑基地").fill("AirMic 语音服务器");
    await admin.page.getByPlaceholder(/欢迎来到 AirMic/).fill("打开网页就能开黑，语音经服务器 SFU 中转。");
    await admin.page.getByRole("button", { name: /下一步/ }).click();
    await admin.page.getByText("管理员用户名", { exact: false }).first().waitFor({ timeout: 5000 });
    await admin.page.getByPlaceholder("admin", { exact: true }).fill("preview_admin");
    await admin.page.getByPlaceholder("例如：服主（可选）").fill("预览管理员");
    await admin.page.getByPlaceholder("至少 6 位").fill("password123");
    await admin.page.getByPlaceholder("再次输入密码").fill("password123");
    await admin.page.getByRole("button", { name: /下一步/ }).click();
    await admin.page.getByPlaceholder("ws://localhost:7880").waitFor({ timeout: 5000 });
    await admin.page.getByPlaceholder("ws://localhost:7880").fill("ws://127.0.0.1:7880");
    await admin.page.getByPlaceholder("例如：devkey").fill("devkey");
    await admin.page.getByPlaceholder("LiveKit API Secret").fill("secret");
    const maxUsersInput = admin.page.locator('input[type="number"]').first();
    await maxUsersInput.fill("20");
    await shot(admin.page, "02-setup-voice-step");
    await admin.page.getByRole("button", { name: /下一步/ }).click();
    await admin.page.getByRole("button", { name: "完成初始化", exact: true }).waitFor({ timeout: 5000 });
    await shot(admin.page, "03-setup-confirm");
    await admin.page.getByRole("button", { name: "完成初始化", exact: true }).click();
    await admin.page.waitForURL(server.url + "/", { timeout: 20000 });
    await admin.page.waitForTimeout(1500);
    await shot(admin.page, "04-lobby-light");

    // ---------- 创建房间 ----------
    const created = await admin.page.evaluate(async () => {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "周末开黑房",
          description: "默认语音房间，欢迎加入一起开黑。",
          category: "开黑房间",
          maxUsers: 20,
        }),
      });
      return response.json();
    });
    roomId = created.room.id;
    await admin.page.reload({ waitUntil: "networkidle" });
    await admin.page.waitForTimeout(1200);
    await shot(admin.page, "05-lobby-with-room");

    // ---------- 房间页 ----------
    await admin.page.goto(server.url + "/room/" + roomId, { waitUntil: "networkidle" });
    await admin.page.waitForTimeout(2000);
    await shot(admin.page, "06-room-light");
    await admin.page.locator('button[aria-label="语音设置"]').first().click();
    await admin.page.getByRole("dialog").waitFor({ timeout: 5000 });
    await shot(admin.page, "07-settings-light");
    await admin.page.keyboard.press("Escape");
    await admin.page.waitForTimeout(300);

    // ---------- 深色 ----------
    await admin.page.getByTestId("theme-toggle").first().click();
    await admin.page.waitForTimeout(500);
    await shot(admin.page, "08-room-dark");
    await admin.page.locator('button[aria-label="语音设置"]').first().click();
    await admin.page.getByRole("dialog").waitFor({ timeout: 5000 });
    await shot(admin.page, "09-settings-dark");
    await admin.page.keyboard.press("Escape");
    await admin.page.waitForTimeout(300);

    // ---------- 管理后台（深色） ----------
    await admin.page.goto(server.url + "/admin", { waitUntil: "networkidle" });
    await admin.page.waitForTimeout(1400);
    await shot(admin.page, "10-admin-overview-dark");
    const navButton = (name) => admin.page.getByRole("button", { name, exact: true }).first();
    await navButton("用户管理").click();
    await admin.page.waitForTimeout(900);
    await shot(admin.page, "11-admin-users-dark");
    await navButton("房间管理").click();
    await admin.page.waitForTimeout(700);
    await shot(admin.page, "12-admin-rooms-dark");
    await navButton("服务器设置").click();
    await admin.page.waitForTimeout(900);
    await shot(admin.page, "13-admin-settings-dark");

    // ---------- 切回浅色，补管理后台浅色 ----------
    await admin.page.getByTestId("theme-toggle").first().click();
    await admin.page.waitForTimeout(400);
    await navButton("概览").click();
    await admin.page.waitForTimeout(700);
    await shot(admin.page, "14-admin-overview-light");
    await navButton("用户管理").click();
    await admin.page.waitForTimeout(700);
    await shot(admin.page, "15-admin-users-light");
    await navButton("服务器设置").click();
    await admin.page.waitForTimeout(900);
    await shot(admin.page, "16-admin-settings-light");
    await navButton("运行日志").click();
    await admin.page.waitForTimeout(900);
    await shot(admin.page, "17-admin-logs-light");

    // ---------- 登录页（桌面 / 移动端） ----------
    await anon.page.setViewportSize({ width: 1440, height: 900 });
    await anon.page.goto(server.url + "/login", { waitUntil: "networkidle" });
    await anon.page.waitForTimeout(800);
    await shot(anon.page, "00-login-light");

    await anon.page.setViewportSize({ width: 390, height: 844 });
    await anon.page.goto(server.url + "/login", { waitUntil: "networkidle" });
    await anon.page.waitForTimeout(800);
    await shot(anon.page, "18-login-mobile");

    // ---------- 移动端大厅 / 房间 ----------
    const guestApi = new ApiClient(server.url);
    await guestApi.guest("移动端游客");
    await anon.context.addCookies([...guestApi.cookies.entries()].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
    await anon.page.goto(server.url + "/", { waitUntil: "networkidle" });
    await anon.page.waitForTimeout(1500);
    await shot(anon.page, "19-lobby-mobile");
    await anon.page.goto(server.url + "/room/" + roomId, { waitUntil: "networkidle" });
    await anon.page.waitForTimeout(1800);
    await shot(anon.page, "20-room-mobile");
  } finally {
    if (problems.length > 0) {
      console.log("\n控制台错误（已过滤噪音）：");
      for (const problem of problems.slice(0, 10)) console.log("  - " + problem);
    } else {
      console.log("\n控制台无错误。");
    }
    await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

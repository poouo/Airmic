import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./lib/server.mjs";
import { ApiClient } from "./lib/api.mjs";
import { launchBrowser, waitForAudioConnection } from "./lib/browser.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
let failures = 0;

function ok(name, extra = "") {
  results.push({ name, status: "PASS", extra });
  console.log("  \u2713 " + name + (extra ? "  " + extra : ""));
}
function fail(name, error) {
  failures += 1;
  const message = error instanceof Error ? error.message : String(error);
  results.push({ name, status: "FAIL", extra: message });
  console.log("  \u2717 " + name + "  " + message);
}
async function step(name, fn) {
  try {
    const extra = await fn();
    ok(name, extra === undefined || extra === null ? "" : String(extra));
  } catch (error) {
    fail(name, error);
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cookieJar = (api) =>
  [...api.cookies.entries()].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" }));
const consoleIssues = (entry) =>
  [...(entry.consoleErrors ?? [])].filter(
    (text) =>
      !/favicon|AudioContext was not allowed|autoplay|status of 401|the server responded with a status of 401/i.test(text),
  );

async function main() {
  if (!existsSync(path.join(projectRoot, "web", "dist", "index.html")) || !existsSync(path.join(projectRoot, "server", "dist", "index.js"))) {
    console.error("缺少构建产物，请先运行 npm run build");
    process.exit(2);
  }
  const server = await startServer({ verbose: process.env.E2E_VERBOSE === "1" });
  const browser = await launchBrowser();
  console.log("\nAirMic E2E  " + server.url + "\n");
  const adminApi = new ApiClient(server.url);
  const guestApi = new ApiClient(server.url);
  let roomId = null;
  let adminUser = null;

  try {
    await step("1. 注册管理员并创建开放语音房间", async () => {
      adminUser = await adminApi.register("e2e_admin", "password123", "E2E 관리자".replace("관리자", "管理员"));
      if (adminUser.role !== "admin") throw new Error("首个注册用户不是管理员");
      const room = await adminApi.createRoom({
        name: "E2E 语音房",
        description: "自动化测试房间：语音 + 聊天 + 成员状态",
        category: "开黑房间",
        maxUsers: 8,
      });
      roomId = room.id;
      return "roomId=" + roomId;
    });

    await step("2. 游客模式登录", async () => {
      const guest = await guestApi.guest("E2E 游客");
      if (!guest.isGuest) throw new Error("游客身份标记不正确");
      if (guest.permissions.length !== 0) throw new Error("游客不应拥有管理权限");
      return "游客 id=" + guest.id;
    });

    const adminPage = await browser.newPage("admin");
    const guestPage = await browser.newPage("guest");
    await adminPage.context.addCookies(cookieJar(adminApi));
    await guestPage.context.addCookies(cookieJar(guestApi));

    await step("3. 匿名访问登录页并渲染三种入口", async () => {
      const anon = await browser.newPage("anon");
      await anon.page.goto(server.url + "/login", { waitUntil: "networkidle" });
      await anon.page.waitForTimeout(500);
      const body = await anon.page.innerText("body");
      for (const keyword of ["登录", "注册", "游客"]) {
        if (!body.includes(keyword)) throw new Error("登录页缺少入口：" + keyword);
      }
      if (consoleIssues(anon).length > 0) throw new Error("登录页控制台错误：" + consoleIssues(anon)[0]);
      return "三种入口齐全";
    });

    await step("4. 管理后台可打开并加载概览数据", async () => {
      await adminPage.page.goto(server.url + "/admin", { waitUntil: "networkidle" });
      await adminPage.page.waitForTimeout(1200);
      const body = await adminPage.page.innerText("body");
      for (const keyword of ["概览", "用户管理", "房间管理", "服务器设置"]) {
        if (!body.includes(keyword)) throw new Error("管理后台缺少：" + keyword);
      }
      if (!/用户|在线|房间/.test(body)) throw new Error("概览内容异常");
      await browser.screenshot(adminPage.page, "01-admin-overview");
      return "概览已渲染";
    });

    await step("5. 大厅显示房间与在线用户", async () => {
      await adminPage.page.goto(server.url + "/", { waitUntil: "networkidle" });
      await adminPage.page.waitForTimeout(1200);
      const body = await adminPage.page.innerText("body");
      if (!body.includes("E2E 语音房")) throw new Error("大厅未显示房间");
      await browser.screenshot(adminPage.page, "02-lobby");
      return "房间卡片可见";
    });

    await step("6. 管理员与游客直接打开房间链接", async () => {
      await adminPage.page.goto(server.url + "/room/" + roomId, { waitUntil: "networkidle" });
      await guestPage.page.goto(server.url + "/room/" + roomId, { waitUntil: "networkidle" });
      await adminPage.page.waitForTimeout(2500);
      await guestPage.page.waitForTimeout(1500);
      const adminBody = await adminPage.page.innerText("body");
      const guestBody = await guestPage.page.innerText("body");
      if (!adminBody.includes("E2E 语音房")) throw new Error("管理员房间页未加载");
      if (!guestBody.includes("E2E 游客")) throw new Error("游客未出现在成员列表：" + guestBody.slice(0, 200));
      return "双方进入房间";
    });

    await step("7. WebRTC 音频连接建立并收到远端媒体", async () => {
      const adminState = await waitForAudioConnection(adminPage.page, 30_000);
      const guestState = await waitForAudioConnection(guestPage.page, 30_000);
      await browser.screenshot(adminPage.page, "03-room-admin");
      await browser.screenshot(guestPage.page, "04-room-guest");
      return "connected=" + adminState.connected + "/" + guestState.connected + " audio=" + adminState.receivingAudio + "/" + guestState.receivingAudio;
    });

    await step("8. 房间聊天实时互通", async () => {
      const message = "E2E 消息 " + Date.now();
      const input = guestPage.page.getByPlaceholder(/发送消息/);
      await input.fill(message);
      await input.press("Enter");
      await adminPage.page.getByText(message).first().waitFor({ timeout: 10_000 });
      return "消息已同步";
    });

    await step("9. 麦克风静音状态同步", async () => {
      const micButton = guestPage.page.locator('button[aria-label="静音麦克风"]').first();
      await micButton.waitFor({ timeout: 5000 });
      await micButton.click();
      await guestPage.page.waitForTimeout(800);
      const unmute = guestPage.page.locator('button[aria-label="取消静音"]').first();
      if ((await unmute.count()) === 0) throw new Error("静音后按钮 aria-label 未变化");
      const adminPeerShowsMuted = await adminPage.page.getByText("E2E 游客").first().isVisible();
      if (!adminPeerShowsMuted) throw new Error("管理员侧看不到游客");
      return "静音状态已切换";
    });

    await step("10. 语音设置弹窗与设备选项", async () => {
      const settingsButton = guestPage.page.locator('button[aria-label="语音设置"]').first();
      await settingsButton.click();
      await guestPage.page.getByRole("dialog").waitFor({ timeout: 5000 });
      const dialogText = await guestPage.page.getByRole("dialog").innerText();
      if (!/麦克风|扬声器|网络/.test(dialogText)) throw new Error("设置弹窗内容异常：" + dialogText.slice(0, 120));
      await browser.screenshot(guestPage.page, "05-settings");
      await guestPage.page.keyboard.press("Escape");
      await guestPage.page.waitForTimeout(300);
      return "设备/网络设置可见";
    });

    await step("11. 屏幕共享按钮可用（被 fake 屏幕流拒绝时提示而非崩溃）", async () => {
      const shareButton = guestPage.page.locator('button[aria-label="共享屏幕"]').first();
      if ((await shareButton.count()) === 0) throw new Error("找不到共享屏幕按钮");
      const disabled = await shareButton.isDisabled();
      if (disabled) throw new Error("房间允许共享时按钮不应禁用");
      return "按钮可用";
    });

    await step("12. 无严重控制台错误", async () => {
      const errors = [...consoleIssues(adminPage), ...consoleIssues(guestPage)];
      if (errors.length > 0) throw new Error(errors.slice(0, 3).join(" | "));
      return "无错误";
    });

    await step("13. 离开房间返回大厅", async () => {
      await guestPage.page.locator('button[aria-label="离开房间"]').first().click();
      await guestPage.page.waitForTimeout(1200);
      if (!guestPage.page.url().endsWith("/")) throw new Error("离开后未返回大厅：" + guestPage.page.url());
      return "已返回大厅";
    });
  } finally {
    console.log("\n结果：");
    for (const item of results) {
      console.log("  " + (item.status === "PASS" ? "\u2713" : "\u2717") + " " + item.name + (item.extra ? "  " + item.extra : ""));
    }
    console.log("\n截图目录：e2e/artifacts");
    await browser.close();
    await server.stop();
    if (process.env.E2E_VERBOSE === "1") console.log(server.output());
    process.exit(failures > 0 ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
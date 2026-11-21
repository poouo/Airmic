import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./lib/server.mjs";
import { launchBrowser, readAudioConnection, waitForAudioConnection } from "./lib/browser.mjs";
import { startLivekit } from "./lib/livekit.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
let failures = 0;

function ok(name, extra) {
  results.push({ name, status: "PASS", extra: extra || "" });
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
const consoleIssues = (entry) =>
  [...(entry.consoleErrors || [])].filter(
    (text) => !/favicon|AudioContext was not allowed|autoplay|status of 401|status of 404/i.test(text),
  );

async function waitForMicBitrate(page, bitrate) {
  const result = await page.waitForFunction((expected) => {
    const connections = window.__airmicPeerConnections ?? [];
    for (const [index, connection] of connections.entries()) {
      if (connection.connectionState !== "connected") continue;
      const sender = connection.getSenders().find((candidate) => candidate.track?.kind === "audio");
      if (sender?.getParameters().encodings[0]?.maxBitrate === expected) {
        return { connection: index, track: sender.track.id };
      }
    }
    return null;
  }, bitrate, { timeout: 10000, polling: 100 });
  return result.jsonValue();
}

function assertSameMic(before, after) {
  if (before.connection !== after.connection || before.track !== after.track) {
    throw new Error("码率切换重建了麦克风或语音连接");
  }
}

async function main() {
  if (!existsSync(path.join(projectRoot, "web", "dist", "index.html")) || !existsSync(path.join(projectRoot, "server", "dist", "index.js"))) {
    console.error("缺少构建产物，请先运行 npm run build");
    process.exit(2);
  }

  const livekit = await startLivekit();
  const extraEnv = livekit
    ? { LIVEKIT_URL: livekit.url, LIVEKIT_API_KEY: livekit.apiKey, LIVEKIT_API_SECRET: livekit.apiSecret }
    : {};
  if (!livekit) console.warn("\n[警告] 未找到 LiveKit 可执行文件（.tools/livekit 或 AIRMIC_LIVEKIT_BIN），语音用例会失败。\n");

  const server = await startServer({ verbose: process.env.E2E_VERBOSE === "1", env: extraEnv });
  const browser = await launchBrowser();
  console.log("\nAirMic E2E  " + server.url + "\n");

  const adminPage = await browser.newPage("admin");
  const guestPage = await browser.newPage("guest");
  let roomId = 0;

  try {
    await step("1. 全新部署访问 / 自动跳转初始化向导", async () => {
      await adminPage.page.goto(server.url + "/", { waitUntil: "networkidle" });
      await adminPage.page.waitForURL(/\/setup$/, { timeout: 15000 });
      await adminPage.page.getByText("第 1 步", { exact: false }).first().waitFor({ timeout: 8000 });
      return adminPage.page.url();
    });

    await step("2. 初始化向导第 1 步：服务器信息", async () => {
      await adminPage.page.getByPlaceholder("周末开黑基地").fill("E2E 语音服务器");
      await adminPage.page.getByPlaceholder(/欢迎来到 AirMic/).fill("E2E 自动化初始化：语音经服务器 SFU 中转");
      await adminPage.page.getByRole("button", { name: /下一步/ }).click();
      await adminPage.page.getByText("管理员用户名", { exact: false }).first().waitFor({ timeout: 5000 });
      return "已填写";
    });

    await step("3. 初始化向导第 2 步：管理员账号", async () => {
      await adminPage.page.getByPlaceholder("admin", { exact: true }).fill("e2e_admin");
      await adminPage.page.getByPlaceholder("例如：服主（可选）").fill("E2E 管理员");
      await adminPage.page.getByPlaceholder("至少 6 位").fill("password123");
      await adminPage.page.getByPlaceholder("再次输入密码").fill("password123");
      await adminPage.page.getByRole("button", { name: /下一步/ }).click();
      await adminPage.page.getByPlaceholder("ws://localhost:7880").waitFor({ timeout: 5000 });
      return "已填写";
    });

    await step("4. 初始化向导第 3 步：语音中转（SFU/LiveKit）与人数", async () => {
      await adminPage.page.getByPlaceholder("ws://localhost:7880").fill(livekit ? livekit.url : "ws://127.0.0.1:7880");
      await adminPage.page.getByPlaceholder("例如：devkey").fill(livekit ? livekit.apiKey : "devkey");
      await adminPage.page.getByPlaceholder("LiveKit API Secret").fill(livekit ? livekit.apiSecret : "secret");
      const maxUsersInput = adminPage.page.locator('input[type="number"]').first();
      await maxUsersInput.fill("20");
      await adminPage.page.getByRole("button", { name: /下一步/ }).click();
      await adminPage.page.getByRole("button", { name: "完成初始化", exact: true }).waitFor({ timeout: 5000 });
      await adminPage.page.screenshot({ path: "e2e/artifacts/00-setup-confirm.png" });
      return "已填写";
    });

    await step("5. 完成初始化并自动登录进入大厅", async () => {
      await adminPage.page.getByRole("button", { name: "完成初始化", exact: true }).click();
      await adminPage.page.waitForURL(server.url + "/", { timeout: 20000 });
      await adminPage.page.waitForTimeout(1500);
      const body = await adminPage.page.innerText("body");
      if (!body.includes("E2E 管理员")) throw new Error("初始化后未登录管理员");
      if (!body.includes("E2E 语音服务器")) throw new Error("服务器名称未生效");
      const info = await adminPage.page.evaluate(async () => (await (await fetch("/api/server")).json()));
      if (info.setupRequired !== false) throw new Error("setupRequired 仍为 true");
      if (info.server.voiceAvailable !== true) throw new Error("voiceAvailable 未生效");
      if (info.server.mediaTransport !== "sfu") throw new Error("mediaTransport 不是 sfu");
      await browser.screenshot(adminPage.page, "01-lobby-after-setup");
      return "setupRequired=false, voiceAvailable=true, transport=sfu";
    });

    await step("5b. 主题：默认白天模式，可切夜间并持久化", async () => {
      const adminBody = await adminPage.page.innerText("body");
      const initialTheme = await adminPage.page.evaluate(() => document.documentElement.dataset.theme);
      if (initialTheme !== "light") throw new Error("默认主题不是白天模式：" + initialTheme);
      const toggle = adminPage.page.getByTestId("theme-toggle").first();
      await toggle.waitFor({ timeout: 5000 });
      await toggle.click();
      await adminPage.page.waitForTimeout(400);
      const darkTheme = await adminPage.page.evaluate(() => document.documentElement.dataset.theme);
      if (darkTheme !== "dark") throw new Error("切换到夜间模式失败：" + darkTheme);
      await adminPage.page.reload({ waitUntil: "networkidle" });
      await adminPage.page.waitForTimeout(600);
      const persisted = await adminPage.page.evaluate(() => document.documentElement.dataset.theme);
      if (persisted !== "dark") throw new Error("夜间模式未持久化：" + persisted);
      await adminPage.page.getByTestId("theme-toggle").first().click();
      await adminPage.page.waitForTimeout(400);
      const backLight = await adminPage.page.evaluate(() => document.documentElement.dataset.theme);
      if (backLight !== "light") throw new Error("切回白天模式失败：" + backLight);
      if (!adminBody.includes("欢迎")) throw new Error("大厅未加载");
      await browser.screenshot(adminPage.page, "01-lobby-light");
      return "默认 light，夜间切换与持久化正常";
    });

    await step("6. 初始化后 /setup 返回大厅，默认选中游客入口", async () => {
      const anon = await browser.newPage("anon");
      await anon.page.goto(server.url + "/setup", { waitUntil: "networkidle" });
      await anon.page.waitForURL(server.url + "/", { timeout: 10000 });
      const main = anon.page.getByRole("main");
      await main.getByRole("button", { name: "登录", exact: true }).waitFor();
      await main.getByRole("button", { name: "注册", exact: true }).waitFor();
      const guestOption = main.getByRole("button", { name: "游客", exact: true });
      if (await guestOption.getAttribute("aria-pressed") !== "true") throw new Error("游客入口未默认选中");
      await browser.screenshot(anon.page, "00-lobby-entry-light");
      return "大厅提供游客、登录和注册";
    });

    await step("7. 创建 SFU 大房间（管理员 API）", async () => {
      const created = await adminPage.page.evaluate(async () => {
        const response = await fetch("/api/rooms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "E2E 语音房", description: "SFU 中转语音测试", category: "开黑房间", maxUsers: 20 }),
        });
        return { status: response.status, body: await response.json() };
      });
      if (created.status !== 200) throw new Error("创建房间失败：" + JSON.stringify(created.body));
      roomId = created.body.room.id;
      if (created.body.room.maxUsers !== 20) throw new Error("房间人数上限不正确：" + created.body.room.maxUsers);
      await adminPage.page.reload({ waitUntil: "networkidle" });
      await adminPage.page.waitForTimeout(1000);
      return "roomId=" + roomId + ", maxUsers=20";
    });

    await step("7b. 后台开启多人房间麦克风码率上限", async () => {
      const page = adminPage.page;
      await page.goto(server.url + "/admin", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "服务器设置", exact: true }).first().click();
      const toggle = page.getByRole("switch", { name: "自动限制麦克风码率" });
      await toggle.waitFor({ timeout: 5000 });
      if (await toggle.getAttribute("aria-checked") !== "false") throw new Error("默认未关闭限码率");
      await toggle.click();
      await page.getByLabel("人数阈值", { exact: true }).fill("2");
      await page.getByRole("combobox", { name: "麦克风码率上限" }).click();
      await page.getByRole("option", { name: /24 kbps/ }).click();
      const saved = page.waitForResponse((response) => response.url().endsWith("/api/admin/settings") && response.request().method() === "PATCH");
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      const response = await saved;
      if (!response.ok()) throw new Error("保存码率上限失败 HTTP " + response.status());
      const { settings } = await response.json();
      const limit = settings.roomAudioBitrateLimit;
      if (!limit?.enabled || limit.userThreshold !== 2 || limit.maxBitrate !== 24000) throw new Error("保存的码率上限不正确");
      return "超过 2 人时限 24 kbps";
    });

    await step("8. 从房间直链完成游客进入并返回原房间", async () => {
      await guestPage.page.goto(server.url + "/room/" + roomId);
      await guestPage.page.waitForURL(server.url + "/");
      await guestPage.page.getByLabel("游客昵称").fill("E2E 游客");
      await guestPage.page.getByRole("button", { name: "以游客身份进入" }).click();
      await guestPage.page.waitForURL(server.url + "/room/" + roomId);
      const session = await guestPage.page.request.get(server.url + "/api/auth/me");
      const { user: guest } = await session.json();
      if (!guest.isGuest) throw new Error("游客标记不正确");
      return "游客 id=" + guest.id;
    });

    await step("9. 管理员与游客进入同一房间（服务端 SFU 中转）", async () => {
      await adminPage.page.goto(server.url + "/room/" + roomId, { waitUntil: "networkidle" });
      await guestPage.page.goto(server.url + "/room/" + roomId, { waitUntil: "networkidle" });
      await adminPage.page.waitForTimeout(2500);
      await guestPage.page.waitForTimeout(1500);
      await adminPage.page.getByRole("heading", { name: "E2E 语音房", exact: true }).waitFor();
      await guestPage.page.getByRole("heading", { name: "E2E 语音房", exact: true }).waitFor();
      await adminPage.page.getByRole("main").getByText("E2E 游客", { exact: true }).waitFor();
      await browser.screenshot(adminPage.page, "02-room-admin");
      await browser.screenshot(guestPage.page, "03-room-guest");
      return "双方已进房";
    });

    await step("10. LiveKit SFU 音频连接建立并收到远端媒体", async () => {
      const adminState = await waitForAudioConnection(adminPage.page, 40_000);
      const guestState = await waitForAudioConnection(guestPage.page, 40_000);
      await browser.screenshot(adminPage.page, "04-room-sfu-admin");
      await browser.screenshot(guestPage.page, "05-room-sfu-guest");
      return "connected=" + adminState.connected + "/" + guestState.connected + " audio=" + adminState.receivingAudio + "/" + guestState.receivingAudio;
    });

    await step("10b. 关闭收听暂停接收音频，恢复收听后继续接收", async () => {
      const listener = guestPage.page;
      const peer = adminPage.page;
      const closeListening = listener.getByRole("button", { name: "关闭收听", exact: true });
      const resumeListening = listener.getByRole("button", { name: "恢复收听", exact: true });
      const initial = await waitForAudioConnection(listener, 5000);
      await waitForAudioConnection(listener, 5000, initial.audioBytes);
      await closeListening.click();
      await resumeListening.waitFor({ timeout: 5000 });

      // LiveKit 暂停时会发送约一秒的静音帧来清空解码缓冲区。
      await sleep(1600);
      const [paused, peerBefore] = await Promise.all([readAudioConnection(listener), readAudioConnection(peer)]);
      const peerAfter = await waitForAudioConnection(peer, 5000, peerBefore.audioBytes);
      await sleep(1000);
      const stable = await readAudioConnection(listener);
      await resumeListening.click();

      if (stable.connected === 0 || stable.audioBytes !== paused.audioBytes) {
        throw new Error("关闭收听后远端音频数据未停止（" + paused.audioBytes + " → " + stable.audioBytes + " 字节）");
      }
      const resumed = await waitForAudioConnection(listener, 5000, stable.audioBytes);
      return "暂停接收 0 字节，对方仍收到本地麦克风 " + (peerAfter.audioBytes - peerBefore.audioBytes)
        + " 字节，恢复后收到 " + (resumed.audioBytes - stable.audioBytes) + " 字节";
    });

    await step("10c. 关闭收听期间自动暂停新发布的音频轨道", async () => {
      const listener = guestPage.page;
      const peer = adminPage.page;
      await listener.getByRole("button", { name: "关闭收听", exact: true }).click();
      await peer.reload({ waitUntil: "networkidle" });
      await peer.getByRole("button", { name: "静音麦克风", exact: true }).waitFor({ timeout: 10000 });
      await waitForAudioConnection(peer, 10000);
      await sleep(1600);
      const before = await readAudioConnection(listener);
      await sleep(1000);
      const after = await readAudioConnection(listener);
      await listener.getByRole("button", { name: "恢复收听", exact: true }).click();
      if (after.connected === 0 || after.audioBytes !== before.audioBytes) {
        throw new Error("新发布的音频轨道未暂停（" + before.audioBytes + " → " + after.audioBytes + " 字节）");
      }
      await waitForAudioConnection(listener, 5000, after.audioBytes);
      return "新轨道暂停接收，恢复收听后收到音频";
    });

    await step("10d. 人数跨过阈值时保留连接和麦克风轨道", async () => {
      const page = adminPage.page;
      const guest = guestPage.page;
      const original = await waitForMicBitrate(page, 32000);
      await guest.getByLabel("语音控制").getByRole("button", { name: "语音设置", exact: true }).click();
      const dialog = guest.getByRole("dialog");
      await dialog.getByRole("button", { name: "网络", exact: true }).click();
      await dialog.getByRole("button", { name: /极省流/ }).click();
      await guest.keyboard.press("Escape");
      const lowBitrateMic = await waitForMicBitrate(guest, 16000);
      const newcomer = await browser.newPage("bitrate-guest");
      try {
        await newcomer.page.goto(server.url + "/room/" + roomId);
        await newcomer.page.getByLabel("游客昵称").fill("码率测试游客");
        await newcomer.page.getByRole("button", { name: "以游客身份进入" }).click();
        await guest.getByText("房间麦克风上限 24 kbps", { exact: true }).waitFor({ timeout: 5000 });
        assertSameMic(original, await waitForMicBitrate(page, 24000));
        assertSameMic(lowBitrateMic, await waitForMicBitrate(guest, 16000));
        await waitForMicBitrate(newcomer.page, 24000);
        await waitForAudioConnection(newcomer.page, 5000);

        const updateLimit = async (enabled) => {
          const response = await page.request.patch(server.url + "/api/admin/settings", {
            data: { roomAudioBitrateLimit: { enabled, userThreshold: 2, maxBitrate: 24000 } },
          });
          if (!response.ok()) throw new Error("切换码率限制失败 HTTP " + response.status());
        };
        const restoredNotice = guest.getByText("房间码率已恢复", { exact: true });
        await updateLimit(false);
        await restoredNotice.waitFor({ timeout: 5000 });
        assertSameMic(original, await waitForMicBitrate(page, 32000));
        await updateLimit(true);
        assertSameMic(original, await waitForMicBitrate(page, 24000));

        await restoredNotice.waitFor({ state: "hidden", timeout: 5000 });
        await newcomer.page.getByLabel("语音控制").getByRole("button", { name: "离开房间", exact: true }).click();
        await restoredNotice.waitFor({ timeout: 5000 });
        assertSameMic(original, await waitForMicBitrate(page, 32000));
        assertSameMic(lowBitrateMic, await waitForMicBitrate(guest, 16000));
        const resumed = await readAudioConnection(guest);
        await waitForAudioConnection(guest, 5000, resumed.audioBytes);
        return "32 → 24 → 32 kbps，低码率保持 16 kbps，现有连接与麦克风轨道保持";
      } finally {
        await newcomer.context.close();
      }
    });

    await step("11. 房间聊天实时互通", async () => {
      const message = "E2E SFU 消息 " + Date.now();
      const input = guestPage.page.getByRole("textbox", { name: "消息内容" });
      await input.fill(message);
      await input.press("Enter");
      await adminPage.page.getByText(message).first().waitFor({ timeout: 10_000 });
      return "消息已同步";
    });

    await step("12. 麦克风静音状态同步", async () => {
      const micButton = guestPage.page.locator('button[aria-label="静音麦克风"]').first();
      await micButton.waitFor({ timeout: 5000 });
      await micButton.click();
      await guestPage.page.waitForTimeout(800);
      const unmute = guestPage.page.locator('button[aria-label="取消静音"]').first();
      if ((await unmute.count()) === 0) throw new Error("静音后按钮 aria-label 未变化");
      return "静音状态已切换";
    });

    await step("13. 语音设置弹窗（设备/网络）", async () => {
      const settingsButton = guestPage.page.locator('button[aria-label="语音设置"]').first();
      await settingsButton.click();
      const dialog = guestPage.page.getByRole("dialog");
      await dialog.waitFor({ timeout: 5000 });
      const text = await dialog.innerText();
      if (!/麦克风|扬声器|网络/.test(text)) throw new Error("设置弹窗内容异常");
      await browser.screenshot(guestPage.page, "06-voice-settings");
      await guestPage.page.keyboard.press("Escape");
      return "设置弹窗正常";
    });

    await step("14. 管理后台加载并显示语音中转状态", async () => {
      await adminPage.page.goto(server.url + "/admin", { waitUntil: "networkidle" });
      await adminPage.page.waitForTimeout(1200);
      const body = await adminPage.page.innerText("body");
      for (const keyword of ["概览", "服务器设置", "用户管理", "房间管理"]) {
        if (!body.includes(keyword)) throw new Error("管理后台缺少：" + keyword);
      }
      await browser.screenshot(adminPage.page, "07-admin-overview");
      return "管理后台正常";
    });

    await step("14b. 管理后台运行日志：分页查看与导出", async () => {
      await adminPage.page.getByRole("button", { name: "运行日志", exact: true }).first().click();
      await adminPage.page.waitForTimeout(1200);
      const body = await adminPage.page.innerText("body");
      for (const keyword of ["运行日志", "导出 CSV", "导出 JSON", "级别", "分类"]) {
        if (!body.includes(keyword)) throw new Error("日志页缺少：" + keyword);
      }
      if (!/共 \d+ 条/.test(body)) throw new Error("日志分页信息未显示");
      await browser.screenshot(adminPage.page, "08-admin-logs");
      const exportResponse = await adminPage.page.request.get(server.url + "/api/admin/logs/export?format=csv");
      if (exportResponse.status() !== 200) throw new Error("日志导出失败 HTTP " + exportResponse.status());
      const contentType = exportResponse.headers()["content-type"] ?? "";
      if (!contentType.includes("text/csv")) throw new Error("导出 Content-Type 不正确：" + contentType);
      const csv = await exportResponse.text();
      if (!csv.includes("时间")) throw new Error("导出 CSV 缺少表头");
      return "分页与 CSV 导出正常";
    });

    await step("14c. 管理后台服务器设置页", async () => {
      await adminPage.page.getByRole("button", { name: "服务器设置", exact: true }).first().click();
      await adminPage.page.waitForTimeout(1200);
      const body = await adminPage.page.innerText("body");
      for (const keyword of ["服务器设置", "保存设置"]) {
        if (!body.includes(keyword)) throw new Error("设置页缺少：" + keyword);
      }
      await browser.screenshot(adminPage.page, "09-admin-settings");
      return "设置页正常";
    });

    await step("15. 离开房间返回大厅", async () => {
      await guestPage.page.goto(server.url + "/room/" + roomId, { waitUntil: "networkidle" });
      await guestPage.page.waitForTimeout(1500);
      await guestPage.page.locator('button[aria-label="离开房间"]').first().click();
      await guestPage.page.waitForTimeout(1200);
      if (!guestPage.page.url().endsWith("/")) throw new Error("离开后未返回大厅：" + guestPage.page.url());
      return "已返回大厅";
    });

    await step("16. 无严重控制台错误", async () => {
      const errors = [...consoleIssues(adminPage), ...consoleIssues(guestPage)];
      if (errors.length > 0) throw new Error(errors.slice(0, 3).join(" | "));
      return "无错误";
    });
  } finally {
    console.log("\n结果：");
    for (const item of results) {
      console.log("  " + (item.status === "PASS" ? "\u2713" : "\u2717") + " " + item.name + (item.extra ? "  " + item.extra : ""));
    }
    console.log("\n截图目录：e2e/artifacts");
    await browser.close();
    await server.stop();
    if (livekit) await livekit.stop();
    if (process.env.E2E_VERBOSE === "1") console.log(server.output());
    process.exit(failures > 0 ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

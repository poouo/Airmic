import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const screenshotDir = path.join(projectRoot, "e2e", "artifacts");

const candidates = [
  process.env.AIRMIC_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function resolveExecutable() {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 启动带“虚拟麦克风”的无头浏览器。
 * 注入 RTCPeerConnection 记录器，便于断言语音连接是否建立。
 */
export async function launchBrowser(options = {}) {
  const executablePath = resolveExecutable();
  if (!executablePath) throw new Error("找不到可用的 Chrome/Edge，可设置 AIRMIC_CHROME_PATH");
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath,
    headless: options.headless !== false,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--lang=zh-CN",
    ],
  });

  const contexts = [];
  async function newPage(label) {
    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message));
    await page.addInitScript(() => {
      const original = window.RTCPeerConnection;
      if (!original) return;
      const record = [];
      const Wrapped = function (...args) {
        const pc = new original(...args);
        record.push(pc);
        return pc;
      };
      Wrapped.prototype = original.prototype;
      Object.setPrototypeOf(Wrapped, original);
      window.RTCPeerConnection = Wrapped;
      window.__airmicPeerConnections = record;
    });
    const entry = { label, context, page, consoleErrors };
    contexts.push(entry);
    return entry;
  }

  async function screenshot(page, name) {
    const file = path.join(screenshotDir, name + ".png");
    await page.screenshot({ path: file, fullPage: false });
    return file;
  }

  return {
    browser,
    newPage,
    screenshot,
    async close() {
      for (const item of contexts) {
        try {
          await item.context.close();
        } catch {
          /* ignore */
        }
      }
      await browser.close();
    },
  };
}

export async function readAudioConnection(page) {
  return page.evaluate(async () => {
    const pcs = window.__airmicPeerConnections || [];
    const result = { total: pcs.length, connected: 0, receivingAudio: 0, audioBytes: 0, states: [] };
    for (const pc of pcs) {
      result.states.push(pc.connectionState);
      if (pc.connectionState !== "connected") continue;
      result.connected += 1;
      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "audio" && report.bytesReceived > 0) {
            result.receivingAudio += 1;
            result.audioBytes += report.bytesReceived;
          }
        });
      } catch {
        /* ignore */
      }
    }
    return result;
  });
}

/** 等待已连接的 RTCPeerConnection 收到音频，或超过已接收的字节数 */
export async function waitForAudioConnection(page, timeoutMs = 25_000, previousBytes = 0) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readAudioConnection(page);
    if (last.connected > 0 && last.audioBytes > previousBytes) return last;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("等待语音连接超时，状态：" + JSON.stringify(last));
}

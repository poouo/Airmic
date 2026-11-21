import assert from "node:assert/strict";
import { ApiClient } from "./lib/api.mjs";
import path from "node:path";
import { launchBrowser, screenshotDir } from "./lib/browser.mjs";
import { startServer } from "./lib/server.mjs";

const server = await startServer();
let browser;

try {
  const admin = new ApiClient(server.url);
  const player = new ApiClient(server.url);
  await admin.register("mobile_admin");
  await player.register("mobile_player");
  const protectedRoom = await admin.createRoom({ name: "加密测试房", password: "mobile-1234" });
  const { areas } = await admin.get("/api/room-directory");
  const rootArea = areas.find((area) => area.parentId === null);
  assert.ok(rootArea);
  await admin.post("/api/room-directory/areas", { parentId: rootArea.id, name: "下拉测试" });

  browser = await launchBrowser();
  const context = await browser.browser.newContext({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 360, height: 320 },
    locale: "zh-CN",
  });
  await context.addCookies([...admin.cookies].map(([name, value]) => ({ name, value, url: server.url })));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Simulate browsers that shrink and pan the visual viewport while keeping the layout viewport unchanged.
  await page.addInitScript(() => {
    const original = window.visualViewport;
    const visual = new EventTarget();
    let height;
    let offsetTop = 0;
    Object.defineProperties(visual, {
      height: { get: () => height ?? original.height },
      offsetTop: { get: () => offsetTop },
      scale: { get: () => original.scale },
    });
    original.addEventListener("resize", () => visual.dispatchEvent(new Event("resize")));
    Object.defineProperty(window, "visualViewport", { value: visual });
    window.simulateKeyboard = (nextHeight, top = 0) => {
      height = nextHeight;
      offsetTop = top;
      visual.dispatchEvent(new Event("resize"));
    };
  });

  const button = (scope, name) => scope.getByRole("button", { name, exact: true });
  const choose = async (scope, label, option) => {
    await scope.getByRole("combobox", { name: label, exact: true }).tap();
    await page.getByRole("option", { name: option, exact: true }).tap();
  };
  const assertTappable = async (locator) => {
    await locator.waitFor();
    const check = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const { offsetTop, height } = window.visualViewport;
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { within: rect.top >= offsetTop && rect.bottom <= offsetTop + height + 1, hit: element.contains(hit) };
    });
    assert.deepEqual(check, { within: true, hit: true });
  };

  await page.goto(server.url + "/rooms/manage");
  await page.evaluate(() => document.documentElement.style.setProperty("--safe-bottom", "24px"));
  const group = page.getByRole("region", { name: "默认频道 / 开黑房间" });
  await button(group, "创建房间").tap();
  const createDialog = page.getByRole("dialog", { name: "创建房间" });
  await createDialog.getByLabel(/房间名称/).fill("短屏测试房");
  await page.evaluate(() => window.simulateKeyboard(260, 14));
  await createDialog.getByRole("combobox", { name: "所属子区" }).tap();
  const lastArea = page.getByRole("option", { name: "默认频道 / 下拉测试" });
  await lastArea.scrollIntoViewIfNeeded();
  await assertTappable(lastArea);
  await lastArea.tap();
  await assertTappable(button(createDialog, "创建房间"));
  await button(createDialog, "创建房间").tap();
  await createDialog.waitFor({ state: "hidden" });
  await page.evaluate(() => window.simulateKeyboard(undefined));
  await page.getByRole("region", { name: "默认频道 / 下拉测试" }).getByText("短屏测试房", { exact: true }).waitFor();
  console.log("通过：短屏、键盘和底部安全区内可选择子区并创建房间");

  const { rooms } = await admin.get("/api/rooms");
  const openRoom = rooms.find((room) => room.name === "短屏测试房");
  assert.ok(openRoom);
  await page.goto(server.url + "/room/" + openRoom.id);
  await assertTappable(button(page, "离开房间"));
  await button(page, "打开侧栏").tap();
  await page.getByRole("dialog", { name: "房间导航" }).getByRole("button", { name: /加密测试房/ }).tap();
  const passwordDialog = page.getByRole("dialog", { name: "输入房间密码" });
  await passwordDialog.getByLabel("房间密码").fill("mobile-1234");
  await assertTappable(button(passwordDialog, "进入房间"));
  await button(passwordDialog, "进入房间").tap();
  await page.waitForURL("**/room/" + protectedRoom.id);
  await page.getByRole("heading", { name: "加密测试房", exact: true }).waitFor();
  await button(page, "打开侧栏").tap();
  const drawer = page.getByRole("dialog", { name: "房间导航" });
  await button(drawer, "分区与房间管理").tap();
  const directory = page.getByRole("dialog", { name: "分区与房间管理" });
  await directory.getByRole("region", { name: "默认频道 / 开黑房间" }).waitFor();
  assert.equal(page.url(), server.url + "/room/" + protectedRoom.id);
  await button(directory, "关闭").tap();
  await button(drawer, "关闭侧栏").tap();
  console.log("通过：从房间侧栏切换到加密房");

  await button(page, "聊天").tap();
  await page.getByRole("textbox", { name: "消息内容" }).fill("短屏发送成功");
  await page.evaluate(() => window.simulateKeyboard(220, 10));
  await assertTappable(button(page, "发送消息"));
  await button(page, "发送消息").tap();
  await page.getByText("短屏发送成功", { exact: true }).waitFor();
  const historyPath = "/api/rooms/" + protectedRoom.id + "/messages";
  assert.equal((await admin.get(historyPath)).messages[0].content, "短屏发送成功");
  await assert.rejects(() => player.get(historyPath), /请先加入该房间/);
  await page.evaluate(() => window.simulateKeyboard(undefined));
  await button(page, "收起聊天").tap();

  await button(page.locator('footer[aria-label="语音控制"]'), "语音设置").tap();
  const settings = page.getByRole("dialog", { name: "语音设置" });
  await button(settings, "其他").tap();
  await button(settings, "重置本机设置").tap();
  const reset = page.getByRole("dialog", { name: "重置本机设置？" });
  await assertTappable(button(reset, "取消"));
  await page.keyboard.press("Escape");
  await reset.waitFor({ state: "hidden" });
  await assertTappable(button(settings, "完成"));
  await button(settings, "完成").tap();
  console.log("通过：键盘上方可发送消息，嵌套确认和设置按钮可点");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(screenshotDir, "airmic-mobile-room.png") });

  await page.setViewportSize({ width: 667, height: 330 });
  await assertTappable(button(page, "离开房间"));
  await button(page, "离开房间").tap();
  await page.waitForURL(server.url + "/");
  await page.setViewportSize({ width: 360, height: 420 });
  await page.goto(server.url + "/admin");
  await choose(page, "管理模块", "用户管理");
  const manageUser = button(page.getByRole("main"), "管理").first();
  await manageUser.waitFor();
  await manageUser.evaluate((element) => {
    const scroller = element.closest(".app-scroll.app-canvas");
    scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 130;
  });
  await assertTappable(manageUser);
  assert.equal(await manageUser.evaluate((element) => element.closest("table").parentElement.scrollLeft), 0);
  await manageUser.tap();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await choose(page, "管理模块", "服务器设置");
  const save = button(page, "保存设置");
  await assertTappable(save);
  await save.tap();
  await page.getByText(/服务器设置已保存/).waitFor();
  assert.deepEqual(errors, []);
  console.log("通过：横屏可离房，后台表格操作和保存可点");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(server.url);
  await page.getByRole("heading", { name: "语音房间" }).waitFor();
  await page.getByRole("heading", { name: "短屏测试房" }).waitFor();
  await page.screenshot({ path: path.join(screenshotDir, "airmic-mobile-lobby.png") });

  await context.clearCookies();
  await page.goto(server.url + "/login");
  await button(page, "游客").tap();
  const guestName = page.getByRole("textbox", { name: "游客昵称" });
  await guestName.fill("手机游客");
  await page.route("**/api/auth/guest", (route) => route.fulfill({ status: 429, json: { error: { message: "请稍后再试" } } }), { times: 1 });
  await button(page, "以游客身份进入").tap();
  await page.getByText("请稍后再试", { exact: true }).waitFor();
  assert.equal(await guestName.inputValue(), "手机游客");
  await button(page, "以游客身份进入").tap();
  await page.waitForURL(server.url + "/");
  const session = await page.request.get(server.url + "/api/auth/me");
  assert.equal((await session.json()).user.displayName, "手机游客");
  console.log("通过：手动游客登录可重试并跳转大厅");
  await context.close();
} finally {
  await browser?.close();
  await server.stop();
}

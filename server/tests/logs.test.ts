import test from "node:test";
import assert from "node:assert/strict";
import type { AdminLogListResponse } from "@airmic/shared";
import { createTestContext } from "./helpers.js";

test("运行日志：请求日志入库、分页与筛选", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("log_admin");
    await admin.get("/api/server");
    await admin.get("/api/rooms");
    ctx.services.logs.flushNow();

    const page = await admin.get<AdminLogListResponse>("/api/admin/logs?page=1&pageSize=2");
    assert.equal(page.status, 200);
    assert.ok(page.body.total >= 2);
    assert.ok(page.body.items.length <= 2);
    assert.equal(page.body.page, 1);
    assert.equal(page.body.pageSize, 2);
    assert.equal(page.body.retentionDays, 3);
    assert.ok((page.body.levelCounts.info ?? 0) >= 1);

    const searched = await admin.get<AdminLogListResponse>("/api/admin/logs?search=" + encodeURIComponent("api/server"));
    assert.equal(searched.status, 200);
    assert.ok(searched.body.items.some((item) => item.message.includes("/api/server")));

    const system = await admin.get<AdminLogListResponse>("/api/admin/logs?category=system");
    assert.ok(system.body.items.some((item) => item.message.includes("服务已启动")));

    ctx.services.logs.write({ level: "error", category: "error", message: "测试错误：语音连接失败", meta: { roomId: 7 } });
    ctx.services.logs.flushNow();
    const errors = await admin.get<AdminLogListResponse>("/api/admin/logs?level=error&search=" + encodeURIComponent("语音连接失败"));
    assert.equal(errors.body.items.length, 1);
    assert.equal(errors.body.items[0]?.level, "error");
    assert.ok(errors.body.items[0]?.meta?.includes("roomId"));
  } finally {
    await ctx.close();
  }
});

test("运行日志：分页翻页内容不同", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("log_admin2");
    for (let index = 0; index < 12; index += 1) {
      ctx.services.logs.write({ level: "info", category: "system", message: "分页测试日志 " + index });
    }
    ctx.services.logs.flushNow();
    const first = await admin.get<AdminLogListResponse>("/api/admin/logs?page=1&pageSize=5&search=" + encodeURIComponent("分页测试日志"));
    const second = await admin.get<AdminLogListResponse>("/api/admin/logs?page=2&pageSize=5&search=" + encodeURIComponent("分页测试日志"));
    assert.equal(first.body.total, 12);
    assert.equal(first.body.items.length, 5);
    assert.equal(second.body.items.length, 5);
    const firstIds = new Set(first.body.items.map((item) => item.id));
    assert.ok(second.body.items.every((item) => !firstIds.has(item.id)));
  } finally {
    await ctx.close();
  }
});

test("运行日志：CSV / JSON 导出", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("log_admin3");
    ctx.services.logs.write({ level: "warn", category: "ws", message: "导出测试-逗号,引号", meta: { demo: true } });
    ctx.services.logs.flushNow();

    const csv = await admin.request<string>("GET", "/api/admin/logs/export?format=csv&search=" + encodeURIComponent("导出测试"));
    assert.equal(csv.status, 200);
    assert.equal(typeof csv.body, "string");
    assert.ok((csv.body as string).includes("时间"));
    assert.ok((csv.body as string).includes("导出测试"));

    const json = await admin.get<Array<{ message: string; level: string }>>("/api/admin/logs/export?format=json&search=" + encodeURIComponent("导出测试"));
    assert.equal(json.status, 200);
    assert.ok(Array.isArray(json.body));
    assert.equal(json.body[0]?.message, "导出测试-逗号,引号");
    assert.equal(json.body[0]?.level, "warn");
  } finally {
    await ctx.close();
  }
});

test("运行日志：超过保留期自动清理", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("log_admin4");
    const oldTime = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    ctx.services.db.run(
      "INSERT INTO app_logs (created_at, level, category, message) VALUES (?, 'info', 'system', '过期日志')",
      oldTime,
    );
    ctx.services.logs.write({ level: "info", category: "system", message: "保留中的日志" });
    ctx.services.logs.flushNow();
    const removed = ctx.services.logs.cleanup();
    assert.ok(removed >= 1);
    const old = await admin.get<AdminLogListResponse>("/api/admin/logs?search=" + encodeURIComponent("过期日志"));
    assert.equal(old.body.total, 0);
    const kept = await admin.get<AdminLogListResponse>("/api/admin/logs?search=" + encodeURIComponent("保留中的日志"));
    assert.equal(kept.body.total, 1);
  } finally {
    await ctx.close();
  }
});

test("运行日志：权限校验", async () => {
  const ctx = await createTestContext();
  try {
    await ctx.registerUser("log_admin5");
    const user = await ctx.registerUser("log_user");
    assert.equal((await user.get("/api/admin/logs")).status, 403);
    assert.equal((await user.get("/api/admin/logs/export?format=csv")).status, 403);
    assert.equal((await ctx.newClient().get("/api/admin/logs")).status, 401);
  } finally {
    await ctx.close();
  }
});
import test from "node:test";
import assert from "node:assert/strict";
import { createTestContext } from "./helpers.js";

test("网页一键升级：普通用户无权限；管理员在非安装目录会被拒绝", async () => {
  const ctx = await createTestContext();
  try {
    // 首个注册用户是管理员
    const admin = await ctx.registerUser("upgrade_admin");
    const normal = await ctx.registerUser("upgrade_user");

    const denied = await normal.post("/api/system/upgrade");
    assert.equal(denied.status, 403);

    ctx.services.update.setFetcher(async () => new Response(JSON.stringify({ tag_name: "v99.0.0" })));
    const check = await admin.get<{ updateAvailable: boolean; webUpgradeAvailable: boolean }>("/api/system/update");
    assert.equal(check.body.updateAvailable, true);
    assert.equal(check.body.webUpgradeAvailable, false);

    const result = await admin.post<{ error?: { message?: string } }>("/api/system/upgrade");
    // 测试进程跑在源码仓库里，不是 <home>/app 安装目录，因此应被拒绝而不是真的去升级
    assert.ok([400, 409].includes(result.status), JSON.stringify(result.body));
    if (result.status === 400) {
      assert.match(String(result.body.error?.message ?? ""), /标准安装目录/);
    }
  } finally {
    await ctx.close();
  }
});

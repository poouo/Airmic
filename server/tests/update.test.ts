import test from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION, type UpdateCheckResponse } from "@airmic/shared";
import { createTestContext } from "./helpers.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function releasePayload(tag: string) {
  return {
    tag_name: tag,
    name: "AirMic " + tag,
    html_url: "https://github.com/poouo/Airmic/releases/tag/" + tag,
    published_at: "2026-11-20T00:00:00Z",
  };
}

function installFetcher(ctx: Awaited<ReturnType<typeof createTestContext>>, handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  ctx.services.update.setFetcher((async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch);
  return calls;
}

test("更新检查：GitHub Release 有新版本", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("upd_admin");
    installFetcher(ctx, (url) => {
      if (url.includes("/releases/latest")) return jsonResponse(releasePayload("v9.9.9"));
      if (url.includes("/tags")) return jsonResponse([]);
      return jsonResponse({ default_branch: "main" });
    });
    const result = await admin.get<UpdateCheckResponse>("/api/system/update");
    assert.equal(result.status, 200);
    assert.equal(result.body.currentVersion, APP_VERSION);
    assert.equal(result.body.latestVersion, "9.9.9");
    assert.equal(result.body.latestRef, "v9.9.9");
    assert.equal(result.body.latestSource, "release");
    assert.equal(result.body.updateAvailable, true);
    assert.equal(result.body.repo, "poouo/Airmic");
    assert.ok(result.body.releaseUrl?.includes("releases/tag/v9.9.9"));
    assert.equal(result.body.error, null);
  } finally {
    await ctx.close();
  }
});

test("更新检查：版本相同/更旧时无需更新", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("upd_admin2");
    installFetcher(ctx, (url) => {
      if (url.includes("/releases/latest")) return jsonResponse(releasePayload("v1.1.0"));
      return jsonResponse([]);
    });
    const result = await admin.get<UpdateCheckResponse>("/api/system/update");
    assert.equal(result.body.updateAvailable, false);
    assert.equal(result.body.latestVersion, "1.1.0");
  } finally {
    await ctx.close();
  }
});

test("更新检查：无 Release 时回退到最高 Tag", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("upd_admin3");
    installFetcher(ctx, (url) => {
      if (url.includes("/releases/latest")) return jsonResponse({ message: "Not Found" }, 404);
      if (url.includes("/tags")) return jsonResponse([{ name: "v1.2.0" }, { name: "v1.3.5" }, { name: "v1.3.4" }]);
      return jsonResponse({ default_branch: "main" });
    });
    const result = await admin.get<UpdateCheckResponse>("/api/system/update");
    assert.equal(result.body.latestSource, "tag");
    assert.equal(result.body.latestVersion, "1.3.5");
    assert.equal(result.body.updateAvailable, true);
  } finally {
    await ctx.close();
  }
});

test("更新检查：仓库没有 Tag/Release 时使用默认分支", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("upd_admin4");
    installFetcher(ctx, (url) => {
      if (url.includes("/releases/latest")) return jsonResponse({ message: "Not Found" }, 404);
      if (url.includes("/tags")) return jsonResponse([]);
      return jsonResponse({ default_branch: "main", pushed_at: "2026-11-20T00:00:00Z" });
    });
    const result = await admin.get<UpdateCheckResponse>("/api/system/update");
    assert.equal(result.body.latestSource, "branch");
    assert.equal(result.body.latestVersion, null);
    assert.equal(result.body.latestRef, "main");
    assert.equal(result.body.updateAvailable, true);
    assert.ok(result.body.error?.includes("尚未发布版本"));
  } finally {
    await ctx.close();
  }
});

test("更新检查：GitHub 不可达时返回错误信息但不影响服务", async () => {
  const ctx = await createTestContext();
  try {
    const admin = await ctx.registerUser("upd_admin5");
    installFetcher(ctx, () => {
      throw new Error("network down");
    });
    const result = await admin.get<UpdateCheckResponse>("/api/system/update");
    assert.equal(result.status, 200);
    assert.equal(result.body.updateAvailable, false);
    assert.equal(result.body.latestVersion, null);
    assert.ok(result.body.error);
  } finally {
    await ctx.close();
  }
});

test("更新检查：权限与未登录", async () => {
  const ctx = await createTestContext();
  try {
    await ctx.registerUser("upd_admin6");
    const user = await ctx.registerUser("upd_user");
    const denied = await user.get("/api/system/update");
    assert.equal(denied.status, 403);
    const anonymous = await ctx.newClient().get("/api/system/update");
    assert.equal(anonymous.status, 401);
  } finally {
    await ctx.close();
  }
});
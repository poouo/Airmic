import test from "node:test";
import assert from "node:assert/strict";
import type { AuthResponse } from "@airmic/shared";
import { createTestContext } from "./helpers.js";

test("游客原地升级为正式账号：保留 user id，并可用新账号登录", async () => {
  const ctx = await createTestContext();
  try {
    const guest = ctx.newClient();
    const created = await guest.guest("玩家1234");
    assert.equal(created.status, 200);
    const before = (created.body as AuthResponse).user;
    assert.equal(before.isGuest, true);

    const upgraded = await guest.post<AuthResponse>("/api/auth/upgrade", {
      username: "player_one",
      password: "password123",
      displayName: "玩家一号",
    });
    assert.equal(upgraded.status, 200);
    assert.equal(upgraded.body.user.id, before.id, "升级后必须保留同一个 user id");
    assert.equal(upgraded.body.user.isGuest, false);
    assert.equal(upgraded.body.user.username, "player_one");
    assert.equal(upgraded.body.user.displayName, "玩家一号");

    // 原会话继续有效（不需要重新登录、不丢房间身份）
    const me = await guest.get<AuthResponse>("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, before.id);
    assert.equal(me.body.user.isGuest, false);

    // 新账号可以在别的客户端登录
    const fresh = ctx.newClient();
    const login = await fresh.post<AuthResponse>("/api/auth/login", {
      username: "player_one",
      password: "password123",
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.id, before.id);

    // 已升级的账号不能再次升级
    const again = await guest.post("/api/auth/upgrade", { username: "player_two", password: "password123" });
    assert.equal(again.status, 409);
  } finally {
    await ctx.close();
  }
});

test("升级时校验用户名占用与格式", async () => {
  const ctx = await createTestContext();
  try {
    await ctx.registerUser("taken_name");
    const guest = ctx.newClient();
    assert.equal((await guest.guest("玩家5678")).status, 200);

    const conflict = await guest.post("/api/auth/upgrade", { username: "taken_name", password: "password123" });
    assert.equal(conflict.status, 409);

    const tooShort = await guest.post("/api/auth/upgrade", { username: "ab", password: "password123" });
    assert.equal(tooShort.status, 400);

    const weakPassword = await guest.post("/api/auth/upgrade", { username: "ok_name", password: "123" });
    assert.equal(weakPassword.status, 400);

    const invalidChars = await guest.post("/api/auth/upgrade", { username: "bad name", password: "password123" });
    assert.equal(invalidChars.status, 400);
  } finally {
    await ctx.close();
  }
});

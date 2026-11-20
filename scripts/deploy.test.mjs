import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../deploy/airmic-cli.mjs", import.meta.url));

function run(home, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args, "--dir=" + home], { encoding: "utf8" });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

function fixture(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "airmic-deploy-test-"));
  assert.equal(path.dirname(root), parent);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function legacyInstall(home) {
  fs.mkdirSync(path.join(home, "bin"), { recursive: true });
  fs.mkdirSync(path.join(home, "app"));
  fs.copyFileSync(cli, path.join(home, "bin", "airmic-cli.mjs"));
  fs.writeFileSync(path.join(home, "version.json"), JSON.stringify({ repo: "poouo/Airmic", mode: "local", version: "1.1.0" }));
}

test("force install and purge reject an unrelated directory with app and version files", (t) => {
  const home = fixture(t);
  fs.mkdirSync(path.join(home, "app"));
  fs.mkdirSync(path.join(home, "bin"));
  fs.writeFileSync(path.join(home, "app", "keep.txt"), "personal file");
  fs.writeFileSync(path.join(home, "version.json"), '{"version":"1.1.0","mode":"local"}');
  fs.writeFileSync(path.join(home, "bin", "airmic-cli.mjs"), "throw new Error('This file must not run')");
  for (const command of [
    ["install", "--force", "--from", path.join(home, "missing.tgz")],
    ["uninstall", "--purge", "--yes"],
  ]) {
    const result = run(home, ...command);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /无法核验为已有部署/);
    assert.equal(fs.readFileSync(path.join(home, "app", "keep.txt"), "utf8"), "personal file");
  }
});

test("uninstall rejects disk roots and the current user profile", () => {
  for (const home of [os.homedir(), path.parse(os.homedir()).root, path.join(os.homedir(), "Desktop")]) {
    const result = run(home, "uninstall", "--purge", "--yes");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /受保护的路径|链接/);
  }
});

test("link and junction targets stay outside install and purge operations", (t) => {
  const root = fixture(t);
  const home = path.join(root, "owned");
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const sentinel = path.join(outside, "keep.txt");
  fs.writeFileSync(sentinel, "outside data");
  legacyInstall(home);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  const alias = path.join(root, "alias");
  fs.symlinkSync(home, alias, linkType);
  fs.symlinkSync(outside, path.join(home, "data"), linkType);
  for (const target of [alias, home]) {
    const result = run(target, "uninstall", "--purge", "--yes");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /拒绝访问链接/);
  }
  assert.equal(fs.readFileSync(sentinel, "utf8"), "outside data");
});

test("legacy uninstall requires confirmation and a later purge preserves unrelated files", (t) => {
  const home = fixture(t);
  legacyInstall(home);
  const data = path.join(home, "data");
  const backups = path.join(home, "backups");
  fs.mkdirSync(data);
  fs.mkdirSync(backups);
  const keep = path.join(home, "personal.txt");
  fs.writeFileSync(keep, "personal file");

  const unconfirmed = run(home, "uninstall", "--purge");
  assert.equal(unconfirmed.status, 1, unconfirmed.output);
  assert.match(unconfirmed.output, /--yes/);
  assert.ok(fs.existsSync(path.join(home, "app")));

  const uninstall = run(home, "uninstall", "--yes");
  assert.equal(uninstall.status, 0, uninstall.output);
  assert.ok(!fs.existsSync(path.join(home, "app")));
  assert.ok(fs.existsSync(data));
  assert.ok(fs.existsSync(backups));

  const purge = run(home, "uninstall", "--purge", "--yes");
  assert.equal(purge.status, 0, purge.output);
  assert.deepEqual(fs.readdirSync(home), ["personal.txt"]);
  assert.equal(fs.readFileSync(keep, "utf8"), "personal file");
});

test("a failed forced reinstall leaves the current application and version in place", (t) => {
  const home = fixture(t);
  legacyInstall(home);
  const previous = path.join(home, "app", "old-version.txt");
  fs.writeFileSync(previous, "old application");
  const result = run(home, "install", "--force", "--from", path.join(home, "missing.tgz"));
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /指定的路径不存在/);
  assert.equal(fs.readFileSync(previous, "utf8"), "old application");
  assert.ok(fs.existsSync(path.join(home, "version.json")));
  assert.deepEqual(fs.readdirSync(path.join(home, ".staging")), []);
});

test("generated env listens on all interfaces by default so a fresh deploy is reachable", async () => {
  const { generateAirMicEnv } = await import("../deploy/airmic-cli.mjs");
  const base = { mode: "local", home: "/opt/airmic", port: 9811, keys: { apiKey: "k", apiSecret: "s" } };

  assert.match(generateAirMicEnv(base), /^HOST=0\.0\.0\.0$/m);
  assert.match(generateAirMicEnv({ ...base, host: "127.0.0.1" }), /^HOST=127\.0\.0\.1$/m);
});

test("access urls enumerate reachable addresses when bound to all interfaces", async () => {
  const { accessUrls } = await import("../deploy/airmic-cli.mjs");

  const all = accessUrls("0.0.0.0", 9811);
  assert.ok(all.length >= 1);
  assert.ok(all.every((url) => /^http:\/\/[^/]+:9811$/.test(url)), all.join(","));

  assert.deepEqual(accessUrls("127.0.0.1", 9811), ["http://127.0.0.1:9811"]);
  assert.deepEqual(accessUrls("10.0.0.5", 9811), ["http://10.0.0.5:9811"]);
});

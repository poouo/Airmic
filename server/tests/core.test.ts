import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOpusToSdp,
  audioConstraints,
  buildOpusFmtp,
  DEFAULT_AUDIO_SETTINGS,
  deriveAudioPreset,
  diffAudioSettings,
  mergeAudioSettings,
  normalizeAudioSettings,
  presetSettings,
} from "@airmic/shared";
import { hashPassword, hashRoomPassword, verifyPassword, verifyRoomPassword } from "../src/lib/password.js";
import { signJwt, verifyJwt } from "../src/lib/jwt.js";
import { permissionsForRole, ROLE_PERMISSIONS } from "@airmic/shared";

test("密码哈希与校验", () => {
  const hash = hashPassword("correct horse battery staple");
  assert.match(hash, /^scrypt:16384:8:1:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(verifyPassword("correct horse battery staple", hash), true);
  assert.equal(verifyPassword("wrong password", hash), false);
  assert.equal(verifyPassword("x", null), false);
  assert.equal(verifyPassword("x", "not-a-hash"), false);
  // 同一密码每次盐不同
  assert.notEqual(hashPassword("same"), hashPassword("same"));
  // 房间密码复用同一套哈希
  const roomHash = hashRoomPassword("room-pass");
  assert.equal(verifyRoomPassword("room-pass", roomHash), true);
  assert.equal(verifyRoomPassword("bad", roomHash), false);
});

test("JWT 签名、校验与过期", () => {
  const secret = "unit-test-secret";
  const token = signJwt({ sub: 7, sid: "session-1" }, secret, 3600);
  const payload = verifyJwt(token, secret);
  assert.ok(payload);
  assert.equal(payload.sub, 7);
  assert.equal(payload.sid, "session-1");
  assert.equal(verifyJwt(token, "other-secret"), null);
  assert.equal(verifyJwt(token.slice(0, -2) + "xx", secret), null);
  assert.equal(verifyJwt("garbage", secret), null);
  const expired = signJwt({ sub: 1, sid: "s" }, secret, 0);
  assert.equal(verifyJwt(expired, secret), null);
});

test("音频预设与参数规范化", () => {
  assert.equal(presetSettings("voice-standard").bitrate, 32000);
  assert.equal(presetSettings("music").channels, 2);
  assert.equal(presetSettings("voice-low").bitrate, 16000);

  const normalized = normalizeAudioSettings({ bitrate: 999999, channels: 2, sampleRate: 12345 });
  assert.equal(normalized.bitrate, 160000);
  assert.equal(normalized.channels, 2);
  assert.equal(normalized.sampleRate, 16000);
  assert.equal(normalized.preset, "custom");

  // 仅指定预设时完整套用预设
  const standard = normalizeAudioSettings({ preset: "voice-standard" });
  assert.equal(standard.bitrate, 32000);
  assert.equal(standard.channels, 1);
  assert.equal(standard.preset, "voice-standard");

  assert.equal(deriveAudioPreset(standard), "voice-standard");
  assert.equal(deriveAudioPreset({ ...standard, bitrate: 123000 }), "custom");
});

test("房间音质覆盖与差异计算", () => {
  const base = DEFAULT_AUDIO_SETTINGS;
  // 指定预设后叠加显式字段
  const merged = mergeAudioSettings(base, { preset: "music", bitrate: 64000 });
  assert.equal(merged.channels, 2);
  assert.equal(merged.bitrate, 64000);
  assert.equal(merged.dtx, false);
  assert.equal(merged.preset, "custom");

  // 完整预设覆盖
  const music = mergeAudioSettings(base, { preset: "music" });
  assert.equal(music.bitrate, 96000);
  assert.equal(music.channels, 2);
  assert.equal(music.preset, "music");

  // 差异 -> 覆盖 -> 再合并应还原
  const diff = diffAudioSettings(base, music);
  assert.ok(diff);
  assert.equal(diff?.bitrate, 96000);
  assert.equal(diff?.channels, 2);
  const roundTrip = mergeAudioSettings(base, diff);
  assert.equal(roundTrip.bitrate, music.bitrate);
  assert.equal(roundTrip.channels, 2);
  assert.equal(roundTrip.preset, "music");

  // 与默认一致时返回 null
  assert.equal(diffAudioSettings(base, { ...base }), null);
});

test("getUserMedia 音频约束", () => {
  const constraints = audioConstraints(presetSettings("music")) as Record<string, unknown>;
  assert.equal(constraints.echoCancellation, false);
  assert.equal(constraints.noiseSuppression, false);
  assert.equal(constraints.channelCount, 2);
  assert.equal(constraints.sampleRate, 48000);
});

test("Opus SDP fmtp 修饰", () => {
  const baseSdp = [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 0 8",
    "c=IN IP4 0.0.0.0",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "a=rtpmap:0 PCMU/8000",
    "a=sendrecv",
  ].join("\r\n");

  const settings = presetSettings("music");
  const munged = applyOpusToSdp(baseSdp, settings);
  assert.match(munged, /a=fmtp:111 .*maxaveragebitrate=96000/);
  assert.match(munged, /a=fmtp:111 .*stereo=1/);
  assert.match(munged, /a=fmtp:111 .*usedtx=0/);
  assert.match(munged, /a=fmtp:111 .*minptime=10/);

  const second = applyOpusToSdp(munged, presetSettings("voice-low"));
  assert.match(second, /maxaveragebitrate=16000/);
  assert.match(second, /stereo=0/);
  assert.equal((second.match(/a=fmtp:111/g) ?? []).length, 1);

  // 没有 opus 的 SDP 原样返回
  const pcmuOnly = "v=0\r\nm=audio 9 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000";
  assert.equal(applyOpusToSdp(pcmuOnly, settings), pcmuOnly);
  assert.match(buildOpusFmtp(settings), /maxaveragebitrate=96000/);
});

test("角色权限映射", () => {
  assert.deepEqual(new Set(permissionsForRole("guest")), new Set());
  assert.ok(permissionsForRole("admin").includes("manage_server"));
  assert.ok(permissionsForRole("moderator").includes("manage_rooms"));
  assert.ok(!permissionsForRole("moderator").includes("manage_server"));
  assert.ok(permissionsForRole("user").includes("create_rooms"));
  assert.equal(ROLE_PERMISSIONS.admin.length, 8);
});

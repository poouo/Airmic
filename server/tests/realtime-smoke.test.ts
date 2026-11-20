import test from "node:test";
import assert from "node:assert/strict";
import { createTestContext } from "./helpers.js";

test("WebSocket 冒烟：加入房间、聊天、信令转发、在线人数", async () => {
  const ctx = await createTestContext();
  try {
    const adminClient = await ctx.registerUser("wsadmin");
    const roomResponse = await adminClient.post<{ room: { id: number } }>("/api/rooms", { name: "WS 冒烟房", maxUsers: 8 });
    const roomId = roomResponse.body.room.id;

    const userClient = ctx.newClient();
    const reg = await userClient.register("wsuser");
    assert.equal(reg.status, 200);

    const adminWs = await ctx.connectWs(adminClient);
    const userWs = await ctx.connectWs(userClient);
    const adminHello = await adminWs.waitFor("hello");
    assert.equal(adminHello.user.username, "wsadmin");
    const userHello = await userWs.waitFor("hello");
    assert.equal(userHello.user.username, "wsuser");

    adminWs.send({ t: "join_room", roomId });
    const adminJoined = await adminWs.waitFor("room_joined");
    assert.equal(adminJoined.snapshot.room.id, roomId);
    assert.equal(adminJoined.snapshot.peers.length, 0);

    userWs.send({ t: "join_room", roomId });
    const userJoined = await userWs.waitFor("room_joined");
    assert.equal(userJoined.snapshot.room.id, roomId);
    assert.equal(userJoined.snapshot.peers.length, 1);
    assert.equal(userJoined.snapshot.peers[0]?.userId, adminHello.user.id);

    const peerJoined = await adminWs.waitFor("peer_joined");
    assert.equal(peerJoined.peer.userId, userHello.user.id);

    // 房间人数应实时反映
    const rooms = await adminClient.get<{ rooms: { id: number; userCount: number }[] }>("/api/rooms");
    assert.equal(rooms.body.rooms.find((item) => item.id === roomId)?.userCount, 2);

    // 聊天广播
    userWs.send({ t: "chat", content: "大家好，这里是 WS 冒烟测试" });
    const chat = await adminWs.waitFor("chat_message");
    assert.equal(chat.message.content, "大家好，这里是 WS 冒烟测试");
    assert.equal(chat.message.userId, userHello.user.id);

    // 信令转发
    const offer = { kind: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0" };
    adminWs.send({ t: "signal", to: userHello.user.id, payload: offer });
    const signal = await userWs.waitFor("signal");
    assert.equal(signal.from, adminHello.user.id);
    assert.equal(signal.payload.kind, "offer");

    // 离开房间
    userWs.send({ t: "leave_room" });
    await userWs.waitFor("room_left");
    const peerLeft = await adminWs.waitFor("peer_left");
    assert.equal(peerLeft.userId, userHello.user.id);
  } finally {
    await ctx.close();
  }
});

test("WebSocket 冒烟：房间密码错误与正确进入", async () => {
  const ctx = await createTestContext();
  try {
    const adminClient = await ctx.registerUser("wsadmin2");
    const roomResponse = await adminClient.post<{ room: { id: number } }>("/api/rooms", {
      name: "密码冒烟房",
      password: "pass1234",
    });
    const roomId = roomResponse.body.room.id;
    const userClient = await ctx.registerUser("wsuser2");
    const userWs = await ctx.connectWs(userClient);
    await userWs.waitFor("hello");

    userWs.send({ t: "join_room", roomId, password: "wrong-pass" });
    const error = await userWs.waitFor("error");
    assert.equal(error.code, "room_password_invalid");

    userWs.send({ t: "join_room", roomId, password: "pass1234" });
    const joined = await userWs.waitFor("room_joined");
    assert.equal(joined.snapshot.room.hasPassword, true);
  } finally {
    await ctx.close();
  }
});
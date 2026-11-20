import type { OnlineUser, PeerInfo, RoomSummary } from "@airmic/shared";
import { useAppStore } from "../stores/app";
import { useAuthStore } from "../stores/auth";
import { useRoomStore } from "../stores/room";
import { useUiStore } from "../stores/ui";
import { socket } from "./ws";
import { voice } from "../voice/engine";

let initialized = false;

function toast(
  message: string,
  type: "info" | "success" | "error" | "warning" = "info",
  title?: string,
  duration?: number,
): void {
  useUiStore.getState().toast(message, type, title, duration);
}

/** 注册所有 WebSocket 事件到 store / 语音引擎（只执行一次） */
export function initRealtime(): void {
  if (initialized) return;
  initialized = true;

  socket.onStatus((status) => {
    useAppStore.getState().setConnection(status);
    if (status === "reconnecting") {
      const room = useRoomStore.getState().snapshot;
      if (room) toast("实时连接已断开，正在重连…", "warning");
    }
    if (status === "offline") {
      const room = useRoomStore.getState().snapshot;
      if (room) toast("实时连接已断开，请刷新页面或重新登录", "error");
    }
  });

  socket.on("hello", (message) => {
    const app = useAppStore.getState();
    app.setServer(message.server);
    app.setRooms(message.rooms);
    app.setOnlineUsers(message.onlineUsers);
    useAuthStore.getState().setUser(message.user);

    // 断线重连/首次连接后自动回到之前的房间。
    // 直接刷新 /room/:id 时，页面可能在 WebSocket 就绪前就发起了加入请求，
    // 此时 lastJoin 已记录但 snapshot 为空，需要在 hello 之后补发 join_room。
    const roomState = useRoomStore.getState();
    if (roomState.lastJoin) {
      roomState.joinRoom(roomState.lastJoin.roomId, roomState.lastJoin.password, true);
    }
  });

  socket.on("rooms", (message) => {
    useAppStore.getState().setRooms(message.rooms);
  });

  socket.on("online_users", (message) => {
    useAppStore.getState().setOnlineUsers(message.users);
  });

  socket.on("room_joined", (message) => {
    const roomStore = useRoomStore.getState();
    const previousRoomId = roomStore.snapshot?.room.id;
    roomStore.applySnapshot(message.snapshot);
    if (previousRoomId === message.snapshot.room.id) {
      // 重连/刷新快照：重建语音连接
      voice.leave();
    }
    void voice.enter(message.snapshot).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "无法建立语音连接";
      toast(text, "error");
    });
  });

  socket.on("room_left", (message) => {
    voice.leave();
    useRoomStore.getState().applyLeft(message.reason);
  });

  socket.on("peer_joined", (message) => {
    useRoomStore.getState().applyPeerJoined(message.peer);
    void voice.addPeer(message.peer).catch((error: unknown) => {
      console.error("[voice] addPeer failed", error);
    });
  });

  socket.on("peer_left", (message) => {
    useRoomStore.getState().applyPeerLeft(message.userId);
    voice.removePeer(message.userId);
  });

  socket.on("peer_updated", (message) => {
    useRoomStore.getState().applyPeerUpdated(message.peer);
  });

  socket.on("peer_state", (message) => {
    useRoomStore.getState().applyPeerState(message.userId, message.state);
  });

  socket.on("chat_message", (message) => {
    useRoomStore.getState().applyMessage(message.message);
  });

  socket.on("notice", (message) => {
    const level = message.level === "warn" ? "warn" : message.level === "error" ? "error" : "info";
    useRoomStore.getState().addNotice(message.text, level);
  });

  socket.on("signal", (message) => {
    void voice.handleSignal(message.from, message.payload).catch((error: unknown) => {
      console.error("[voice] signal failed", error);
    });
  });

  socket.on("room_updated", (message) => {
    useAppStore.getState().upsertRoom(message.room);
    const roomState = useRoomStore.getState();
    if (roomState.snapshot && roomState.snapshot.room.id === message.room.id) {
      useRoomStore.setState({
        snapshot: { ...roomState.snapshot, room: message.room },
      });
      void voice.applyAudioSettings(message.room.audioSettings).catch(() => {
        /* 忽略：音质调整失败不影响通话 */
      });
    }
  });

  socket.on("room_deleted", (message) => {
    useAppStore.getState().removeRoom(message.roomId);
    const roomState = useRoomStore.getState();
    if (roomState.snapshot?.room.id === message.roomId) {
      voice.leave();
      roomState.applyLeft("房间已被删除");
      toast("你所在的房间已被管理员删除", "warning");
    }
  });

  socket.on("server_settings", (message) => {
    useAppStore.getState().setServer(message.server);
  });

  socket.on("kicked", (message) => {
    const roomState = useRoomStore.getState();
    if (message.scope === "server") {
      socket.stopReconnect();
      socket.disconnect();
      voice.leave();
      roomState.reset();
      toast("你已被移出服务器：" + message.reason, "error", "连接已断开", 8000);
    } else {
      voice.leave();
      roomState.applyLeft(message.reason);
      toast("你已被移出房间：" + message.reason, "warning");
    }
  });

  socket.on("force_muted", (message) => {
    voice.applyForceMute(message.muted);
    toast(message.muted ? "管理员已将你强制静音" + (message.reason ? "：" + message.reason : "") : "管理员已解除你的静音", "warning");
  });

  socket.on("session_ended", (message) => {
    toast(message.reason, "warning", "登录状态已失效", 8000);
    useAuthStore.getState().handleSessionEnded();
  });

  socket.on("error", (message) => {
    if (message.request === "join_room") {
      useRoomStore.getState().setJoinError({ code: message.code, message: message.message });
    }
    if (message.code === "rate_limited") {
      toast("操作太频繁，请稍后再试", "warning");
      return;
    }
    toast(message.message, "error");
  });

  socket.on("pong", () => {
    /* 心跳响应，无需处理 */
  });
}

export function onlineUserToPeer(user: OnlineUser): PeerInfo | null {
  if (user.roomId === null) return null;
  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isGuest: user.isGuest,
    avatarColor: user.avatarColor,
    avatarEmoji: user.avatarEmoji,
    statusText: "",
    muted: user.muted,
    deafened: user.deafened,
    speaking: user.speaking,
    screenSharing: false,
    forceMuted: false,
    joinedAt: new Date().toISOString(),
  };
}

export function roomDisplayName(room: RoomSummary | null | undefined): string {
  return room?.name ?? "";
}
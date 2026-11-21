import { create } from "zustand";
import type { ChatMessage, PeerInfo, PeerStatePatch, RoomSnapshot } from "@airmic/shared";
import { socket } from "../lib/ws";

export interface NoticeLine {
  id: number;
  text: string;
  level: "info" | "warn" | "error";
  createdAt: string;
}

interface JoinError {
  code: string;
  message: string;
}

interface RoomState {
  snapshot: RoomSnapshot | null;
  peers: PeerInfo[];
  messages: ChatMessage[];
  notices: NoticeLine[];
  joining: boolean;
  joinError: JoinError | null;
  screenSharerId: number | null;
  /** 各成员的实时延迟（毫秒），由服务端心跳测量后广播；未知为 null */
  latency: Record<number, number | null>;
  lastJoin: { roomId: number; password?: string } | null;
  joinRoom: (roomId: number, password?: string, force?: boolean) => void;
  retryJoin: () => void;
  leaveRoom: () => void;
  applySnapshot: (snapshot: RoomSnapshot) => void;
  applyLeft: (reason?: string) => void;
  applyPeerJoined: (peer: PeerInfo) => void;
  applyPeerLeft: (userId: number, reason?: string) => void;
  applyPeerUpdated: (peer: PeerInfo) => void;
  applyPeerState: (userId: number, patch: PeerStatePatch) => void;
  setLatency: (userId: number, rttMs: number | null) => void;
  applyMessage: (message: ChatMessage) => void;
  addNotice: (text: string, level?: NoticeLine["level"]) => void;
  sendChat: (content: string) => boolean;
  setJoinError: (error: JoinError | null) => void;
  setJoining: (joining: boolean) => void;
  reset: () => void;
}

let noticeId = 1;

export const useRoomStore = create<RoomState>((set, get) => ({
  snapshot: null,
  peers: [],
  messages: [],
  notices: [],
  joining: false,
  joinError: null,
  screenSharerId: null,
  latency: {},
  lastJoin: null,

  joinRoom(roomId, password, force = false) {
    const current = get().snapshot;
    if (!force && current && current.room.id === roomId && !get().joinError) return;
    set({ joining: true, joinError: null, lastJoin: { roomId, password } });
    const sent = socket.send({ t: "join_room", roomId, password });
    if (!sent) {
      set({ joining: false, joinError: { code: "offline", message: "实时连接未建立，请稍后重试" } });
    }
  },

  retryJoin() {
    const last = get().lastJoin;
    if (!last) return;
    set({ joinError: null });
    get().joinRoom(last.roomId, last.password);
  },

  leaveRoom() {
    socket.send({ t: "leave_room" });
    set({
      snapshot: null,
      peers: [],
      messages: [],
      notices: [],
      joinError: null,
      joining: false,
      screenSharerId: null,
      lastJoin: null,
    });
  },

  applySnapshot(snapshot) {
    const latency: Record<number, number | null> = {};
    for (const peer of snapshot.peers) {
      if (typeof peer.rttMs === "number") latency[peer.userId] = peer.rttMs;
    }
    set((state) => ({
      snapshot,
      peers: snapshot.peers,
      messages: snapshot.messages,
      joining: state.joining && state.lastJoin?.roomId !== snapshot.room.id,
      joinError: null,
      lastJoin: state.joining || state.lastJoin?.roomId === snapshot.room.id ? state.lastJoin : { roomId: snapshot.room.id },
      screenSharerId: snapshot.screenSharerId,
      notices: [],
      latency,
    }));
  },

  applyLeft(reason) {
    set((state) => {
      const switching = state.joining && state.lastJoin !== null && state.lastJoin.roomId !== state.snapshot?.room.id;
      return { snapshot: null, peers: [], messages: [], joining: switching, lastJoin: switching ? state.lastJoin : null, screenSharerId: null, latency: {} };
    });
    if (reason) get().addNotice(reason, "warn");
  },

  applyPeerJoined(peer) {
    set((state) => {
      if (state.peers.some((item) => item.userId === peer.userId)) return state;
      const latency =
        typeof peer.rttMs === "number" ? { ...state.latency, [peer.userId]: peer.rttMs } : state.latency;
      return { peers: [...state.peers, peer], latency };
    });
  },

  applyPeerLeft(userId) {
    set((state) => {
      const latency = { ...state.latency };
      delete latency[userId];
      return {
        peers: state.peers.filter((peer) => peer.userId !== userId),
        screenSharerId: state.screenSharerId === userId ? null : state.screenSharerId,
        latency,
      };
    });
  },

  applyPeerUpdated(peer) {
    set((state) => ({
      peers: state.peers.some((item) => item.userId === peer.userId)
        ? state.peers.map((item) => (item.userId === peer.userId ? { ...item, ...peer } : item))
        : [...state.peers, peer],
    }));
  },

  applyPeerState(userId, patch) {
    set((state) => {
      let screenSharerId = state.screenSharerId;
      if (patch.screenSharing === true) screenSharerId = userId;
      if (patch.screenSharing === false && screenSharerId === userId) screenSharerId = null;
      return {
        peers: state.peers.map((peer) => (peer.userId === userId ? { ...peer, ...patch } : peer)),
        screenSharerId,
      };
    });
  },

  applyMessage(message) {
    set((state) => ({ messages: [...state.messages, message].slice(-500) }));
  },

  addNotice(text, level = "info") {
    const line: NoticeLine = { id: noticeId++, text, level, createdAt: new Date().toISOString() };
    set((state) => ({ notices: [...state.notices, line].slice(-100) }));
  },

  sendChat(content) {
    const trimmed = content.trim();
    if (!trimmed) return false;
    return socket.send({ t: "chat", content: trimmed });
  },

  setJoinError(error) {
    set({ joinError: error, joining: false });
  },

  setJoining(joining) {
    set({ joining });
  },

  setLatency(userId, rttMs) {
    set((state) => ({ latency: { ...state.latency, [userId]: rttMs } }));
  },

  reset() {
    set({
      snapshot: null,
      peers: [],
      messages: [],
      notices: [],
      joining: false,
      joinError: null,
      lastJoin: null,
      screenSharerId: null,
      latency: {},
    });
  },
}));

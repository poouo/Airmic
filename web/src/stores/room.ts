import { create } from "zustand";
import type { ChatMessage, CodeRoomRequest, PeerInfo, PeerStatePatch, RoomSnapshot } from "@airmic/shared";
import { socket } from "../lib/ws";
import { useAuthStore } from "./auth";

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

export interface StageUserState {
  onStage: boolean;
  pending: boolean;
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
  lastJoin: { roomId: number; password?: string; code?: string } | null;
  pendingCode: CodeRoomRequest | null;
  codeRevealRoomId: number | null;
  stageUsers: Record<number, StageUserState>;
  stageRequests: number[];
  joinRoom: (roomId: number, password?: string, force?: boolean) => void;
  requestCodeRoom: (request: CodeRoomRequest) => void;
  retryJoin: (force?: boolean) => void;
  leaveRoom: () => void;
  applySnapshot: (snapshot: RoomSnapshot, request?: CodeRoomRequest["t"]) => void;
  applyLeft: (reason?: string) => void;
  applyPeerJoined: (peer: PeerInfo) => void;
  applyPeerLeft: (userId: number, reason?: string) => void;
  applyPeerUpdated: (peer: PeerInfo) => void;
  applyPeerState: (userId: number, patch: PeerStatePatch) => void;
  applyStageUpdate: (userId: number, state: StageUserState) => void;
  addStageRequest: (userId: number) => void;
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
  pendingCode: null,
  codeRevealRoomId: null,
  stageUsers: {},
  stageRequests: [],

  joinRoom(roomId, password, force = false) {
    const current = get().snapshot;
    if (!force && current && current.room.id === roomId && !get().joinError) return;
    set({ joining: true, joinError: null, lastJoin: { roomId, password } });
    const sent = socket.send({ t: "join_room", roomId, password });
    if (!sent) {
      set({ joining: false, joinError: { code: "offline", message: "实时连接未建立，请稍后重试" } });
    }
  },

  requestCodeRoom(request) {
    set({ pendingCode: request, joining: true, joinError: null });
    if (!socket.send(request)) {
      get().setJoinError({ code: "offline", message: "实时连接未建立，请稍后重试" });
    }
  },

  retryJoin(force = false) {
    const last = get().lastJoin;
    if (!last) return;
    if (last.code) get().requestCodeRoom({ t: "join_code_room", code: last.code, roomId: last.roomId });
    else get().joinRoom(last.roomId, last.password, force);
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
      pendingCode: null,
      codeRevealRoomId: null,
      stageUsers: {},
      stageRequests: [],
    });
  },

  applySnapshot(snapshot, request) {
    const latency: Record<number, number | null> = {};
    for (const peer of snapshot.peers) {
      if (typeof peer.rttMs === "number") latency[peer.userId] = peer.rttMs;
    }
    set((state) => {
      const completingCode = state.pendingCode !== null && state.pendingCode.t === request;
      const code = state.pendingCode?.t === "join_code_room" && completingCode ? state.pendingCode.code : snapshot.inviteCode;
      const keepLastJoin = (state.joining && !completingCode) || state.lastJoin?.roomId === snapshot.room.id;
      return {
        snapshot,
        peers: snapshot.peers,
        messages: snapshot.messages,
        joining: !completingCode && state.joining && state.lastJoin?.roomId !== snapshot.room.id,
        joinError: null,
        lastJoin: code ? { roomId: snapshot.room.id, code }
          : keepLastJoin ? state.lastJoin : { roomId: snapshot.room.id },
        pendingCode: completingCode ? null : state.pendingCode,
        codeRevealRoomId: completingCode && request === "create_code_room" ? snapshot.room.id : state.codeRevealRoomId,
        screenSharerId: snapshot.screenSharerId,
        stageUsers: {
          ...Object.fromEntries(snapshot.peers.map((peer) => [peer.userId, {
            onStage: peer.onStage,
            pending: peer.stageRequested,
          }])),
          ...(useAuthStore.getState().user ? {
            [useAuthStore.getState().user!.id]: {
              onStage: snapshot.selfOnStage,
              pending: snapshot.selfStageRequested,
            },
          } : {}),
        },
        stageRequests: snapshot.peers.filter((peer) => peer.stageRequested).map((peer) => peer.userId),
        notices: [],
        latency,
      };
    });
  },

  applyLeft(reason) {
    set((state) => {
      const switching = state.joining && (state.pendingCode !== null ||
        (state.lastJoin !== null && state.lastJoin.roomId !== state.snapshot?.room.id));
      return {
        snapshot: null,
        peers: [],
        messages: [],
        joining: switching,
        lastJoin: switching ? state.lastJoin : null,
        screenSharerId: null,
        latency: {},
        stageUsers: {},
        stageRequests: [],
      };
    });
    if (reason) get().addNotice(reason, "warn");
  },

  applyPeerJoined(peer) {
    set((state) => {
      if (state.peers.some((item) => item.userId === peer.userId)) return state;
      const latency =
        typeof peer.rttMs === "number" ? { ...state.latency, [peer.userId]: peer.rttMs } : state.latency;
      return {
        peers: [...state.peers, peer],
        latency,
        stageUsers: { ...state.stageUsers, [peer.userId]: { onStage: peer.onStage, pending: peer.stageRequested } },
        stageRequests: peer.stageRequested && !state.stageRequests.includes(peer.userId)
          ? [...state.stageRequests, peer.userId]
          : state.stageRequests,
      };
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
        stageRequests: state.stageRequests.filter((id) => id !== userId),
        stageUsers: Object.fromEntries(Object.entries(state.stageUsers).filter(([id]) => Number(id) !== userId)),
      };
    });
  },

  applyPeerUpdated(peer) {
    set((state) => ({
      peers: state.peers.some((item) => item.userId === peer.userId)
        ? state.peers.map((item) => (item.userId === peer.userId ? { ...item, ...peer } : item))
        : [...state.peers, peer],
      stageUsers: { ...state.stageUsers, [peer.userId]: { onStage: peer.onStage, pending: peer.stageRequested } },
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

  applyStageUpdate(userId, stage) {
    set((state) => {
      const stageRequests = stage.pending
        ? state.stageRequests.includes(userId) ? state.stageRequests : [...state.stageRequests, userId]
        : state.stageRequests.filter((id) => id !== userId);
      return {
        stageUsers: { ...state.stageUsers, [userId]: stage },
        stageRequests,
        peers: state.peers.map((peer) => peer.userId === userId
          ? { ...peer, onStage: stage.onStage, stageMuted: !stage.onStage, stageRequested: stage.pending }
          : peer),
      };
    });
  },

  addStageRequest(userId) {
    set((state) => state.stageRequests.includes(userId) ? state : { stageRequests: [...state.stageRequests, userId] });
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
    set({ joinError: error, joining: false, pendingCode: null });
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
      pendingCode: null,
      codeRevealRoomId: null,
      stageUsers: {},
      stageRequests: [],
      screenSharerId: null,
      latency: {},
    });
  },
}));

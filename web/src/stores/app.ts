import { create } from "zustand";
import type { OnlineUser, RoomSummary, ServerSettingsPublic } from "@airmic/shared";
import { api } from "../lib/api";
import { socket } from "../lib/ws";
import type { SocketStatus } from "../lib/ws";

interface AppState {
  server: ServerSettingsPublic | null;
  setupRequired: boolean;
  rooms: RoomSummary[];
  onlineUsers: OnlineUser[];
  connection: SocketStatus;
  bootstrapped: boolean;
  loadingServer: boolean;
  loadServerInfo: () => Promise<void>;
  connectSocket: () => void;
  disconnectSocket: () => void;
  refreshRooms: () => Promise<void>;
  setConnection: (status: SocketStatus) => void;
  setServer: (server: ServerSettingsPublic) => void;
  setRooms: (rooms: RoomSummary[]) => void;
  setOnlineUsers: (users: OnlineUser[]) => void;
  upsertRoom: (room: RoomSummary) => void;
  removeRoom: (roomId: number) => void;
  onlineCountForRoom: (roomId: number) => number;
}

export const useAppStore = create<AppState>((set, get) => ({
  server: null,
  setupRequired: false,
  rooms: [],
  onlineUsers: [],
  connection: "idle",
  bootstrapped: false,
  loadingServer: false,

  async loadServerInfo() {
    if (get().loadingServer) return;
    set({ loadingServer: true });
    try {
      const info = await api.serverInfo();
      set({ server: info.server, setupRequired: info.setupRequired, bootstrapped: true });
    } catch {
      set({ bootstrapped: true });
    } finally {
      set({ loadingServer: false });
    }
  },

  connectSocket() {
    socket.connect();
  },

  disconnectSocket() {
    socket.disconnect();
  },

  async refreshRooms() {
    try {
      const result = await api.rooms.list();
      set({ rooms: result.rooms });
    } catch {
      /* ignore */
    }
  },

  setConnection(status) {
    set({ connection: status });
  },

  setServer(server) {
    set({ server });
  },

  setRooms(rooms) {
    set({ rooms });
  },

  setOnlineUsers(users) {
    set({ onlineUsers: users });
  },

  upsertRoom(room) {
    set((state) => {
      const exists = state.rooms.some((item) => item.id === room.id);
      const rooms = exists
        ? state.rooms.map((item) => (item.id === room.id ? { ...item, ...room } : item))
        : [...state.rooms, room];
      return { rooms };
    });
  },

  removeRoom(roomId) {
    set((state) => ({ rooms: state.rooms.filter((item) => item.id !== roomId) }));
  },

  onlineCountForRoom(roomId) {
    return get().rooms.find((room) => room.id === roomId)?.userCount ?? 0;
  },
}));

export function groupRoomsByCategory(rooms: RoomSummary[]): { category: string; rooms: RoomSummary[] }[] {
  const map = new Map<string, RoomSummary[]>();
  for (const room of rooms) {
    const category = room.category || "开黑房间";
    const list = map.get(category);
    if (list) list.push(room);
    else map.set(category, [room]);
  }
  return [...map.entries()]
    .map(([category, list]) => ({
      category,
      rooms: [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    }))
    .sort((a, b) => a.category.localeCompare(b.category, "zh-CN"));
}

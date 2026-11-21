import { create } from "zustand";
import type { OnlineUser, RoomArea, RoomDirectory, RoomSummary, ServerSettingsPublic } from "@airmic/shared";
import { api, errorMessage } from "../lib/api";
import { socket } from "../lib/ws";
import type { SocketStatus } from "../lib/ws";

interface AppState {
  server: ServerSettingsPublic | null;
  setupRequired: boolean;
  rooms: RoomSummary[];
  directory: RoomDirectory | null;
  directoryError: string | null;
  onlineUsers: OnlineUser[];
  connection: SocketStatus;
  bootstrapped: boolean;
  loadingServer: boolean;
  loadServerInfo: () => Promise<void>;
  connectSocket: () => void;
  disconnectSocket: () => void;
  refreshRooms: () => Promise<void>;
  refreshDirectory: () => Promise<void>;
  setDirectory: (directory: RoomDirectory) => void;
  setConnection: (status: SocketStatus) => void;
  setServer: (server: ServerSettingsPublic) => void;
  setRooms: (rooms: RoomSummary[]) => void;
  setOnlineUsers: (users: OnlineUser[]) => void;
  upsertRoom: (room: RoomSummary) => void;
  removeRoom: (roomId: number) => void;
  onlineCountForRoom: (roomId: number) => number;
}

let directoryRequest = 0;

export const useAppStore = create<AppState>((set, get) => ({
  server: null,
  setupRequired: false,
  rooms: [],
  directory: null,
  directoryError: null,
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
    directoryRequest++;
    set({ directory: null, directoryError: null, rooms: [] });
  },

  async refreshDirectory() {
    const request = ++directoryRequest;
    try {
      const directory = await api.roomDirectory.get();
      if (request === directoryRequest) set({ directory, directoryError: null });
    } catch (error) {
      if (request === directoryRequest) set({ directoryError: errorMessage(error) });
    }
  },

  setDirectory(directory) {
    directoryRequest++;
    set({ directory, directoryError: null });
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

export function groupRoomDirectory(areas: RoomArea[], rooms: RoomSummary[]) {
  const byArea = new Map<number, RoomSummary[]>();
  for (const room of rooms) {
    const list = byArea.get(room.areaId);
    if (list) list.push(room);
    else byArea.set(room.areaId, [room]);
  }
  return areas.filter((area) => area.parentId === null).map((area) => ({
    area,
    children: areas.filter((child) => child.parentId === area.id).map((child) => ({
      area: child,
      rooms: (byArea.get(child.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    })),
  }));
}

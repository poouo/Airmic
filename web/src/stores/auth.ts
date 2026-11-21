import { create } from "zustand";
import type { RegisterRequest, UserSelf } from "@airmic/shared";
import { api, errorMessage } from "../lib/api";
import { socket } from "../lib/ws";
import { useRoomStore } from "./room";

/** 游客昵称存本地，下次打开沿用 */
const GUEST_NAME_KEY = "airmic:guest-name";

/** 随机游客昵称，如「玩家4821」 */
export function randomGuestName(): string {
  return "玩家" + String(Math.floor(1000 + Math.random() * 9000));
}

export function readStoredGuestName(): string | null {
  try {
    const value = window.localStorage.getItem(GUEST_NAME_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function rememberName(user: UserSelf): void {
  if (!user.isGuest) return;
  try {
    window.localStorage.setItem(GUEST_NAME_KEY, user.displayName);
  } catch {
    /* 隐私模式可能禁用 localStorage，忽略即可 */
  }
}

interface AuthState {
  user: UserSelf | null;
  status: "loading" | "anonymous" | "authenticated";
  submitting: boolean;
  error: string | null;
  loadMe: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (payload: RegisterRequest) => Promise<void>;
  guest: (displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: UserSelf | null) => void;
  refreshUser: () => Promise<void>;
  handleSessionEnded: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: "loading",
  submitting: false,
  error: null,

  async loadMe() {
    set({ status: "loading", error: null });
    try {
      const result = await api.auth.me();
      rememberName(result.user);
      set({ user: result.user, status: "authenticated" });
    } catch {
      set({ user: null, status: "anonymous" });
    }
  },

  async login(username, password) {
    set({ submitting: true, error: null });
    try {
      const wasGuest = get().user?.isGuest === true;
      const result = await api.auth.login({ username, password });
      rememberName(result.user);
      set({ user: result.user, status: "authenticated", submitting: false });
      if (wasGuest) {
        // 游客切换到正式账号：Cookie 已换，重载页面让实时连接用新身份重建
        socket.disconnect();
        socket.stopReconnect();
        window.location.replace("/");
      }
    } catch (error) {
      set({ submitting: false, error: errorMessage(error) });
      throw error;
    }
  },

  async register(payload) {
    set({ submitting: true, error: null });
    try {
      const wasGuest = get().user?.isGuest === true;
      const result = await api.auth.register(payload);
      rememberName(result.user);
      set({ user: result.user, status: "authenticated", submitting: false });
      if (wasGuest) {
        socket.disconnect();
        socket.stopReconnect();
        window.location.replace("/");
      }
    } catch (error) {
      set({ submitting: false, error: errorMessage(error) });
      throw error;
    }
  },

  async guest(displayName) {
    set({ submitting: true, error: null });
    try {
      const result = await api.auth.guest({ displayName });
      rememberName(result.user);
      set({ user: result.user, status: "authenticated", submitting: false });
    } catch (error) {
      set({ submitting: false, error: errorMessage(error) });
      throw error;
    }
  },

  async logout() {
    try {
      await api.auth.logout();
    } catch {
      /* 会话可能已失效 */
    }
    socket.disconnect();
    useRoomStore.getState().reset();
    set({ user: null, status: "anonymous", error: null });
  },

  setUser(user) {
    if (user) rememberName(user);
    set({ user, status: user ? "authenticated" : "anonymous" });
  },

  async refreshUser() {
    try {
      const result = await api.auth.me();
      rememberName(result.user);
      set({ user: result.user, status: "authenticated" });
    } catch {
      /* ignore */
    }
  },

  handleSessionEnded() {
    socket.disconnect();
    socket.stopReconnect();
    useRoomStore.getState().reset();
    set({ user: null, status: "anonymous", error: "登录状态已失效，请重新登录" });
  },

  clearError() {
    set({ error: null });
  },
}));

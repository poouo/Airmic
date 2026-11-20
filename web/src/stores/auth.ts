import { create } from "zustand";
import type { RegisterRequest, UserSelf } from "@airmic/shared";
import { api, errorMessage } from "../lib/api";
import { socket } from "../lib/ws";
import { useRoomStore } from "./room";

/** 游客昵称存本地，下次打开沿用 */
const GUEST_NAME_KEY = "airmic:guest-name";
/** 用户在本次标签页里主动退出后，不再自动创建游客身份 */
const NO_AUTO_GUEST_KEY = "airmic:no-auto-guest";

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
  try {
    window.localStorage.setItem(GUEST_NAME_KEY, user.displayName);
  } catch {
    /* 隐私模式可能禁用 localStorage，忽略即可 */
  }
}

export function shouldAutoGuest(): boolean {
  try {
    return window.sessionStorage.getItem(NO_AUTO_GUEST_KEY) !== "1";
  } catch {
    return true;
  }
}

function blockAutoGuest(): void {
  try {
    window.sessionStorage.setItem(NO_AUTO_GUEST_KEY, "1");
  } catch {
    /* ignore */
  }
}

function allowAutoGuest(): void {
  try {
    window.sessionStorage.removeItem(NO_AUTO_GUEST_KEY);
  } catch {
    /* ignore */
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
  /** 免登录进入：用本地记住的昵称（没有就随机生成）创建游客身份 */
  enterAsGuest: () => Promise<void>;
  /** 游客原地升级为正式账号，保留当前 user id 与房间身份 */
  upgrade: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: UserSelf | null) => void;
  refreshUser: () => Promise<void>;
  handleSessionEnded: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
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
      const result = await api.auth.login({ username, password });
      rememberName(result.user);
      allowAutoGuest();
      set({ user: result.user, status: "authenticated", submitting: false });
    } catch (error) {
      set({ submitting: false, error: errorMessage(error) });
      throw error;
    }
  },

  async register(payload) {
    set({ submitting: true, error: null });
    try {
      const result = await api.auth.register(payload);
      rememberName(result.user);
      allowAutoGuest();
      set({ user: result.user, status: "authenticated", submitting: false });
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
      allowAutoGuest();
      set({ user: result.user, status: "authenticated", submitting: false });
    } catch (error) {
      set({ submitting: false, error: errorMessage(error) });
      throw error;
    }
  },

  async enterAsGuest() {
    const displayName = readStoredGuestName() ?? randomGuestName();
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

  async upgrade(username, password, displayName) {
    set({ submitting: true, error: null });
    try {
      const result = await api.auth.upgrade({
        username,
        password,
        displayName: displayName && displayName.trim() ? displayName.trim() : undefined,
      });
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
    blockAutoGuest();
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

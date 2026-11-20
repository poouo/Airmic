import { create } from "zustand";
import type { RegisterRequest, UserSelf } from "@airmic/shared";
import { api, errorMessage } from "../lib/api";
import { socket } from "../lib/ws";
import { useRoomStore } from "./room";

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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  submitting: false,
  error: null,

  async loadMe() {
    set({ status: "loading", error: null });
    try {
      const result = await api.auth.me();
      set({ user: result.user, status: "authenticated" });
    } catch {
      set({ user: null, status: "anonymous" });
    }
  },

  async login(username, password) {
    set({ submitting: true, error: null });
    try {
      const result = await api.auth.login({ username, password });
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
    set({ user, status: user ? "authenticated" : "anonymous" });
  },

  async refreshUser() {
    try {
      const result = await api.auth.me();
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

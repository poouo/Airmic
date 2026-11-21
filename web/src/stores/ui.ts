import { create } from "zustand";

export type ToastType = "info" | "success" | "error" | "warning";

export interface ToastItem {
  id: number;
  message: string;
  title?: string;
  type: ToastType;
  duration: number;
}

export type GlobalModal = "settings" | "profile" | "room-directory" | "login" | "register" | null;

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface UiState {
  toasts: ToastItem[];
  modal: GlobalModal;
  sidebarOpen: boolean;
  confirmState: ConfirmState | null;
  toast: (message: string, type?: ToastType, title?: string, duration?: number) => void;
  dismissToast: (id: number) => void;
  openModal: (modal: Exclude<GlobalModal, null>) => void;
  closeModal: () => void;
  setSidebarOpen: (open: boolean) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  resolveConfirm: (value: boolean) => void;
}

let toastId = 1;

/** 相同提示在短时间内重复触发时只保留一条（设备/连接类事件常被重复上报） */
const DEDUPE_WINDOW_MS = 1500;
const recentToastAt = new Map<string, number>();

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  modal: null,
  sidebarOpen: false,
  confirmState: null,

  toast(message, type = "info", title, duration = 4000) {
    const key = type + "|" + (title ?? "") + "|" + message;
    const now = Date.now();
    const previous = recentToastAt.get(key);
    if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) return;
    recentToastAt.set(key, now);
    if (recentToastAt.size > 50) {
      for (const [staleKey, at] of recentToastAt) {
        if (now - at >= DEDUPE_WINDOW_MS) recentToastAt.delete(staleKey);
      }
    }
    const id = toastId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, title, type, duration }].slice(-5) }));
    if (duration > 0) {
      window.setTimeout(() => get().dismissToast(id), duration);
    }
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  openModal(modal) {
    set({ modal });
  },

  closeModal() {
    set({ modal: null });
  },

  setSidebarOpen(open) {
    set({ sidebarOpen: open });
  },

  confirm(options) {
    return new Promise<boolean>((resolve) => {
      set({ confirmState: { ...options, resolve } });
    });
  },

  resolveConfirm(value) {
    const state = get().confirmState;
    if (state) {
      state.resolve(value);
      set({ confirmState: null });
    }
  },
}));

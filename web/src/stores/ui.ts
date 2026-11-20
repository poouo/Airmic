import { create } from "zustand";

export type ToastType = "info" | "success" | "error" | "warning";

export interface ToastItem {
  id: number;
  message: string;
  title?: string;
  type: ToastType;
  duration: number;
}

export type GlobalModal = "settings" | "profile" | null;

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

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  modal: null,
  sidebarOpen: false,
  confirmState: null,

  toast(message, type = "info", title, duration = 4000) {
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

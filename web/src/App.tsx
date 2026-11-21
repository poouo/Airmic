import { useEffect, useRef, type ReactNode } from "react";
import { BrowserRouter, matchPath, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Permission } from "@airmic/shared";
import { ConfirmDialog, FullScreenLoader, Modal, ToastHost } from "@/components/ui";
import AppLayout from "@/components/layout/AppLayout";
import RoomDirectoryManager from "@/components/lobby/RoomDirectoryManager";
import UpgradeAccountModal from "@/components/auth/UpgradeAccountModal";
import ProfileModal from "@/components/profile/ProfileModal";
import SettingsModal from "@/components/settings/SettingsModal";
import AdminPage from "@/pages/AdminPage";
import AuthPage from "@/pages/AuthPage";
import LobbyPage from "@/pages/LobbyPage";
import RoomPage from "@/pages/RoomPage";
import SetupPage from "@/pages/SetupPage";
import { initRealtime } from "@/lib/events";
import { syncVisualViewport } from "@/lib/viewport";
import { useAppStore } from "@/stores/app";
import { useRoomStore } from "@/stores/room";
import { blockAutoGuest, shouldAutoGuest, useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

function RequireAuth({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (status === "loading") return <FullScreenLoader text="正在验证登录状态…" />;
  if (status !== "authenticated" || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (adminOnly) {
    const allowedPermissions: Permission[] = ["manage_server", "manage_rooms", "manage_users", "view_audit", "ban_users"];
    if (!allowedPermissions.some((permission) => user.permissions.includes(permission))) {
      return <Navigate to="/" replace />;
    }
  }
  return <>{children}</>;
}

function GlobalOverlays() {
  const modal = useUiStore((state) => state.modal);
  const closeModal = useUiStore((state) => state.closeModal);
  return (
    <>
      {modal === "settings" && <SettingsModal />}
      {modal === "profile" && <ProfileModal />}
      {modal === "upgrade" && <UpgradeAccountModal />}
      {modal === "room-directory" && <Modal open title="分区与房间管理" size="2xl" onClose={closeModal}>
        <RoomDirectoryManager inDialog />
      </Modal>}
      <ConfirmDialog />
      <ToastHost />
    </>
  );
}

function AppRoutes() {
  const status = useAuthStore((state) => state.status);
  const submitting = useAuthStore((state) => state.submitting);
  const serverName = useAppStore((state) => state.server?.name);
  const server = useAppStore((state) => state.server);
  const setupRequired = useAppStore((state) => state.setupRequired);
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const autoGuestRef = useRef(false);
  const location = useLocation();
  const previousPath = useRef(location.pathname);

  useEffect(() => {
    const leftRoomPage = matchPath("/room/:roomId", previousPath.current) && !matchPath("/room/:roomId", location.pathname);
    previousPath.current = location.pathname;
    if (leftRoomPage) {
      const room = useRoomStore.getState();
      if (room.snapshot || room.joining) room.leaveRoom();
    }
  }, [location.pathname]);

  useEffect(() => {
    document.title = serverName ? serverName + " · AirMic" : "AirMic · 网页语音开黑";
  }, [serverName]);

  // 免登录进入：首次打开且服务器开放游客模式时，自动创建一个游客身份直接进大厅。
  // 用户主动退出后（sessionStorage 标记）不再自动创建，改由登录页手动登录。
  useEffect(() => {
    if (autoGuestRef.current) return;
    if (!bootstrapped || setupRequired || status !== "anonymous") return;
    if (location.pathname === "/login" || location.pathname === "/setup") return;
    if (server && server.guestEnabled === false) return;
    if (!shouldAutoGuest()) return;
    autoGuestRef.current = true;
    void useAuthStore.getState().enterAsGuest().catch(() => {
      /* 游客创建失败（限流/关闭/网络异常）时不再自动重试，改由登录页手动处理 */
      blockAutoGuest();
    });
  }, [bootstrapped, setupRequired, status, location.pathname, server]);

  if (status === "loading") return <FullScreenLoader text="正在连接 AirMic…" />;
  if (status === "anonymous" && submitting && location.pathname !== "/login") return <FullScreenLoader text="正在以游客身份进入…" />;

  // 服务器尚未初始化时强制进入初始化向导（未登录也可访问）
  if (bootstrapped && setupRequired && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<LobbyPage />} />
        <Route path="room/:roomId" element={<RoomPage />} />
        <Route path="rooms/manage" element={<div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8"><RoomDirectoryManager /></div>} />
      </Route>
      <Route
        path="/admin"
        element={
          <RequireAuth adminOnly>
            <AdminPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const status = useAuthStore((state) => state.status);

  useEffect(syncVisualViewport, []);

  useEffect(() => {
    initRealtime();
    void useAppStore.getState().loadServerInfo();
    void useAuthStore.getState().loadMe();
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      const app = useAppStore.getState();
      void app.refreshDirectory();
      void app.refreshRooms();
      app.connectSocket();
    } else if (status === "anonymous") {
      useAppStore.getState().disconnectSocket();
    }
  }, [status]);

  return (
    <BrowserRouter>
      <AppRoutes />
      <GlobalOverlays />
    </BrowserRouter>
  );
}

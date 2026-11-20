import { useEffect, useRef, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Permission } from "@airmic/shared";
import { ConfirmDialog, FullScreenLoader, ToastHost } from "@/components/ui";
import AppLayout from "@/components/layout/AppLayout";
import UpgradeAccountModal from "@/components/auth/UpgradeAccountModal";
import ProfileModal from "@/components/profile/ProfileModal";
import SettingsModal from "@/components/settings/SettingsModal";
import AdminPage from "@/pages/AdminPage";
import AuthPage from "@/pages/AuthPage";
import LobbyPage from "@/pages/LobbyPage";
import RoomPage from "@/pages/RoomPage";
import SetupPage from "@/pages/SetupPage";
import { initRealtime } from "@/lib/events";
import { useAppStore } from "@/stores/app";
import { shouldAutoGuest, useAuthStore } from "@/stores/auth";
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
  return (
    <>
      {modal === "settings" && <SettingsModal />}
      {modal === "profile" && <ProfileModal />}
      {modal === "upgrade" && <UpgradeAccountModal />}
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
      /* 游客创建被限流/关闭时，退回登录页由用户手动处理 */
    });
  }, [bootstrapped, setupRequired, status, location.pathname, server]);

  if (status === "loading") return <FullScreenLoader text="正在连接 AirMic…" />;
  if (status === "anonymous" && submitting) return <FullScreenLoader text="正在以游客身份进入…" />;

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

  useEffect(() => {
    initRealtime();
    void useAppStore.getState().loadServerInfo();
    void useAuthStore.getState().loadMe();
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      useAppStore.getState().connectSocket();
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

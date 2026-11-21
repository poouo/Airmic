import { useEffect, useRef, type ReactNode } from "react";
import { BrowserRouter, matchPath, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmDialog, FullScreenLoader, Modal, ToastHost } from "@/components/ui";
import AppLayout from "@/components/layout/AppLayout";
import RoomDirectoryManager from "@/components/lobby/RoomDirectoryManager";
import AccountModal from "@/components/auth/AccountModal";
import { canAccessAdmin } from "@/components/lobby/access";
import ProfileModal from "@/components/profile/ProfileModal";
import SettingsModal from "@/components/settings/SettingsModal";
import AdminPage from "@/pages/AdminPage";
import LobbyPage from "@/pages/LobbyPage";
import RoomPage from "@/pages/RoomPage";
import SetupPage from "@/pages/SetupPage";
import { initRealtime } from "@/lib/events";
import { syncVisualViewport } from "@/lib/viewport";
import { useAppStore } from "@/stores/app";
import { useRoomStore } from "@/stores/room";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

function RequireAuth({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (status === "loading") return <FullScreenLoader text="正在验证登录状态…" />;
  if (status !== "authenticated" || !user) {
    return <Navigate to="/" replace state={{ returnTo: location.pathname + location.search }} />;
  }
  if (adminOnly && !canAccessAdmin(user)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function GlobalOverlays() {
  const modal = useUiStore((state) => state.modal);
  const closeModal = useUiStore((state) => state.closeModal);
  return (
    <>
      {modal === "settings" && <SettingsModal />}
      {modal === "profile" && <ProfileModal />}
      {(modal === "login" || modal === "register") && <AccountModal key={modal} mode={modal} />}
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
  const serverName = useAppStore((state) => state.server?.name);
  const setupRequired = useAppStore((state) => state.setupRequired);
  const bootstrapped = useAppStore((state) => state.bootstrapped);
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

  if (status === "loading") return <FullScreenLoader text="正在连接 AirMic…" />;

  // 服务器尚未初始化时强制进入初始化向导（未登录也可访问）
  if (bootstrapped && setupRequired && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<LobbyPage />} />
        <Route path="room/:roomId" element={<RequireAuth><RoomPage /></RequireAuth>} />
        <Route path="rooms/manage" element={<RequireAuth><div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8"><RoomDirectoryManager /></div></RequireAuth>} />
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

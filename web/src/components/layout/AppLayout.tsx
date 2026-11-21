import { useEffect, useState } from "react";
import { DoorOpen, House, PanelLeftClose, Settings, Settings2, X } from "lucide-react";
import { Link, Outlet, matchPath, useLocation } from "react-router-dom";
import AirMicMark from "@/components/brand/AirMicMark";
import AreaIcon from "@/components/lobby/AreaIcon";
import { canOpenRoomManagement } from "@/components/lobby/access";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";
import { useAppStore } from "@/stores/app";
import { useRoomStore } from "@/stores/room";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import WorkspaceBrand from "./WorkspaceBrand";

const SIDEBAR_KEY = "airmic:sidebar-collapsed";

/** 主界面布局：顶栏 + 左侧房间/在线用户/用户卡片 + 内容区；移动端侧栏为抽屉 */
export default function AppLayout() {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const roomMatch = matchPath("/room/:roomId", location.pathname);
  const activeRoom = useRoomStore((state) => state.snapshot?.room);
  const roomId = roomMatch ? Number(roomMatch.params.roomId) : null;
  const rooms = useAppStore((state) => state.rooms);
  const directory = useAppStore((state) => state.directory);
  const server = useAppStore((state) => state.server);
  const listedRoomName = rooms.find((room) => room.id === roomId)?.name;
  const isLobby = location.pathname === "/";
  const selectedChannel = isLobby ? Number(new URLSearchParams(location.search).get("channel")) : null;
  const pageTitle = roomMatch
    ? (activeRoom?.id === roomId ? activeRoom?.name : listedRoomName) ?? "语音房间"
    : isLobby ? "大厅" : "分区与房间管理";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const canManage = sidebarCollapsed && location.pathname !== "/rooms/manage" && canOpenRoomManagement(user, server, directory, rooms);

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
    } catch {
      /* 浏览器禁用存储时，保留当前页面的选择 */
    }
  };

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  return (
    <div className="app-frame workspace-frame flex overflow-hidden text-foreground">
      {user && <aside aria-label="房间侧栏" data-collapsed={sidebarCollapsed} className="workspace-sidebar hidden min-h-0 shrink-0 flex-col overflow-hidden lg:flex">
        <div className={cn("workspace-rail-header flex shrink-0 items-center", sidebarCollapsed ? "px-3" : "justify-between gap-2 px-3.5")}>
          {!sidebarCollapsed && <WorkspaceBrand />}
          <IconButton
            label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            aria-controls="desktop-room-directory"
            aria-expanded={!sidebarCollapsed}
            className={sidebarCollapsed ? "rail-link h-11 w-11 rounded-xl" : "h-9 w-9"}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <AirMicMark size={32} /> : <PanelLeftClose className="h-4 w-4" />}
          </IconButton>
        </div>
        <div className="relative min-h-0 flex-1">
          <div id="desktop-room-directory" inert={sidebarCollapsed} className="workspace-sidebar-content h-full">
            <Sidebar />
          </div>
          {sidebarCollapsed && <nav aria-label="快捷导航" className="absolute inset-0 flex min-h-0 flex-col">
            <div className="app-scroll flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto overscroll-y-contain py-3 [scrollbar-gutter:stable_both-edges]">
              <Link to="/" aria-label="大厅" title="大厅" aria-current={isLobby && !selectedChannel ? "page" : undefined} className="rail-link">
                <House className="h-[18px] w-[18px]" />
              </Link>
              {activeRoom && <Link to={"/room/" + activeRoom.id} aria-label="当前房间" title={activeRoom.name} aria-current={roomId === activeRoom.id ? "page" : undefined} className="rail-link">
                <DoorOpen className="h-[18px] w-[18px]" />
              </Link>}
              {directory?.areas.filter((area) => area.parentId === null).map((area) => (
                <Link key={area.id} to={"/?channel=" + area.id} aria-label={area.name} title={area.name}
                  aria-current={selectedChannel === area.id ? "page" : undefined} className="rail-link">
                  <AreaIcon icon={area.icon} isRoot className="h-[18px] w-[18px]" />
                </Link>
              ))}
            </div>
            <div className="flex shrink-0 flex-col items-center gap-1.5 border-t border-sidebar-border py-2">
              {canManage && <IconButton label="分区与房间管理" aria-haspopup="dialog" className="rail-link"
                onClick={() => useUiStore.getState().openModal("room-directory")}><Settings2 className="h-[18px] w-[18px]" /></IconButton>}
              <IconButton label="语音设置" className="rail-link" onClick={() => useUiStore.getState().openModal("settings")}><Settings className="h-[18px] w-[18px]" /></IconButton>
            </div>
          </nav>}
        </div>
      </aside>}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          onOpenSidebar={user ? () => setSidebarOpen(true) : undefined}
          pageTitle={pageTitle}
          showAnnouncement={isLobby}
        />
        <main className={cn("app-canvas relative min-h-0 min-w-0 flex-1", roomMatch ? "overflow-hidden" : "app-scroll page-scroll")}>
          <Outlet />
        </main>
      </div>

      {user && sidebarOpen && (
        <div className="viewport-overlay z-40 flex lg:hidden">
          <button type="button" aria-label="关闭侧栏遮罩" className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => setSidebarOpen(false)} />
          <div role="dialog" aria-label="房间导航" aria-modal="true" className="workspace-drawer relative flex min-h-0 w-[min(86vw,20rem)] flex-col border-r border-sidebar-border bg-sidebar shadow-popover">
            <div className="workspace-rail-header flex shrink-0 items-center justify-between gap-2 px-3">
              <WorkspaceBrand onNavigate={() => setSidebarOpen(false)} />
              <IconButton label="关闭侧栏" size="sm" onClick={() => setSidebarOpen(false)}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="flex min-h-0 flex-1">
              <Sidebar onNavigate={() => setSidebarOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

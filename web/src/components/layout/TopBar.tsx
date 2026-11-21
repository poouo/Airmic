import { Menu, PanelLeftClose, PanelLeftOpen, Users } from "lucide-react";
import { Link } from "react-router-dom";
import AirMicMark from "@/components/brand/AirMicMark";
import { Button, IconButton } from "@/components/ui";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import ConnectionStatus from "./ConnectionStatus";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";

export interface TopBarProps {
  onOpenSidebar?: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export default function TopBar({ onOpenSidebar, sidebarCollapsed, onToggleSidebar }: TopBarProps) {
  const server = useAppStore((state) => state.server);
  const connection = useAppStore((state) => state.connection);
  const onlineCount = useAppStore((state) => state.onlineUsers.length);
  const user = useAuthStore((state) => state.user);
  const openModal = useUiStore((state) => state.openModal);
  const showRegister = user?.isGuest && server?.registrationMode !== "closed";

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:gap-3 sm:px-4">
      {onOpenSidebar && <IconButton label="打开侧栏" className="h-10 w-10 lg:hidden" onClick={onOpenSidebar}>
        <Menu className="h-5 w-5" />
      </IconButton>}
      {user && <div className="hidden shrink-0 lg:block">
        <IconButton label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"} aria-controls="desktop-room-sidebar"
          aria-expanded={!sidebarCollapsed} onClick={onToggleSidebar}>
          {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </IconButton>
      </div>}

      <Link
        to="/"
        className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AirMicMark />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight tracking-tight">
            AirMic
          </span>
          <span className="block max-w-[7rem] truncate text-[11px] leading-tight text-muted-foreground sm:max-w-[12rem]">
            {server?.name ?? "语音服务器"}
          </span>
        </span>
      </Link>

      {user && <div className={user.isGuest ? "hidden shrink-0 sm:block" : "shrink-0"}>
        <ConnectionStatus status={connection} />
      </div>}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {user && <span className="hidden items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
          <Users className="h-3.5 w-3.5" />
          在线 <span className="tabular text-foreground">{onlineCount}</span>
        </span>}
        <ThemeToggle />
        {user?.isGuest && <Button size="sm" variant="ghost" onClick={() => openModal("login")}>登录</Button>}
        {showRegister && <Button size="sm" onClick={() => openModal("register")}>注册</Button>}
        <UserMenu />
      </div>
    </header>
  );
}

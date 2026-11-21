import { useState } from "react";
import { ChevronRight, Megaphone, Menu } from "lucide-react";
import { Button, IconButton, Modal } from "@/components/ui";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import ConnectionStatus from "./ConnectionStatus";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";
import WorkspaceBrand from "./WorkspaceBrand";

export interface TopBarProps {
  onOpenSidebar?: () => void;
  pageTitle: string;
  showAnnouncement: boolean;
}

export default function TopBar({ onOpenSidebar, pageTitle, showAnnouncement }: TopBarProps) {
  const server = useAppStore((state) => state.server);
  const connection = useAppStore((state) => state.connection);
  const user = useAuthStore((state) => state.user);
  const openModal = useUiStore((state) => state.openModal);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const showRegister = user?.isGuest && server?.registrationMode !== "closed";
  const announcement = showAnnouncement ? server?.motd.trim() : undefined;
  const announcementButton = announcement && (
    <button type="button" aria-label="查看服务器公告" aria-haspopup="dialog" onClick={() => setAnnouncementOpen(true)}
      className="flex min-w-0 max-w-full items-center gap-2 rounded-md py-1 text-left text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      <Megaphone className="h-3.5 w-3.5 shrink-0 text-brand" />
      <span className="truncate">{announcement}</span>
    </button>
  );

  return (
    <>
      <header className="workspace-topbar flex shrink-0 items-center gap-2 px-2 sm:gap-3 sm:px-4 lg:px-6">
        {onOpenSidebar && <IconButton label="打开侧栏" className="h-10 w-10 lg:hidden" onClick={onOpenSidebar}>
          <Menu className="h-5 w-5" />
        </IconButton>}

        <WorkspaceBrand className={user ? "max-w-40 lg:hidden" : "max-w-52"} />
        {user && <nav aria-label="当前位置" className="hidden min-w-0 items-center gap-2 text-[13px] lg:flex">
          <span className="shrink-0 text-muted-foreground">AirMic</span>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          <span aria-current="page" className="max-w-60 truncate font-semibold text-foreground" title={pageTitle}>{pageTitle}</span>
        </nav>}
        {announcement && <div className="hidden min-w-0 flex-1 border-l border-border pl-3 lg:flex">{announcementButton}</div>}

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          {user && <div className={user.isGuest ? "hidden sm:block" : "shrink-0"}>
            <ConnectionStatus status={connection} />
          </div>}
          <ThemeToggle />
          {user?.isGuest && <Button size="sm" variant="ghost" onClick={() => openModal("login")}>登录</Button>}
          {showRegister && <Button size="sm" onClick={() => openModal("register")}>注册</Button>}
          <UserMenu />
        </div>
      </header>
      {announcement && <div className="flex min-w-0 shrink-0 border-b border-border bg-card px-3 lg:hidden">{announcementButton}</div>}
      {announcement && announcementOpen && (
        <Modal open title="服务器公告" onClose={() => setAnnouncementOpen(false)}>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{announcement}</p>
        </Modal>
      )}
    </>
  );
}

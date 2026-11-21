import { Menu, Users } from "lucide-react";
import { Link } from "react-router-dom";
import AirMicMark from "@/components/brand/AirMicMark";
import { IconButton } from "@/components/ui";
import { useAppStore } from "@/stores/app";
import ConnectionStatus from "./ConnectionStatus";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";

export interface TopBarProps {
  onOpenSidebar: () => void;
}

export default function TopBar({ onOpenSidebar }: TopBarProps) {
  const server = useAppStore((state) => state.server);
  const connection = useAppStore((state) => state.connection);
  const onlineCount = useAppStore((state) => state.onlineUsers.length);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:gap-3 sm:px-4">
      <IconButton label="打开侧栏" className="h-10 w-10 lg:hidden" onClick={onOpenSidebar}>
        <Menu className="h-5 w-5" />
      </IconButton>

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

      <span className="mx-1 hidden h-5 w-px shrink-0 bg-border sm:block" />
      <ConnectionStatus status={connection} />

      <div className="ml-auto flex items-center gap-1.5">
        <span className="hidden items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
          <Users className="h-3.5 w-3.5" />
          在线 <span className="tabular text-foreground">{onlineCount}</span>
        </span>
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

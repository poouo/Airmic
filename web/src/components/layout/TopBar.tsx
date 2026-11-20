import { Menu, Mic, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, IconButton } from "@/components/ui";
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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/5 bg-ink-900/70 px-2 backdrop-blur sm:gap-3 sm:px-4">
      <IconButton label="打开侧栏" className="lg:hidden" onClick={onOpenSidebar}>
        <Menu className="h-5 w-5" />
      </IconButton>

      <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-xl px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-aqua-500 shadow-md shadow-brand-500/30">
          <Mic className="h-4 w-4 text-white" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-mist-100">
            Air<span className="bg-gradient-to-r from-brand-400 to-aqua-400 bg-clip-text text-transparent">Mic</span>
          </span>
          <span className="block max-w-[7rem] truncate text-[10px] text-mist-500 sm:max-w-[12rem]">{server?.name ?? "语音服务器"}</span>
        </span>
      </Link>

      <ConnectionStatus status={connection} />

      <div className="ml-auto flex items-center gap-2">
        <Badge tone="neutral" className="hidden sm:inline-flex">
          <Users className="h-3 w-3" />
          在线 {onlineCount}
        </Badge>
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
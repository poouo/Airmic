import { useState } from "react";
import type { Permission } from "@airmic/shared";
import { ROLE_LABELS } from "@airmic/shared";
import {
  ArrowLeft,
  Ban,
  DoorOpen,
  KeyRound,
  LayoutDashboard,
  Mic,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { Avatar, Badge, Button } from "@/components/ui";
import AuditTab from "@/components/admin/AuditTab";
import BansTab from "@/components/admin/BansTab";
import OverviewTab from "@/components/admin/OverviewTab";
import RoomsTab from "@/components/admin/RoomsTab";
import SettingsTab from "@/components/admin/SettingsTab";
import SessionsTab from "@/components/admin/SessionsTab";
import UsersTab from "@/components/admin/UsersTab";
import ConnectionStatus from "@/components/layout/ConnectionStatus";
import { cn } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";

interface AdminSection {
  id: "overview" | "rooms" | "users" | "bans" | "audit" | "settings" | "sessions";
  label: string;
  icon: LucideIcon;
  permissions: Permission[];
}

const SECTIONS: AdminSection[] = [
  { id: "overview", label: "概览", icon: LayoutDashboard, permissions: ["manage_server"] },
  { id: "rooms", label: "房间管理", icon: DoorOpen, permissions: ["manage_rooms", "manage_server"] },
  { id: "users", label: "用户管理", icon: Users, permissions: ["manage_users"] },
  { id: "bans", label: "封禁管理", icon: Ban, permissions: ["ban_users"] },
  { id: "audit", label: "审计日志", icon: ScrollText, permissions: ["view_audit"] },
  { id: "settings", label: "服务器设置", icon: Settings, permissions: ["manage_server"] },
  { id: "sessions", label: "登录会话", icon: KeyRound, permissions: ["manage_users"] },
];

/** 管理后台：侧边导航 + 七个管理板块（具体数据按权限加载） */
export default function AdminPage() {
  const user = useAuthStore((state) => state.user);
  const server = useAppStore((state) => state.server);
  const connection = useAppStore((state) => state.connection);
  const onlineCount = useAppStore((state) => state.onlineUsers.length);
  const [activeId, setActiveId] = useState<AdminSection["id"] | null>(null);

  if (!user) return null;
  const allowed = SECTIONS.filter((section) => section.permissions.some((permission) => user.permissions.includes(permission)));
  if (allowed.length === 0) return <Navigate to="/" replace />;
  const active = allowed.find((section) => section.id === activeId) ?? allowed[0];

  return (
    <div className="flex h-screen overflow-hidden bg-ink-950">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-white/5 bg-ink-900/60 lg:flex">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/5 px-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-aqua-500 shadow-md shadow-brand-500/30">
            <Mic className="h-4 w-4 text-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-mist-100">
              Air<span className="text-gradient">Mic</span>
            </p>
            <p className="text-[10px] text-mist-500">管理后台</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto app-scroll p-2">
          {allowed.map((section) => {
            const Icon = section.icon;
            const isActive = section.id === active.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveId(section.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs transition-colors",
                  isActive ? "bg-brand-500/15 font-medium text-brand-200 ring-1 ring-brand-400/25" : "text-mist-300 hover:bg-white/5 hover:text-mist-100",
                )}
              >
                <Icon className={cn("h-4 w-4", isActive ? "text-brand-300" : "text-mist-500")} />
                {section.label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-2 border-t border-white/5 p-3">
          <div className="flex items-center gap-2 rounded-xl bg-ink-800/70 p-2 ring-1 ring-white/5">
            <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-mist-100">{user.displayName}</p>
              <p className="text-[10px] text-mist-500">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <Link
            to="/"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-mist-300 transition-colors hover:border-white/25 hover:bg-white/5 hover:text-mist-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回大厅
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/5 bg-ink-900/70 px-3 sm:px-4">
          <Link to="/" className="flex items-center gap-2 rounded-xl px-1 py-1 lg:hidden" aria-label="返回大厅">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-aqua-500">
              <Mic className="h-4 w-4 text-white" />
            </span>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-mist-100">管理后台 · {active.label}</h1>
            <p className="hidden truncate text-[10px] text-mist-500 sm:block">{server?.name ?? "AirMic"} · 在线 {onlineCount} 人</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ConnectionStatus status={connection} compact />
            <Badge tone="good">在线 {onlineCount}</Badge>
            <Link to="/" className="hidden sm:block">
              <Button variant="outline" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
                返回大厅
              </Button>
            </Link>
          </div>
        </header>

        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 bg-ink-900/40 px-2 py-1.5 app-scroll lg:hidden">
          {allowed.map((section) => {
            const Icon = section.icon;
            const isActive = section.id === active.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveId(section.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors",
                  isActive ? "bg-brand-500/15 text-brand-200" : "text-mist-400 hover:bg-white/5 hover:text-mist-200",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {section.label}
              </button>
            );
          })}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto app-scroll p-3 sm:p-5">
          {active.id === "overview" && <OverviewTab />}
          {active.id === "rooms" && <RoomsTab />}
          {active.id === "users" && <UsersTab />}
          {active.id === "bans" && <BansTab />}
          {active.id === "audit" && <AuditTab />}
          {active.id === "settings" && <SettingsTab />}
          {active.id === "sessions" && <SessionsTab />}
        </main>
      </div>
    </div>
  );
}

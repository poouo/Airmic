import { useState } from "react";
import type { Permission } from "@airmic/shared";
import { ROLE_LABELS } from "@airmic/shared";
import {
  ArrowLeft,
  Ban,
  DoorOpen,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { Avatar, Badge, Button, Divider, Select } from "@/components/ui";
import AirMicMark from "@/components/brand/AirMicMark";
import AuditTab from "@/components/admin/AuditTab";
import BansTab from "@/components/admin/BansTab";
import LogsTab from "@/components/admin/LogsTab";
import OverviewTab from "@/components/admin/OverviewTab";
import RoomDirectoryManager from "@/components/lobby/RoomDirectoryManager";
import SettingsTab from "@/components/admin/SettingsTab";
import SessionsTab from "@/components/admin/SessionsTab";
import UsersTab from "@/components/admin/UsersTab";
import ConnectionStatus from "@/components/layout/ConnectionStatus";
import ThemeToggle from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";

interface AdminSection {
  id: "overview" | "rooms" | "users" | "bans" | "audit" | "logs" | "settings" | "sessions";
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
  { id: "logs", label: "运行日志", icon: ScrollText, permissions: ["manage_server", "view_audit"] },
  { id: "settings", label: "服务器设置", icon: Settings, permissions: ["manage_server"] },
  { id: "sessions", label: "登录会话", icon: KeyRound, permissions: ["manage_users"] },
];

/** 管理后台：顶部标题区 + 侧边二级导航 + 各管理板块（具体数据按权限加载） */
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
    <div className="app-frame flex flex-col overflow-hidden bg-card text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:gap-3 sm:px-4">
        <Link
          to="/"
          aria-label="返回大厅"
          className="flex items-center rounded-lg px-1 py-1 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AirMicMark />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">管理后台 · {active.label}</h1>
          <p className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
            {server?.name ?? "AirMic"} · 在线 {onlineCount} 人
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <ConnectionStatus status={connection} compact />
          <Badge tone="good">在线 {onlineCount}</Badge>
          <Link to="/" className="hidden sm:block">
            <Button variant="outline" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
              返回大厅
            </Button>
          </Link>
        </div>
      </header>

      <div className="app-canvas flex min-h-0 flex-1 flex-col">
        <nav aria-label="后台功能" className="shrink-0 px-3 pt-4 sm:px-5 lg:hidden">
          <Select label="管理模块" options={allowed.map((section) => ({ value: section.id, label: section.label }))}
            value={active.id} onChange={(event) => setActiveId(event.target.value as AdminSection["id"])} />
        </nav>

        <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 lg:gap-6 lg:px-5">
          <aside aria-label="后台功能" className="hidden min-h-0 w-56 shrink-0 py-6 lg:block">
            <div className="app-scroll flex max-h-full flex-col gap-1 overflow-y-auto overscroll-y-contain rounded-2xl border border-border bg-card p-2 shadow-card [&>*]:shrink-0">
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">管理后台</p>
              {allowed.map((section) => {
                const Icon = section.icon;
                const isActive = section.id === active.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveId(section.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                      isActive ? "bg-accent font-semibold text-brand" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-foreground" : "text-muted-foreground")} />
                    {section.label}
                  </button>
                );
              })}

              <Divider className="my-1.5" />

              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{user.displayName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABELS[user.role]}</p>
                </div>
              </div>
              <Link
                to="/"
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                返回大厅
              </Link>
            </div>
          </aside>

          <main key={active.id} className="app-scroll page-scroll min-h-0 min-w-0 flex-1 scroll-pb-20 px-3 py-4 sm:px-5 lg:px-0 lg:py-6">
            {active.id === "overview" && <OverviewTab />}
            {active.id === "rooms" && <RoomDirectoryManager />}
            {active.id === "users" && <UsersTab />}
            {active.id === "bans" && <BansTab />}
            {active.id === "audit" && <AuditTab />}
            {active.id === "logs" && <LogsTab />}
            {active.id === "settings" && <SettingsTab />}
            {active.id === "sessions" && <SessionsTab />}
          </main>
        </div>
      </div>
    </div>
  );
}

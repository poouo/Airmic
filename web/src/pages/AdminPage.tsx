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
import { Avatar, Badge, Button, Divider } from "@/components/ui";
import AuditTab from "@/components/admin/AuditTab";
import BansTab from "@/components/admin/BansTab";
import LogsTab from "@/components/admin/LogsTab";
import OverviewTab from "@/components/admin/OverviewTab";
import RoomsTab from "@/components/admin/RoomsTab";
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
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:gap-3 sm:px-4">
        <Link
          to="/"
          aria-label="返回大厅"
          className="flex items-center rounded-lg px-1 py-1 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Mic className="h-4 w-4" />
          </span>
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

      <div className="app-canvas min-h-0 flex-1 overflow-y-auto app-scroll">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-5 sm:py-6">
          {/* 移动端二级导航 */}
          <nav className="no-scrollbar flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-card lg:hidden">
            {allowed.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === active.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveId(section.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors",
                    isActive ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {section.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-start gap-6">
            {/* 桌面端二级导航 */}
            <aside className="hidden w-56 shrink-0 lg:block">
              <div className="sticky top-6 flex flex-col gap-1 rounded-2xl border border-border bg-card p-2 shadow-card">
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">管理后台</p>
                {allowed.map((section) => {
                  const Icon = section.icon;
                  const isActive = section.id === active.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveId(section.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                        isActive ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
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

            <main className="min-w-0 flex-1">
              {active.id === "overview" && <OverviewTab />}
              {active.id === "rooms" && <RoomsTab />}
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
    </div>
  );
}

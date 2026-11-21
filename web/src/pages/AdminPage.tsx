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
import { Avatar, Badge, Select } from "@/components/ui";
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
import WorkspaceBrand from "@/components/layout/WorkspaceBrand";
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
  const connection = useAppStore((state) => state.connection);
  const onlineCount = useAppStore((state) => state.onlineUsers.length);
  const [activeId, setActiveId] = useState<AdminSection["id"] | null>(null);

  if (!user) return null;
  const allowed = SECTIONS.filter((section) => section.permissions.some((permission) => user.permissions.includes(permission)));
  if (allowed.length === 0) return <Navigate to="/" replace />;
  const active = allowed.find((section) => section.id === activeId) ?? allowed[0];
  const activeIndex = allowed.indexOf(active);

  return (
    <div className="app-frame workspace-frame flex overflow-hidden text-foreground">
      <aside aria-label="后台功能" className="workspace-sidebar hidden min-h-0 shrink-0 flex-col lg:flex">
        <div className="workspace-rail-header flex shrink-0 items-center px-4">
          <WorkspaceBrand />
        </div>
        <div className="app-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3">
          <p className="mb-2 px-3 text-[11px] font-semibold tracking-wide text-muted-foreground">管理后台</p>
          <nav aria-label="管理模块" className="relative flex flex-col gap-1">
            <span aria-hidden className="admin-nav-indicator pointer-events-none absolute inset-x-0 top-0 h-10 rounded-xl"
              style={{ transform: `translateY(${activeIndex * 2.75}rem)` }} />
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
                    "relative flex h-10 w-full shrink-0 items-center gap-2.5 rounded-xl px-3 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    isActive ? "font-semibold text-brand" : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {section.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="shrink-0 space-y-2 border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{user.displayName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <Link to="/" className="flex min-h-9 items-center gap-2.5 rounded-xl px-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-4 w-4" />
            返回大厅
          </Link>
        </div>
      </aside>

      <div className="app-canvas flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="workspace-topbar flex shrink-0 items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:px-6">
          <Link to="/" aria-label="返回大厅" title="返回大厅" className="rail-link h-9 w-9 shrink-0 lg:hidden">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex min-w-0 items-center gap-2 truncate text-[13px] font-semibold tracking-tight text-foreground">
            <span className="shrink-0 font-medium text-muted-foreground">管理后台</span>
            <span aria-hidden="true" className="text-muted-foreground/60">/</span>
            <span className="truncate">{active.label}</span>
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <ConnectionStatus status={connection} compact />
            <Badge tone="good">在线 {onlineCount}</Badge>
            <ThemeToggle />
          </div>
        </header>
        <nav aria-label="后台功能" className="shrink-0 border-b border-border bg-card/75 px-3 py-2 sm:px-5 lg:hidden">
          <Select label="管理模块" options={allowed.map((section) => ({ value: section.id, label: section.label }))}
            value={active.id} onChange={(event) => setActiveId(event.target.value as AdminSection["id"])} />
        </nav>

        <main key={active.id} className="app-scroll page-scroll min-h-0 min-w-0 flex-1 scroll-pb-20">
          <div className="workspace-enter mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 lg:p-6">
            {active.id === "overview" && <OverviewTab />}
            {active.id === "rooms" && <RoomDirectoryManager />}
            {active.id === "users" && <UsersTab />}
            {active.id === "bans" && <BansTab />}
            {active.id === "audit" && <AuditTab />}
            {active.id === "logs" && <LogsTab />}
            {active.id === "settings" && <SettingsTab />}
            {active.id === "sessions" && <SessionsTab />}
          </div>
        </main>
      </div>
    </div>
  );
}

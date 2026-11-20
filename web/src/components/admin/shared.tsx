import type { ReactNode } from "react";
import type { AdminUserRow, BanRow, OnlineUser, Role } from "@airmic/shared";
import { ROLE_LABELS } from "@airmic/shared";
import { AlertTriangle, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { Badge, Button, Spinner } from "@/components/ui";
import { cn, formatDateTime } from "@/lib/format";

// ============ 布局 ============

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-white/5 bg-ink-850", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-mist-100">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-mist-500">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

const STAT_TONES: Record<string, string> = {
  brand: "bg-brand-500/10 text-brand-300",
  aqua: "bg-aqua-500/10 text-aqua-400",
  good: "bg-good-500/10 text-good-400",
  warn: "bg-warn-500/10 text-warn-400",
  bad: "bg-bad-500/10 text-bad-400",
  neutral: "bg-white/5 text-mist-300",
};

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "brand",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: keyof typeof STAT_TONES;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-ink-850 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-mist-500">{label}</span>
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", STAT_TONES[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-1.5 text-xl font-semibold text-mist-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-mist-500">{hint}</p>}
    </div>
  );
}

export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-mist-100">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-mist-500">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function AdminLoading({ text = "加载中…" }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-xs text-mist-500">
      <Spinner className="h-4 w-4" />
      {text}
    </div>
  );
}

export function AdminErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-bad-500/30 bg-bad-500/10 px-4 py-8 text-center">
      <AlertTriangle className="h-6 w-6 text-bad-400" />
      <p className="text-xs text-bad-400">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

// ============ 表格 ============

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[680px] border-collapse text-left text-xs">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("whitespace-nowrap border-b border-white/5 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-mist-500", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-white/5 px-3 py-2.5 align-middle text-mist-300", className)}>{children}</td>;
}

export function AdminPagination({
  page,
  pageSize,
  total,
  loading,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 px-3 py-2.5 text-[11px] text-mist-400">
      <span>
        共 {total} 条 · 第 {Math.min(page, totalPages)}/{totalPages} 页
      </span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select
            value={String(pageSize)}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="h-7 rounded-lg border border-white/10 bg-ink-900 px-1.5 text-[11px] text-mist-300 outline-none focus:border-brand-500/60"
            aria-label="每页条数"
          >
            {[10, 20, 50].map((size) => (
              <option key={size} value={size} className="bg-ink-900">
                每页 {size} 条
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={() => onPage(page - 1)}>
          上一页
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>
          下一页
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ============ 通用展示 ============

export function roleTone(role: Role): "brand" | "warn" | "good" | "neutral" {
  if (role === "admin") return "brand";
  if (role === "moderator") return "warn";
  if (role === "guest") return "neutral";
  return "good";
}

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={roleTone(role)}>{ROLE_LABELS[role]}</Badge>;
}

export function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-good-400" : "bg-mist-500/50")} />
      <span className={online ? "text-good-400" : "text-mist-500"}>{online ? "在线" : "离线"}</span>
    </span>
  );
}

/** 审计操作类型中文名 */
export const ACTION_LABELS: Record<string, string> = {
  register: "注册账号",
  login: "登录",
  guest_login: "游客登录",
  password_change: "修改密码",
  room_create: "创建房间",
  room_update: "修改房间",
  room_delete: "删除房间",
  user_update: "修改用户",
  user_delete: "删除用户",
  user_kick: "踢出用户",
  user_mute: "强制静音",
  user_move: "移动用户",
  ban_create: "新增封禁",
  ban_revoke: "解除封禁",
  settings_update: "修改服务器设置",
  bootstrap_admin_create: "首次部署创建管理员",
  bootstrap_admin_promote: "提升为管理员",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** 规范化封禁记录的状态文案 */
export function banStatus(ban: BanRow): { label: string; tone: "good" | "warn" | "neutral" | "bad" } {
  if (!ban.active) return { label: "已解除", tone: "neutral" };
  if (ban.expiresAt) {
    const expires = Date.parse(ban.expiresAt);
    if (Number.isFinite(expires) && expires <= Date.now()) return { label: "已过期", tone: "neutral" };
    return { label: "生效中 · 至 " + formatDateTime(ban.expiresAt), tone: "bad" };
  }
  return { label: "永久生效", tone: "bad" };
}

export function banTarget(ban: BanRow): string {
  if (ban.username) return ban.username;
  if (ban.ip) return ban.ip;
  return "#" + ban.id;
}

// ============ 用户管理数据 ============

export interface ManagedUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  avatarColor: string;
  avatarEmoji: string | null;
  roomId: number | null;
  roomName: string | null;
  online: boolean;
  isBanned: boolean;
}

export function managedFromAdminUser(row: AdminUserRow): ManagedUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    isGuest: row.isGuest,
    avatarColor: row.avatarColor,
    avatarEmoji: row.avatarEmoji,
    roomId: row.roomId,
    roomName: row.roomName,
    online: row.online,
    isBanned: row.isBanned,
  };
}

export function managedFromOnlineUser(row: OnlineUser): ManagedUser {
  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    isGuest: row.isGuest,
    avatarColor: row.avatarColor,
    avatarEmoji: row.avatarEmoji,
    roomId: row.roomId,
    roomName: row.roomName,
    online: true,
    isBanned: false,
  };
}

/** 兼容服务端分页字段差异（共享类型为 items，服务端历史实现为 users） */
export function userPageRows(page: { items?: AdminUserRow[]; users?: AdminUserRow[] }): AdminUserRow[] {
  if (Array.isArray(page.items)) return page.items;
  if (Array.isArray(page.users)) return page.users;
  return [];
}

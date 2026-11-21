import type { ReactNode } from "react";
import type { AdminUserRow, BanRow, OnlineUser, Role } from "@airmic/shared";
import { ROLE_LABELS } from "@airmic/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Select, Skeleton, Spinner } from "@/components/ui";
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
  const hasHeader = Boolean(title || description || action);
  return (
    <Card className={cn("overflow-hidden", className)}>
      {hasHeader && <CardHeader title={title ?? ""} description={description} action={action} />}
      <div className={bodyClassName ?? "px-3 py-4 sm:px-5"}>{children}</div>
    </Card>
  );
}

export function AdminLoading({ text = "加载中…" }: { text?: string }) {
  return (
    <div className="space-y-3 px-5 py-5" aria-busy="true">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="h-3.5 w-3.5" />
        {text}
      </p>
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    </div>
  );
}

export function AdminErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert tone="error">
      <div className="flex flex-wrap items-center gap-3">
        <span>{message}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    </Alert>
  );
}

// ============ 表格（规范第 4 节） ============

export function TableShell({ children, className, stickyActions = false }: { children: ReactNode; className?: string; stickyActions?: boolean }) {
  return (
    <div className={cn("app-scroll overflow-x-auto", className)}>
      <table className={cn("w-full min-w-[40rem] border-separate border-spacing-0 text-sm",
        stickyActions && "max-sm:[&_tr>:last-child]:sticky max-sm:[&_tr>:last-child]:right-0 max-sm:[&_tr>:last-child]:z-10 max-sm:[&_tr>:last-child]:border-l max-sm:[&_tr>:last-child]:bg-card")}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground [&>th]:border-b">{children}</tr>
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="[&>tr:not(:last-child)>td]:border-b">{children}</tbody>;
}

export function Tr({
  children,
  className,
  onClick,
  title,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <tr onClick={onClick} title={title} className={cn("transition-colors hover:bg-muted/40", className)}>
      {children}
    </tr>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={cn("whitespace-nowrap px-3 py-2.5 text-left font-medium sm:px-4", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-3 py-3 align-middle text-foreground/90 sm:px-4", className)}>{children}</td>;
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
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
      <span className="tabular">
        共 {total} 条 · 第 {Math.min(page, totalPages)}/{totalPages} 页
      </span>
      <div className="flex flex-wrap items-end gap-2">
        {onPageSize && (
          <div className="w-36">
            <Select
              label="每页条数"
              options={[10, 20, 50].map((size) => ({ value: String(size), label: "每页 " + size + " 条" }))}
              value={String(pageSize)}
              disabled={loading}
              onChange={(event) => onPageSize(Number(event.target.value))}
            />
          </div>
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
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-success" : "bg-muted-foreground/40")} />
      <span className={online ? "text-success" : "text-muted-foreground"}>{online ? "在线" : "离线"}</span>
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
  room_area_create: "新增分区",
  room_area_update: "修改分区",
  room_area_delete: "删除分区",
  room_manager_grant: "授予房管权限",
  room_manager_revoke: "撤销房管权限",
  room_member_kick: "移出房间",
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

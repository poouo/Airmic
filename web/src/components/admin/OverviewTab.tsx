import { useState } from "react";
import type { OnlineUser } from "@airmic/shared";
import { Ban, DoorOpen, Ghost, LifeBuoy, LogOut, MessageSquare, MicOff, EarOff, Timer, TrendingUp, Users, Wifi, UserCog } from "lucide-react";
import { Avatar, Badge, Button, EmptyState, IconButton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDuration, formatRelative } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useAsyncData } from "./useAsyncData";
import UserManageModal from "./UserManageModal";
import {
  actionLabel,
  AdminErrorPanel,
  AdminLoading,
  managedFromOnlineUser,
  OnlineDot,
  RoleBadge,
  SectionCard,
  StatCard,
  TableShell,
  Td,
  Th,
  type ManagedUser,
} from "./shared";

export default function OverviewTab() {
  const self = useAuthStore((state) => state.user);
  const { data, loading, error, reload } = useAsyncData(() => api.admin.overview(), []);
  const [managed, setManaged] = useState<ManagedUser | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const canKick = self?.permissions.includes("kick_users") ?? false;
  const canModerate = self?.permissions.includes("moderate_voice") ?? false;

  const quickMute = async (user: OnlineUser) => {
    const confirmed = await useUiStore.getState().confirm({
      title: "强制静音",
      message: "确定强制静音「" + user.displayName + "」吗？对方在解除前无法发言。",
      confirmText: "强制静音",
    });
    if (!confirmed) return;
    setBusyUserId(user.userId);
    try {
      await api.admin.mute(user.userId, true);
      useUiStore.getState().toast("已强制静音「" + user.displayName + "」", "success");
      reload();
    } catch (caught) {
      useUiStore.getState().toast(errorMessage(caught), "error");
    } finally {
      setBusyUserId(null);
    }
  };

  const quickKick = async (user: OnlineUser) => {
    const confirmed = await useUiStore.getState().confirm({
      title: "踢出服务器",
      message: "确定将「" + user.displayName + "」踢出服务器吗？对方会被断开连接，但可以重新登录。",
      confirmText: "踢出服务器",
      danger: true,
    });
    if (!confirmed) return;
    setBusyUserId(user.userId);
    try {
      await api.admin.kick(user.userId, { scope: "server" });
      useUiStore.getState().toast("已踢出「" + user.displayName + "」", "success");
      reload();
    } catch (caught) {
      useUiStore.getState().toast(errorMessage(caught), "error");
    } finally {
      setBusyUserId(null);
    }
  };

  if (loading && !data) return <AdminLoading text="正在加载服务器概览…" />;
  if (error) return <AdminErrorPanel message={error} onRetry={reload} />;
  if (!data) return null;

  const { stats, onlineUsers, recentAudit, rooms } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard icon={Users} label="注册用户" value={stats.users} hint={"游客 " + stats.guests + " 个"} tone="brand" />
        <StatCard icon={Wifi} label="当前在线" value={stats.online} hint={"峰值 " + stats.peakOnline + " 人"} tone="good" />
        <StatCard icon={DoorOpen} label="房间数量" value={stats.rooms} hint="所有分类" tone="aqua" />
        <StatCard icon={MessageSquare} label="聊天消息" value={stats.messages} hint="历史累计" tone="neutral" />
        <StatCard icon={Ban} label="生效封禁" value={stats.activeBans} hint="账号与 IP" tone="bad" />
        <StatCard icon={Timer} label="运行时长" value={formatDuration(stats.uptimeSeconds)} hint={formatRelative(stats.startedAt) + "启动"} tone="warn" />
        <StatCard icon={Ghost} label="游客账号" value={stats.guests} hint="含历史游客" tone="neutral" />
        <StatCard icon={TrendingUp} label="平均每房" value={stats.rooms > 0 ? Math.round((stats.online / stats.rooms) * 10) / 10 : 0} hint="在线人数 / 房间" tone="brand" />
      </div>

      <SectionCard
        title="在线用户"
        description="实时在线用户与所在房间，可直接执行管理操作"
        action={<Button variant="outline" size="sm" onClick={reload} loading={loading}>刷新</Button>}
        bodyClassName="p-0"
      >
        {onlineUsers.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={<Wifi className="h-5 w-5" />} title="当前没有在线用户" description="用户连接后会自动出现在这里" />
          </div>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>用户</Th>
                <Th>角色</Th>
                <Th>所在房间</Th>
                <Th>语音状态</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {onlineUsers.map((user) => (
                <tr key={user.userId} className="transition-colors hover:bg-ink-750">
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="xs" speaking={user.speaking} muted={user.muted} deafened={user.deafened} />
                      <div className="min-w-0">
                        <p className={cn("truncate text-xs font-medium", user.speaking ? "text-aqua-400" : "text-mist-100")}>
                          {user.displayName}
                          {user.userId === self?.id && <span className="ml-1 text-[10px] text-mist-500">（你）</span>}
                        </p>
                        <p className="truncate text-[10px] text-mist-500">@{user.username}</p>
                      </div>
                    </div>
                  </Td>
                  <Td><RoleBadge role={user.role} /></Td>
                  <Td>
                    <span className="text-xs text-mist-300">{user.roomName ?? <span className="text-mist-500">大厅</span>}</span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {user.speaking && <Badge tone="brand">说话中</Badge>}
                      {user.muted && <Badge tone="bad"><MicOff className="h-3 w-3" />静音</Badge>}
                      {user.deafened && <Badge tone="warn"><EarOff className="h-3 w-3" />耳聋</Badge>}
                      {!user.speaking && !user.muted && !user.deafened && <span className="text-[11px] text-mist-500">正常</span>}
                    </div>
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canModerate && (
                        <IconButton label="强制静音" size="sm" disabled={user.userId === self?.id || busyUserId === user.userId} onClick={() => void quickMute(user)}>
                          <MicOff className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                      {canKick && (
                        <IconButton label="踢出服务器" size="sm" variant="danger" disabled={user.userId === self?.id || busyUserId === user.userId} onClick={() => void quickKick(user)}>
                          <LogOut className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                      <Button variant="outline" size="sm" icon={<UserCog className="h-3.5 w-3.5" />} onClick={() => setManaged(managedFromOnlineUser(user))}>
                        管理
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      <SectionCard title="最近审计" description="服务器最近 8 条管理操作记录" bodyClassName="p-0">
        {recentAudit.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={<LifeBuoy className="h-5 w-5" />} title="暂无审计记录" description="管理操作会自动记录在这里" />
          </div>
        ) : (
          <ul className="divide-y divide-ink-700/70">
            {recentAudit.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
                <span className="w-36 shrink-0 text-mist-500">{formatRelative(row.createdAt)}</span>
                <span className="shrink-0 font-medium text-mist-200">{row.actorName}</span>
                <Badge tone="brand">{actionLabel(row.action)}</Badge>
                {row.targetName && <span className="truncate text-mist-400">→ {row.targetName}</span>}
                {row.ip && <span className="ml-auto shrink-0 font-mono text-[10px] text-mist-500">{row.ip}</span>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {managed && (
        <UserManageModal
          user={managed}
          rooms={rooms}
          onClose={() => setManaged(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

import { useState } from "react";
import type { OnlineUser } from "@airmic/shared";
import { Ban, DoorOpen, EarOff, Ghost, LifeBuoy, LogOut, MessageSquare, MicOff, Timer, TrendingUp, UserCog, Users, Wifi } from "lucide-react";
import { Avatar, Badge, Button, EmptyState, IconButton, StatCard } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDuration, formatRelative } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useAsyncData } from "./useAsyncData";
import UserManageModal from "./UserManageModal";
import {
  actionLabel,
  AdminErrorPanel,
  AdminLoading,
  managedFromOnlineUser,
  RoleBadge,
  SectionCard,
  TableShell,
  TBody,
  Td,
  Th,
  THead,
  Tr,
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
        <StatCard icon={<Users />} label="注册用户" value={stats.users} hint={"游客 " + stats.guests + " 个"} />
        <StatCard icon={<Wifi />} label="当前在线" value={stats.online} hint={"峰值 " + stats.peakOnline + " 人"} />
        <StatCard icon={<DoorOpen />} label="房间数量" value={stats.rooms} hint="所有分类" />
        <StatCard icon={<MessageSquare />} label="聊天消息" value={stats.messages} hint="历史累计" />
        <StatCard icon={<Ban />} label="生效封禁" value={stats.activeBans} hint="账号与 IP" />
        <StatCard icon={<Timer />} label="运行时长" value={formatDuration(stats.uptimeSeconds)} hint={formatRelative(stats.startedAt) + "启动"} />
        <StatCard icon={<Ghost />} label="游客账号" value={stats.guests} hint="含历史游客" />
        <StatCard
          icon={<TrendingUp />}
          label="平均每房"
          value={stats.rooms > 0 ? Math.round((stats.online / stats.rooms) * 10) / 10 : 0}
          hint="在线人数 / 房间"
        />
      </div>

      <SectionCard
        title="在线用户"
        description="实时在线用户与所在房间，可直接执行管理操作"
        action={
          <Button variant="outline" size="sm" onClick={reload} loading={loading}>
            刷新
          </Button>
        }
        bodyClassName="p-0"
      >
        {onlineUsers.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState icon={<Wifi className="h-5 w-5" />} title="当前没有在线用户" description="用户连接后会自动出现在这里" />
          </div>
        ) : (
          <TableShell>
            <THead>
              <Th>用户</Th>
              <Th>角色</Th>
              <Th>所在房间</Th>
              <Th>语音状态</Th>
              <Th className="text-right">操作</Th>
            </THead>
            <TBody>
              {onlineUsers.map((user) => (
                <Tr key={user.userId}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="xs" speaking={user.speaking} muted={user.muted} deafened={user.deafened} />
                      <div className="min-w-0">
                        <p className={user.speaking ? "truncate text-sm font-medium text-success" : "truncate text-sm font-medium text-foreground"}>
                          {user.displayName}
                          {user.userId === self?.id && <span className="ml-1 text-[11px] font-normal text-muted-foreground">（你）</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <RoleBadge role={user.role} />
                  </Td>
                  <Td>
                    <span className="text-sm">{user.roomName ?? <span className="text-muted-foreground">大厅</span>}</span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {user.speaking && <Badge tone="brand">说话中</Badge>}
                      {user.muted && (
                        <Badge tone="bad">
                          <MicOff className="h-3 w-3" />静音
                        </Badge>
                      )}
                      {user.deafened && (
                        <Badge tone="warn">
                          <EarOff className="h-3 w-3" />耳聋
                        </Badge>
                      )}
                      {!user.speaking && !user.muted && !user.deafened && <span className="text-xs text-muted-foreground">正常</span>}
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
                </Tr>
              ))}
            </TBody>
          </TableShell>
        )}
      </SectionCard>

      <SectionCard title="最近审计" description="服务器最近 8 条管理操作记录" bodyClassName="p-0">
        {recentAudit.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState icon={<LifeBuoy className="h-5 w-5" />} title="暂无审计记录" description="管理操作会自动记录在这里" />
          </div>
        ) : (
          <TableShell>
            <THead>
              <Th>时间</Th>
              <Th>操作者</Th>
              <Th>操作</Th>
              <Th>目标</Th>
              <Th className="text-right">IP</Th>
            </THead>
            <TBody>
              {recentAudit.map((row) => (
                <Tr key={row.id}>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(row.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-sm font-medium text-foreground">{row.actorName}</Td>
                  <Td>
                    <Badge tone="brand">{actionLabel(row.action)}</Badge>
                  </Td>
                  <Td className="max-w-[16rem]">
                    <p className="truncate text-sm text-muted-foreground">{row.targetName ? "→ " + row.targetName : "-"}</p>
                  </Td>
                  <Td className="text-right font-mono text-[11px] text-muted-foreground">{row.ip ?? "-"}</Td>
                </Tr>
              ))}
            </TBody>
          </TableShell>
        )}
      </SectionCard>

      {managed && <UserManageModal user={managed} rooms={rooms} onClose={() => setManaged(null)} onChanged={reload} />}
    </div>
  );
}

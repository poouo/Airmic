import { useState } from "react";
import type { ReactNode } from "react";
import type { Role, RoomSummary } from "@airmic/shared";
import { ROLE_LABELS } from "@airmic/shared";
import { Ban, KeyRound, LogOut, MicOff, MoveRight, ShieldAlert, Trash2, UserRound, type LucideIcon } from "lucide-react";
import { Alert, Avatar, Badge, Button, Divider, Input, Modal, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { RoleBadge, OnlineDot, type ManagedUser } from "./shared";

export interface UserManageModalProps {
  user: ManagedUser;
  rooms: RoomSummary[];
  onClose: () => void;
  onChanged: () => void;
}

const BAN_DURATIONS = [
  { value: "60", label: "封禁 1 小时" },
  { value: "1440", label: "封禁 1 天" },
  { value: "10080", label: "封禁 7 天" },
  { value: "43200", label: "封禁 30 天" },
  { value: "0", label: "永久封禁" },
];

function GroupTitle({ icon: Icon, children, danger }: { icon: LucideIcon; children: ReactNode; danger?: boolean }) {
  return (
    <h3
      className={cn(
        "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]",
        danger ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </h3>
  );
}

export default function UserManageModal({ user, rooms, onClose, onChanged }: UserManageModalProps) {
  const self = useAuthStore((state) => state.user);
  const isSelf = self?.id === user.id;
  const canManageUsers = self?.permissions.includes("manage_users") ?? false;
  const canKick = self?.permissions.includes("kick_users") ?? false;
  const canModerate = self?.permissions.includes("moderate_voice") ?? false;
  const canBan = self?.permissions.includes("ban_users") ?? false;

  const [role, setRole] = useState<Role>(user.role);
  const [busy, setBusy] = useState<string | null>(null);
  const [kickScope, setKickScope] = useState<"server" | "room">("server");
  const [kickReason, setKickReason] = useState("");
  const [moveRoomId, setMoveRoomId] = useState(user.roomId === null ? "" : String(user.roomId));
  const [banDuration, setBanDuration] = useState("1440");
  const [banReason, setBanReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<void>, successText: string) => {
    setBusy(key);
    setActionError(null);
    try {
      await action();
      useUiStore.getState().toast(successText, "success");
      onChanged();
      onClose();
    } catch (caught) {
      const message = errorMessage(caught);
      setActionError(message);
      useUiStore.getState().toast(message, "error");
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async () => {
    if (role === user.role) return;
    const confirmed = await useUiStore.getState().confirm({
      title: "修改用户角色",
      message: "确定将「" + user.displayName + "」的角色从 " + ROLE_LABELS[user.role] + " 修改为 " + ROLE_LABELS[role] + " 吗？",
      confirmText: "修改角色",
      danger: user.role === "admin",
    });
    if (!confirmed) return;
    await run("role", async () => {
      await api.admin.updateUser(user.id, { role });
    }, "角色已更新");
  };

  const forceMute = async (muted: boolean) => {
    const confirmed = await useUiStore.getState().confirm({
      title: muted ? "强制静音" : "解除静音",
      message: muted ? "确定强制静音「" + user.displayName + "」吗？对方在解除前无法发言。" : "确定解除「" + user.displayName + "」的强制静音吗？",
      confirmText: muted ? "强制静音" : "解除静音",
    });
    if (!confirmed) return;
    await run("mute", async () => {
      await api.admin.mute(user.id, muted);
    }, muted ? "已强制静音" : "已解除静音");
  };

  const kick = async () => {
    const label = kickScope === "server" ? "踢出服务器" : "移出当前房间";
    const confirmed = await useUiStore.getState().confirm({
      title: label,
      message: "确定将「" + user.displayName + "」" + label + "吗？" + (kickScope === "server" ? "用户会被断开连接，但可以重新登录。" : ""),
      confirmText: label,
      danger: true,
    });
    if (!confirmed) return;
    await run("kick", async () => {
      await api.admin.kick(user.id, { scope: kickScope, reason: kickReason.trim() || undefined });
    }, "已执行" + label);
  };

  const move = async () => {
    const targetId = moveRoomId === "" ? null : Number(moveRoomId);
    const confirmed = await useUiStore.getState().confirm({
      title: "移动用户",
      message: "确定将「" + user.displayName + "」移动到" + (targetId === null ? "大厅" : "指定房间") + "吗？",
      confirmText: "移动",
    });
    if (!confirmed) return;
    await run("move", async () => {
      await api.admin.move(user.id, { roomId: targetId });
    }, "已移动用户");
  };

  const ban = async () => {
    if (!banReason.trim()) {
      setActionError("请填写封禁原因");
      return;
    }
    const confirmed = await useUiStore.getState().confirm({
      title: "封禁用户",
      message: "确定封禁「" + user.displayName + "」吗？封禁后该用户会被立即断开，且无法登录。",
      confirmText: "封禁",
      danger: true,
    });
    if (!confirmed) return;
    await run("ban", async () => {
      await api.admin.createBan({ userId: user.id, reason: banReason.trim(), durationMinutes: Number(banDuration) });
    }, "用户已封禁");
  };

  const removeUser = async () => {
    const confirmed = await useUiStore.getState().confirm({
      title: "删除用户账号",
      message: "确定永久删除「" + user.displayName + "」（@" + user.username + "）吗？该操作不可撤销，聊天记录会保留但发送者信息会丢失。",
      confirmText: "永久删除",
      danger: true,
    });
    if (!confirmed) return;
    await run("delete", async () => {
      await api.admin.deleteUser(user.id);
    }, "用户已删除");
  };

  const roomOptions = [{ value: "", label: "大厅（不在任何房间）" }, ...rooms.map((room) => ({ value: String(room.id), label: room.name }))];

  return (
    <Modal
      open
      onClose={onClose}
      title="管理用户"
      subtitle="对该用户执行管理操作，危险操作会二次确认"
      size="lg"
      footer={
        <Button variant="ghost" size="sm" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
          <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{user.displayName}</p>
              <RoleBadge role={user.role} />
              {user.isGuest && <Badge>游客</Badge>}
              {user.isBanned && <Badge tone="bad">已封禁</Badge>}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              @{user.username} · ID {user.id}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]">
              <OnlineDot online={user.online} />
              <span className="text-muted-foreground">所在位置：{user.roomName ?? "大厅"}</span>
            </div>
          </div>
        </div>

        {isSelf && (
          <Alert tone="warning">
            <span className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              这是你自己的账号，不能踢出、封禁或删除自己，也不能修改自己的角色。
            </span>
          </Alert>
        )}

        {actionError && <Alert tone="error">{actionError}</Alert>}

        {canManageUsers && (
          <section className="space-y-2.5">
            <GroupTitle icon={UserRound}>角色</GroupTitle>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem] flex-1">
                <Select
                  label="角色"
                  options={(["admin", "moderator", "user", "guest"] as Role[]).map((item) => ({ value: item, label: ROLE_LABELS[item] }))}
                  value={role}
                  disabled={isSelf}
                  onChange={(event) => setRole(event.target.value as Role)}
                />
              </div>
              <Button variant="secondary" size="sm" disabled={isSelf || role === user.role} loading={busy === "role"} onClick={() => void changeRole()}>
                保存角色
              </Button>
            </div>
            {user.role === "admin" && <p className="text-xs text-muted-foreground">管理员账号不可封禁；降级或删除时服务器会校验是否还有其它管理员。</p>}
          </section>
        )}

        {canModerate && (
          <section className="space-y-2.5">
            <GroupTitle icon={MicOff}>语音管理</GroupTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<MicOff className="h-3.5 w-3.5" />} disabled={!user.online || isSelf} loading={busy === "mute"} onClick={() => void forceMute(true)}>
                强制静音
              </Button>
              <Button variant="outline" size="sm" disabled={!user.online || isSelf} onClick={() => void forceMute(false)}>
                解除强制静音
              </Button>
            </div>
            {!user.online && <p className="text-xs text-muted-foreground">用户不在线，无法执行语音管理操作。</p>}
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
              <div className="min-w-[12rem] flex-1">
                <Select label="移动到" options={roomOptions} value={moveRoomId} onChange={(event) => setMoveRoomId(event.target.value)} />
              </div>
              <Button variant="secondary" size="sm" icon={<MoveRight className="h-3.5 w-3.5" />} loading={busy === "move"} disabled={!user.online || isSelf} onClick={() => void move()}>
                移动
              </Button>
            </div>
          </section>
        )}

        {canKick && (
          <section className="space-y-2.5">
            <GroupTitle icon={LogOut}>踢出</GroupTitle>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem] flex-1">
                <Select
                  label="踢出范围"
                  options={[
                    { value: "server", label: "踢出服务器" },
                    { value: "room", label: "移出当前房间" },
                  ]}
                  value={kickScope}
                  onChange={(event) => setKickScope(event.target.value === "room" ? "room" : "server")}
                />
              </div>
              <div className="min-w-[12rem] flex-[2]">
                <Input label="原因（可选）" value={kickReason} maxLength={200} placeholder="将展示给被踢出的用户" onChange={(event) => setKickReason(event.target.value)} />
              </div>
              <Button variant="danger" size="sm" disabled={!user.online || isSelf} loading={busy === "kick"} onClick={() => void kick()}>
                执行踢出
              </Button>
            </div>
          </section>
        )}

        {canBan && (
          <section className="space-y-2.5">
            <GroupTitle icon={Ban}>封禁</GroupTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select label="封禁时长" options={BAN_DURATIONS} value={banDuration} onChange={(event) => setBanDuration(event.target.value)} />
              <Input label="封禁原因" value={banReason} maxLength={200} placeholder="例如：刷屏、辱骂他人" onChange={(event) => setBanReason(event.target.value)} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{user.role === "admin" ? "管理员账号不可封禁。" : "封禁后该用户的登录会话会立即失效。"}</p>
              <Button variant="danger" size="sm" icon={<Ban className="h-3.5 w-3.5" />} disabled={isSelf || user.role === "admin"} loading={busy === "ban"} onClick={() => void ban()}>
                封禁用户
              </Button>
            </div>
          </section>
        )}

        {canManageUsers && (
          <section className="space-y-2.5">
            <Divider />
            <GroupTitle icon={ShieldAlert} danger>
              危险操作
            </GroupTitle>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">删除账号</p>
                <p className="mt-0.5 text-xs text-muted-foreground">永久删除该用户，不能删除自己或最后一名管理员。</p>
              </div>
              <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={isSelf} loading={busy === "delete"} onClick={() => void removeUser()}>
                删除账号
              </Button>
            </div>
          </section>
        )}

        {!canManageUsers && !canKick && !canModerate && !canBan && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
            <KeyRound className="h-4 w-4" />
            你当前没有可对用户执行的管理权限。
          </div>
        )}
      </div>
    </Modal>
  );
}

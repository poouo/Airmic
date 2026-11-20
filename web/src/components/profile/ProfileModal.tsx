import { useState } from "react";
import type { UserSelf } from "@airmic/shared";
import { ROLE_LABELS } from "@airmic/shared";
import { Check, KeyRound, Smile, UserRound } from "lucide-react";
import { Avatar, Badge, Button, Input, Modal } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

const AVATAR_COLORS = ["#6366f1", "#8b5cf6", "#d946ef", "#ec4899", "#f43f5e", "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#64748b"];
const AVATAR_EMOJIS = ["🎧", "🎮", "🎤", "🎵", "🔥", "⚡", "🌙", "🌟", "🐱", "🐶", "🦊", "🐼", "🐸", "🦄", "🤖", "👑", "🍕", "☕", "🚀", "🛸", "🎯", "💎", "🌈", "😎"];

/** 个人资料弹窗：昵称/头像/状态、修改密码、账号信息 */
export default function ProfileModal() {
  const modal = useUiStore((state) => state.modal);
  if (modal !== "profile") return null;
  return <ProfileModalContent />;
}

function ProfileModalContent() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const closeModal = useUiStore((state) => state.closeModal);
  if (!user) return null;
  return <ProfileModalBody user={user} setUser={setUser} onClose={closeModal} />;
}

function ProfileModalBody({ user, setUser, onClose }: { user: UserSelf; setUser: (user: UserSelf | null) => void; onClose: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [statusText, setStatusText] = useState(user.statusText);
  const [avatarColor, setAvatarColor] = useState(user.avatarColor);
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(user.avatarEmoji);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const saveProfile = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      setProfileError("昵称不能为空");
      return;
    }
    if (Array.from(trimmed).length > 24) {
      setProfileError("昵称最多 24 个字符");
      return;
    }
    if (Array.from(statusText).length > 60) {
      setProfileError("状态最多 60 个字符");
      return;
    }
    setProfileError(null);
    setSavingProfile(true);
    try {
      const result = await api.users.updateProfile({
        displayName: trimmed,
        statusText: statusText.trim(),
        avatarColor,
        avatarEmoji,
      });
      setUser(result.user);
      setDisplayName(result.user.displayName);
      setStatusText(result.user.statusText);
      setAvatarColor(result.user.avatarColor);
      setAvatarEmoji(result.user.avatarEmoji);
      useUiStore.getState().toast("个人资料已保存", "success");
    } catch (caught) {
      const message = errorMessage(caught);
      setProfileError(message);
      useUiStore.getState().toast(message, "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!currentPassword) {
      setPasswordError("请输入当前密码");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("新密码至少 6 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await api.users.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      useUiStore.getState().toast("密码已修改，其他设备的登录状态已退出", "success", "修改成功", 5000);
    } catch (caught) {
      const message = errorMessage(caught);
      setPasswordError(message);
      useUiStore.getState().toast(message, "error");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="个人资料"
      subtitle="修改昵称、头像与状态，或更新账号密码"
      size="xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={savingProfile}>
            关闭
          </Button>
          <Button size="sm" loading={savingProfile} onClick={() => void saveProfile()}>
            保存资料
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-ink-900/50 p-4 sm:flex-row sm:items-center">
          <Avatar name={displayName || user.displayName} color={avatarColor} emoji={avatarEmoji} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-lg font-semibold text-mist-100">{displayName.trim() || user.displayName}</p>
              <Badge tone={user.role === "admin" ? "brand" : user.role === "moderator" ? "warn" : user.role === "guest" ? "neutral" : "good"}>
                {ROLE_LABELS[user.role]}
              </Badge>
              {user.isGuest && <Badge>游客</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-mist-500">@{user.username}</p>
            {statusText && <p className="mt-1.5 line-clamp-2 text-xs text-mist-300">{statusText}</p>}
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-mist-500">
            <UserRound className="h-3.5 w-3.5" />
            基本资料
          </h3>
          {profileError && <div className="rounded-xl border border-bad-500/30 bg-bad-500/10 px-3 py-2 text-xs text-bad-400">{profileError}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="昵称" required value={displayName} maxLength={24} hint="1 - 24 个字符" onChange={(event) => setDisplayName(event.target.value)} />
            <Input label="状态" value={statusText} maxLength={60} placeholder="在做什么？" hint="最多 60 个字符" onChange={(event) => setStatusText(event.target.value)} />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-mist-300">头像颜色</p>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setAvatarColor(color)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-xl ring-2 transition-transform hover:scale-105",
                    avatarColor.toLowerCase() === color.toLowerCase() ? "ring-mist-200" : "ring-transparent",
                  )}
                  style={{ background: "linear-gradient(145deg, " + color + ", " + color + "88)", border: "1px solid " + color + "88" }}
                  aria-label={"选择颜色 " + color}
                >
                  {avatarColor.toLowerCase() === color.toLowerCase() && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-mist-300">头像表情</p>
              <button type="button" onClick={() => setAvatarEmoji(null)} className="flex items-center gap-1 text-[11px] text-mist-400 hover:text-mist-200">
                <Smile className="h-3 w-3" />
                使用昵称首字
              </button>
            </div>
            <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
              {AVATAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatarEmoji(avatarEmoji === emoji ? null : emoji)}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-lg text-base transition-colors",
                    avatarEmoji === emoji ? "bg-brand-500/25 ring-1 ring-brand-400/60" : "bg-white/5 hover:bg-white/10",
                  )}
                  aria-label={"选择表情 " + emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-mist-500">
            <KeyRound className="h-3.5 w-3.5" />
            修改密码
          </h3>
          {user.isGuest ? (
            <div className="rounded-xl border border-white/10 bg-ink-900/50 px-3 py-2.5 text-xs leading-relaxed text-mist-400">
              当前为游客账号，不支持设置密码。注册正式账号后即可修改密码并保存个人资料。
            </div>
          ) : (
            <>
              {passwordError && <div className="rounded-xl border border-bad-500/30 bg-bad-500/10 px-3 py-2 text-xs text-bad-400">{passwordError}</div>}
              <div className="grid gap-3 sm:grid-cols-3">
                <Input label="当前密码" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                <Input label="新密码" type="password" autoComplete="new-password" value={newPassword} hint="至少 6 位" onChange={(event) => setNewPassword(event.target.value)} />
                <Input label="确认新密码" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-mist-500">修改成功后，其他设备上的登录状态将被退出。</p>
                <Button variant="secondary" size="sm" loading={savingPassword} onClick={() => void changePassword()}>
                  修改密码
                </Button>
              </div>
            </>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-mist-500">账号信息</h3>
          <div className="grid gap-2 rounded-2xl border border-white/5 bg-ink-900/40 p-3 text-xs sm:grid-cols-2">
            <InfoRow label="用户名" value={user.username} />
            <InfoRow label="昵称" value={user.displayName} />
            <InfoRow label="角色" value={ROLE_LABELS[user.role]} />
            <InfoRow label="注册时间" value={formatDateTime(user.createdAt)} />
            <InfoRow label="账号类型" value={user.isGuest ? "游客账号" : "注册账号"} />
            <InfoRow label="用户 ID" value={String(user.id)} />
          </div>
        </section>
      </div>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-ink-800/70 px-2.5 py-1.5">
      <span className="text-mist-500">{label}</span>
      <span className="truncate font-medium text-mist-200">{value}</span>
    </div>
  );
}

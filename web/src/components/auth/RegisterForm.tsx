import { useState, type FormEvent } from "react";
import type { RegistrationMode } from "@airmic/shared";
import { Lock, ShieldCheck, UserPlus } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useAuthStore } from "@/stores/auth";

export interface RegisterFormProps {
  registrationMode: RegistrationMode;
  setupRequired: boolean;
}

export default function RegisterForm({ registrationMode, setupRequired }: RegisterFormProps) {
  const submitting = useAuthStore((state) => state.submitting);
  const register = useAuthStore((state) => state.register);
  const closed = registrationMode === "closed" && !setupRequired;

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (closed) return;
    const trimmedUsername = username.trim();
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(trimmedUsername)) {
      setLocalError("用户名需为 3 - 24 位字母、数字、下划线或短横线");
      return;
    }
    if (displayName.trim().length > 24) {
      setLocalError("昵称最多 24 个字符");
      return;
    }
    if (password.length < 6) {
      setLocalError("密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      setLocalError("两次输入的密码不一致");
      return;
    }
    if (registrationMode === "invite" && !setupRequired && !inviteCode.trim()) {
      setLocalError("请输入邀请码");
      return;
    }
    setLocalError(null);
    try {
      await register({
        username: trimmedUsername,
        password,
        displayName: displayName.trim() || undefined,
        inviteCode: registrationMode === "invite" && !setupRequired ? inviteCode.trim() : undefined,
      });
    } catch {
      /* 错误由 authStore.error 展示 */
    }
  };

  if (closed) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-warn-500/30 bg-warn-500/10 px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warn-400">
            <Lock className="h-4 w-4" />
            服务器已暂停注册
          </p>
          <p className="mt-1 text-xs leading-relaxed text-mist-300">当前仅允许已有账号登录；如需注册请联系服务器管理员，或使用游客身份进入。</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3.5">
      {setupRequired && (
        <div className="rounded-xl border border-aqua-400/30 bg-aqua-400/10 px-3 py-2.5 text-xs leading-relaxed text-mist-300">
          <span className="flex items-center gap-1.5 font-medium text-aqua-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            首个账号将成为管理员
          </span>
          服务器还没有管理员，完成注册后你将获得全部管理权限。
        </div>
      )}
      {localError && <div className="rounded-xl border border-bad-500/30 bg-bad-500/10 px-3 py-2 text-xs text-bad-400">{localError}</div>}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Input label="用户名" required autoComplete="username" value={username} maxLength={24} placeholder="登录账号" hint="3-24 位字母/数字/_/-" onChange={(event) => setUsername(event.target.value)} />
        <Input label="昵称" autoComplete="nickname" value={displayName} maxLength={24} placeholder="显示名称（选填）" hint="留空则使用用户名" onChange={(event) => setDisplayName(event.target.value)} />
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Input label="密码" required type="password" autoComplete="new-password" value={password} maxLength={128} placeholder="至少 6 位" onChange={(event) => setPassword(event.target.value)} />
        <Input label="确认密码" required type="password" autoComplete="new-password" value={confirm} maxLength={128} placeholder="再次输入密码" onChange={(event) => setConfirm(event.target.value)} />
      </div>
      {registrationMode === "invite" && (
        <Input label="邀请码" required value={inviteCode} maxLength={32} placeholder="请输入管理员提供的邀请码" onChange={(event) => setInviteCode(event.target.value)} />
      )}
      <Button type="submit" size="lg" fullWidth loading={submitting} icon={<UserPlus className="h-4 w-4" />}>
        注册并进入
      </Button>
    </form>
  );
}

import { useState, type FormEvent } from "react";
import type { RegistrationMode } from "@airmic/shared";
import { UserPlus } from "lucide-react";
import { Alert, Button, Input } from "@/components/ui";
import { useAuthStore } from "@/stores/auth";

export interface RegisterFormProps {
  registrationMode: RegistrationMode;
}

export default function RegisterForm({ registrationMode }: RegisterFormProps) {
  const submitting = useAuthStore((state) => state.submitting);
  const register = useAuthStore((state) => state.register);
  const guestName = useAuthStore((state) => state.user?.isGuest ? state.user.displayName : "");
  const closed = registrationMode === "closed";

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState(guestName);
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
    if (registrationMode === "invite" && !inviteCode.trim()) {
      setLocalError("请输入邀请码");
      return;
    }
    setLocalError(null);
    try {
      await register({
        username: trimmedUsername,
        password,
        displayName: displayName.trim() || undefined,
        inviteCode: registrationMode === "invite" ? inviteCode.trim() : undefined,
      });
    } catch {
      /* 错误由 authStore.error 展示 */
    }
  };

  if (closed) {
    return (
      <Alert tone="warning">服务器已暂停注册</Alert>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      {localError && <Alert tone="error">{localError}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="用户名"
          required
          autoComplete="username"
          value={username}
          maxLength={24}
          placeholder="登录账号"
          hint="3-24 位字母/数字/_/-"
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          label="昵称"
          autoComplete="nickname"
          value={displayName}
          maxLength={24}
          placeholder="显示名称（选填）"
          hint="留空则使用用户名"
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="密码"
          required
          type="password"
          autoComplete="new-password"
          value={password}
          maxLength={128}
          placeholder="至少 6 位"
          onChange={(event) => setPassword(event.target.value)}
        />
        <Input
          label="确认密码"
          required
          type="password"
          autoComplete="new-password"
          value={confirm}
          maxLength={128}
          placeholder="再次输入密码"
          onChange={(event) => setConfirm(event.target.value)}
        />
      </div>
      {registrationMode === "invite" && (
        <Input
          label="邀请码"
          required
          value={inviteCode}
          maxLength={32}
          placeholder="请输入管理员提供的邀请码"
          onChange={(event) => setInviteCode(event.target.value)}
        />
      )}
      <Button type="submit" size="lg" fullWidth loading={submitting} icon={<UserPlus className="h-4 w-4" />}>
        注册并进入
      </Button>
    </form>
  );
}

import { useState, type FormEvent } from "react";
import { Ghost, UserRound } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useAuthStore } from "@/stores/auth";

export interface GuestFormProps {
  guestEnabled: boolean;
}

export default function GuestForm({ guestEnabled }: GuestFormProps) {
  const submitting = useAuthStore((state) => state.submitting);
  const guest = useAuthStore((state) => state.guest);
  const [displayName, setDisplayName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!guestEnabled) return;
    const trimmed = displayName.trim();
    if (!trimmed) {
      setLocalError("请输入游客昵称");
      return;
    }
    if (Array.from(trimmed).length > 24) {
      setLocalError("昵称最多 24 个字符");
      return;
    }
    setLocalError(null);
    try {
      await guest(trimmed);
    } catch {
      /* 错误由 authStore.error 展示 */
    }
  };

  if (!guestEnabled) {
    return (
      <div className="rounded-xl border border-white/10 bg-ink-900/60 px-4 py-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-mist-200">
          <Ghost className="h-4 w-4 text-mist-400" />
          服务器未开放游客模式
        </p>
        <p className="mt-1 text-xs leading-relaxed text-mist-400">管理员已关闭游客登录，请注册账号或使用已有账号登录。</p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-ink-900/60 px-3 py-2.5 text-xs leading-relaxed text-mist-400">
        <Ghost className="mr-1 inline h-3.5 w-3.5 text-aqua-400" />
        游客身份无需密码即可进入，可收听语音与加入房间，具体权限由服务器管理员配置。
      </div>
      {localError && <div className="rounded-xl border border-bad-500/30 bg-bad-500/10 px-3 py-2 text-xs text-bad-400">{localError}</div>}
      <Input
        label="游客昵称"
        required
        autoFocus
        value={displayName}
        maxLength={24}
        placeholder="给自己起个名字"
        leftIcon={<UserRound className="h-4 w-4" />}
        hint="1 - 24 个字符，其他用户将看到这个昵称"
        onChange={(event) => {
          setDisplayName(event.target.value);
          setLocalError(null);
        }}
      />
      <Button type="submit" size="lg" fullWidth loading={submitting} icon={<Ghost className="h-4 w-4" />}>
        以游客身份进入
      </Button>
    </form>
  );
}

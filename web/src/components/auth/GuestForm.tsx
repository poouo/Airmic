import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Ghost, UserRound } from "lucide-react";
import { Alert, Button, Input } from "@/components/ui";
import { useAuthStore } from "@/stores/auth";

export interface GuestFormProps {
  guestEnabled: boolean;
}

export default function GuestForm({ guestEnabled }: GuestFormProps) {
  const navigate = useNavigate();
  const submitting = useAuthStore((state) => state.submitting);
  const guest = useAuthStore((state) => state.guest);
  const alreadyGuest = useAuthStore((state) => state.user?.isGuest === true);
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
      navigate("/", { replace: true });
    } catch {
      /* 错误由 authStore.error 展示 */
    }
  };

  if (alreadyGuest) return <Button size="lg" fullWidth onClick={() => navigate("/", { replace: true })}>返回大厅</Button>;

  if (!guestEnabled) {
    return (
      <Alert tone="warning" title="服务器未开放游客模式">
        管理员已关闭游客登录，请注册账号或使用已有账号登录。
      </Alert>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      {localError && <Alert tone="error">{localError}</Alert>}
      <Input
        label="游客昵称"
        required
        autoFocus
        value={displayName}
        maxLength={24}
        placeholder="给自己起个名字"
        leftIcon={<UserRound className="h-4 w-4" />}
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

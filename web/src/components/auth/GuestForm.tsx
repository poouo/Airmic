import { useState, type FormEvent } from "react";
import { Ghost, UserRound } from "lucide-react";
import { Alert, Button, Input } from "@/components/ui";
import { randomGuestName, readStoredGuestName, useAuthStore } from "@/stores/auth";

export default function GuestForm() {
  const submitting = useAuthStore((state) => state.submitting);
  const guest = useAuthStore((state) => state.guest);
  const [displayName, setDisplayName] = useState(() => readStoredGuestName() ?? randomGuestName());
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      {localError && <Alert tone="error">{localError}</Alert>}
      <Input
        label="游客昵称"
        required
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

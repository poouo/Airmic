import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LogIn, User } from "lucide-react";
import { Alert, Button, IconButton, Input } from "@/components/ui";
import { useAuthStore } from "@/stores/auth";

export default function LoginForm() {
  const submitting = useAuthStore((state) => state.submitting);
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setLocalError("请输入用户名和密码");
      return;
    }
    setLocalError(null);
    try {
      await login(username.trim(), password);
    } catch {
      /* 错误由 authStore.error 展示 */
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      {localError && <Alert tone="error">{localError}</Alert>}
      <Input
        label="用户名"
        autoComplete="username"
        autoFocus
        leftIcon={<User className="h-4 w-4" />}
        value={username}
        maxLength={64}
        placeholder="请输入用户名"
        onChange={(event) => {
          setUsername(event.target.value);
          setLocalError(null);
        }}
      />
      <Input
        label="密码"
        type={visible ? "text" : "password"}
        autoComplete="current-password"
        value={password}
        maxLength={128}
        placeholder="请输入密码"
        rightSlot={
          <IconButton
            label={visible ? "隐藏密码" : "显示密码"}
            size="sm"
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </IconButton>
        }
        onChange={(event) => {
          setPassword(event.target.value);
          setLocalError(null);
        }}
      />
      <Button type="submit" size="lg" fullWidth loading={submitting} icon={<LogIn className="h-4 w-4" />}>
        登录
      </Button>
    </form>
  );
}

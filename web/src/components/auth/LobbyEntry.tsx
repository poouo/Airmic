import { useState } from "react";
import { Ghost, LogIn, UserPlus } from "lucide-react";
import { Alert, Button, Spinner, Tabs, type TabItem } from "@/components/ui";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import GuestForm from "./GuestForm";
import LoginForm from "./LoginForm";
import RegisterForm from "./RegisterForm";

const options: TabItem[] = [
  { id: "guest", label: "游客", icon: Ghost },
  { id: "login", label: "登录", icon: LogIn },
  { id: "register", label: "注册", icon: UserPlus },
];

export default function LobbyEntry() {
  const server = useAppStore((state) => state.server);
  const loading = useAppStore((state) => state.loadingServer || !state.bootstrapped);
  const reload = useAppStore((state) => state.loadServerInfo);
  const error = useAuthStore((state) => state.error);
  const submitting = useAuthStore((state) => state.submitting);
  const clearError = useAuthStore((state) => state.clearError);
  const [selected, setSelected] = useState("guest");
  const active = selected === "guest" && !server?.guestEnabled ? "login" : selected;

  return (
    <section className="mx-auto w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6" aria-labelledby="lobby-entry-title">
      <h2 id="lobby-entry-title" className="text-base font-semibold">进入语音大厅</h2>
      {server ? (
        <>
          <Tabs items={options.filter((item) => item.id !== "guest" || server.guestEnabled)} value={active} onChange={(tab) => {
            if (submitting) return;
            clearError();
            setSelected(tab);
          }} />
          {error && <Alert tone="error">{error}</Alert>}
          {active === "guest" && <GuestForm />}
          {active === "login" && <LoginForm />}
          {active === "register" && <RegisterForm registrationMode={server.registrationMode} />}
        </>
      ) : loading ? (
        <Spinner />
      ) : (
        <>
          <Alert tone="error">无法连接服务器</Alert>
          <Button variant="outline" onClick={() => void reload()}>重试</Button>
        </>
      )}
    </section>
  );
}

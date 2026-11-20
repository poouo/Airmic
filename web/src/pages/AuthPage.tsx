import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Ghost, LogIn, Mic, ServerOff, UserPlus } from "lucide-react";
import { Alert, Badge, Button, Spinner, Tabs, type TabItem } from "@/components/ui";
import ThemeToggle from "@/components/layout/ThemeToggle";
import AuthBrandPanel from "@/components/auth/AuthBrandPanel";
import GuestForm from "@/components/auth/GuestForm";
import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import { cn } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";

type AuthTab = "login" | "register" | "guest";

const TAB_ITEMS: TabItem[] = [
  { id: "login", label: "登录", icon: LogIn },
  { id: "register", label: "注册", icon: UserPlus },
  { id: "guest", label: "游客", icon: Ghost },
];

export default function AuthPage() {
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);
  const server = useAppStore((state) => state.server);
  const setupRequired = useAppStore((state) => state.setupRequired);
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const loadingServer = useAppStore((state) => state.loadingServer);
  const onlineCount = useAppStore((state) => state.onlineUsers.length);
  const roomCount = useAppStore((state) => state.rooms.length);

  const [tab, setTab] = useState<AuthTab>("login");

  useEffect(() => {
    if (setupRequired) setTab("register");
  }, [setupRequired]);

  if (status === "authenticated") return <Navigate to="/" replace />;

  const registrationMode = server?.registrationMode ?? "open";
  const guestEnabled = server?.guestEnabled ?? false;
  const ready = bootstrapped && server !== null;
  const showSetupHint = setupRequired && !server;

  const handleTabChange = (id: string) => {
    setTab(id as AuthTab);
    clearError();
  };

  return (
    <div className="app-canvas relative flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Mic className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-foreground">AirMic</h1>
              <Badge tone="brand">v{server?.version ?? "1.0.0"}</Badge>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">网页语音开黑 · 打开即聊</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 pb-10 sm:px-6">
        <div className="mx-auto grid w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-card lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_27.5rem]">
          <AuthBrandPanel
            server={server}
            onlineCount={onlineCount}
            roomCount={roomCount}
            setupRequired={setupRequired}
            className="hidden lg:flex"
          />

          <div className="flex flex-col border-border bg-card p-5 sm:p-7 lg:border-l">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">进入服务器</h2>
                <p className="mt-1 truncate text-xs text-muted-foreground">{server?.name ?? "AirMic 语音服务器"}</p>
              </div>
              <Badge tone={server ? "good" : "neutral"}>{server ? "服务器在线" : "等待服务器信息"}</Badge>
            </div>

            <Tabs items={TAB_ITEMS} value={tab} onChange={handleTabChange} className="mb-5" />

            {error && (
              <div className="mb-4" role="alert">
                <Alert tone="error">{error}</Alert>
              </div>
            )}

            <div className="flex flex-1 flex-col justify-center">
              {!ready ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8">
                  {loadingServer || !bootstrapped ? (
                    <div className="flex flex-col items-center justify-center gap-3 text-center">
                      <Spinner className="h-5 w-5" />
                      <p className="text-xs text-muted-foreground">正在获取服务器信息…</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 text-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <ServerOff className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">无法连接服务器</p>
                        <p className="mt-1 text-xs text-muted-foreground">请确认后端服务已启动，然后重试</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={loadingServer}
                        onClick={() => void useAppStore.getState().loadServerInfo()}
                      >
                        重新加载
                      </Button>
                      <div className="mt-1 w-full border-t border-border pt-4 text-left">
                        {tab === "login" && <LoginForm />}
                        {tab === "register" && <RegisterForm registrationMode={registrationMode} setupRequired={showSetupHint} />}
                        {tab === "guest" && <GuestForm guestEnabled={guestEnabled} />}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {tab === "login" && <LoginForm />}
                  {tab === "register" && <RegisterForm registrationMode={registrationMode} setupRequired={setupRequired} />}
                  {tab === "guest" && <GuestForm guestEnabled={guestEnabled} />}
                </>
              )}
            </div>

            <p className={cn("mt-5 text-center text-[11px] leading-relaxed text-muted-foreground", !ready && "opacity-70")}>
              登录即表示同意遵守服务器规则 · AirMic {server?.version ?? "1.0.0"} · WebRTC 网页语音
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

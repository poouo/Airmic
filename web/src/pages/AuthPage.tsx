import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Ghost, LogIn, ServerOff, UserPlus } from "lucide-react";
import { Alert, Button, Spinner, Tabs, type TabItem } from "@/components/ui";
import ThemeToggle from "@/components/layout/ThemeToggle";
import AirMicMark from "@/components/brand/AirMicMark";
import AuthBrandPanel from "@/components/auth/AuthBrandPanel";
import GuestForm from "@/components/auth/GuestForm";
import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
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
  const currentUser = useAuthStore((state) => state.user);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);
  const server = useAppStore((state) => state.server);
  const setupRequired = useAppStore((state) => state.setupRequired);
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const loadingServer = useAppStore((state) => state.loadingServer);

  const [tab, setTab] = useState<AuthTab>("login");

  useEffect(() => {
    if (setupRequired) setTab("register");
  }, [setupRequired]);

  // 游客允许打开登录页（用于切换/升级账号），已登录的正式账号才回首页
  if (status === "authenticated" && !currentUser?.isGuest) return <Navigate to="/" replace />;

  const registrationMode = server?.registrationMode ?? "open";
  const guestEnabled = server?.guestEnabled ?? false;
  const ready = bootstrapped && server !== null;
  const showSetupHint = setupRequired && !server;

  const handleTabChange = (id: string) => {
    setTab(id as AuthTab);
    clearError();
  };

  return (
    <div className="page-frame app-canvas relative flex flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <AirMicMark size={36} />
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-foreground">AirMic</h1>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 pb-10 sm:px-6">
        <div className="mx-auto grid w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-card lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_27.5rem]">
          <AuthBrandPanel server={server} />

          <div className="flex flex-col border-border bg-card p-5 sm:p-7 lg:border-l">
            <h2 className="mb-4 break-words text-xl font-semibold tracking-tight text-foreground lg:hidden">{server?.name ?? "AirMic 语音服务器"}</h2>

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
                      <p className="text-xs text-muted-foreground">连接中…</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 text-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <ServerOff className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">无法连接服务器</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={loadingServer}
                        onClick={() => void useAppStore.getState().loadServerInfo()}
                      >
                        重试
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

          </div>
        </div>
      </main>
    </div>
  );
}

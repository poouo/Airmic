import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Ghost, LogIn, ServerOff, UserPlus } from "lucide-react";
import { Badge, Button, Spinner, Tabs, type TabItem } from "@/components/ui";
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
    <div className="relative min-h-screen overflow-hidden bg-ink-950">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-80" />
      <div className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-48 -right-32 h-[28rem] w-[28rem] rounded-full bg-aqua-500/10 blur-[120px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center gap-10 px-4 py-10 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
        <AuthBrandPanel server={server} onlineCount={onlineCount} roomCount={roomCount} setupRequired={setupRequired} className="w-full" />

        <div className="w-full max-w-md shrink-0">
          <div className="glass-panel rounded-3xl p-5 shadow-2xl shadow-black/50 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-mist-100">进入服务器</h2>
              <Badge tone={server ? "good" : "neutral"}>{server ? "服务器在线" : "等待服务器信息"}</Badge>
            </div>

            <Tabs items={TAB_ITEMS} value={tab} onChange={handleTabChange} className="mb-4" />

            {error && (
              <div className="mb-4 rounded-xl border border-bad-500/30 bg-bad-500/10 px-3 py-2.5 text-xs leading-relaxed text-bad-400" role="alert">
                {error}
              </div>
            )}

            {!ready ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10">
                {loadingServer || !bootstrapped ? (
                  <>
                    <Spinner />
                    <p className="text-xs text-mist-500">正在获取服务器信息…</p>
                  </>
                ) : (
                  <>
                    <ServerOff className="h-8 w-8 text-mist-500" />
                    <p className="text-sm text-mist-300">无法连接服务器</p>
                    <p className="text-xs text-mist-500">请确认后端服务已启动，然后重试</p>
                    <Button variant="outline" size="sm" loading={loadingServer} onClick={() => void useAppStore.getState().loadServerInfo()}>
                      重新加载
                    </Button>
                    <div className="mt-2 w-full border-t border-white/5 pt-4">
                      {tab === "login" && <LoginForm />}
                      {tab === "register" && <RegisterForm registrationMode={registrationMode} setupRequired={showSetupHint} />}
                      {tab === "guest" && <GuestForm guestEnabled={guestEnabled} />}
                    </div>
                  </>
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

          <p className={cn("mt-4 text-center text-[11px] leading-relaxed text-mist-500", !ready && "opacity-70")}>
            登录即表示同意遵守服务器规则 · AirMic {server?.version ?? "1.0.0"} · WebRTC 网页语音
          </p>
        </div>
      </div>
    </div>
  );
}

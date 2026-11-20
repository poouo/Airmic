import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { Mic } from "lucide-react";

/** 初始化向导的外层深色布局（与登录页风格一致） */
export default function SetupShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-950">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-80" />
      <div className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-48 -right-32 h-[28rem] w-[28rem] rounded-full bg-aqua-500/10 blur-[120px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-4 py-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-aqua-500 shadow-lg shadow-brand-500/30">
              <Mic className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-mist-100">
                Air<span className="text-gradient">Mic</span>
                <span className="ml-2 text-sm font-medium text-mist-300">初始化向导</span>
              </h1>
              <p className="text-[11px] text-mist-500">首次部署配置 · 完成后自动登录管理员账号</p>
            </div>
          </div>
          <Badge tone="brand">首次部署</Badge>
        </header>

        <div className="glass-panel rounded-3xl p-4 shadow-2xl shadow-black/50 sm:p-6">{children}</div>

        <p className="text-center text-[11px] leading-relaxed text-mist-500">配置完成后可使用管理员账号登录 · 语音由你自己的 LiveKit 服务器中转 · AirMic</p>
      </div>
    </div>
  );
}

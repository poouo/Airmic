import type { ReactNode } from "react";
import { Mic } from "lucide-react";
import { Badge } from "@/components/ui";
import ThemeToggle from "@/components/layout/ThemeToggle";

/** 初始化向导的外层布局：浅色中性底 + 顶部品牌 + 白色宽卡片 */
export default function SetupShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-canvas relative flex min-h-screen flex-col bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-6 px-4 py-10 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Mic className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight text-foreground">
                AirMic
                <span className="text-sm font-normal text-muted-foreground">初始化向导</span>
              </h1>
              <p className="truncate text-[11px] text-muted-foreground">首次部署配置 · 完成后自动登录管理员账号</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Badge tone="brand">首次部署</Badge>
          </div>
        </header>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">{children}</div>

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">配置完成后可使用管理员账号登录 · 语音由你自己的 LiveKit 服务器中转 · AirMic</p>
      </div>
    </div>
  );
}

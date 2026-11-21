import type { ReactNode } from "react";
import AirMicMark from "@/components/brand/AirMicMark";
import ThemeToggle from "@/components/layout/ThemeToggle";

/** 初始化向导的外层布局：浅色中性底 + 顶部品牌 + 白色宽卡片 */
export default function SetupShell({ children }: { children: ReactNode }) {
  return (
    <div className="page-frame app-canvas relative flex flex-col bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <AirMicMark size={40} />
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight text-foreground">
                AirMic
                <span className="text-sm font-normal text-muted-foreground">初始化向导</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-raised sm:p-6">{children}</div>
      </div>
    </div>
  );
}

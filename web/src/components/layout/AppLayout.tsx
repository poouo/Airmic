import { useEffect } from "react";
import { Mic, X } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";
import { IconButton } from "@/components/ui";
import { useUiStore } from "@/stores/ui";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

/** 主界面布局：顶栏 + 左侧房间/在线用户/用户卡片 + 内容区；移动端侧栏为抽屉 */
export default function AppLayout() {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar onOpenSidebar={() => setSidebarOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          <Sidebar />
        </aside>
        <main className="app-canvas relative min-w-0 flex-1 overflow-y-auto app-scroll">
          <Outlet />
        </main>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px] animate-fade-in dark:bg-black/50" onClick={() => setSidebarOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col border-r border-sidebar-border bg-sidebar shadow-popover animate-rise-in">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
              <span className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Mic className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold tracking-tight">AirMic</span>
              </span>
              <IconButton label="关闭侧栏" size="sm" onClick={() => setSidebarOpen(false)}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="flex min-h-0 flex-1">
              <Sidebar onNavigate={() => setSidebarOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

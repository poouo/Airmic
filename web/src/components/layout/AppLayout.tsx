import { useEffect } from "react";
import { X } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";
import AirMicMark from "@/components/brand/AirMicMark";
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
    <div className="app-frame flex flex-col overflow-hidden bg-card text-foreground">
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
        <div className="viewport-overlay z-40 flex lg:hidden">
          <button type="button" aria-label="关闭侧栏遮罩" className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => setSidebarOpen(false)} />
          <div role="dialog" aria-label="房间导航" aria-modal="true" className="relative flex min-h-0 w-[min(86vw,20rem)] flex-col border-r border-sidebar-border bg-sidebar shadow-popover animate-rise-in">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
              <span className="flex items-center gap-2.5">
                <AirMicMark size={28} />
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

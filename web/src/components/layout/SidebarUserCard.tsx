import { LogOut, Settings } from "lucide-react";
import { Avatar, IconButton } from "@/components/ui";
import { ROLE_LABELS } from "@airmic/shared";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

export default function SidebarUserCard() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const openModal = useUiStore((state) => state.openModal);
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = async () => {
    const confirmed = await useUiStore.getState().confirm({
      title: "退出登录",
      message: "退出后会离开语音房间。",
      confirmText: "退出登录",
    });
    if (!confirmed) return;
    await logout();
    useUiStore.getState().toast("已退出登录", "info");
    navigate("/", { replace: true, state: null });
  };

  return (
    <div className="shrink-0 border-t border-sidebar-border p-2">
      <div className="flex items-center gap-1.5 rounded-xl border border-sidebar-border bg-card p-1.5">
        <button
          type="button"
          onClick={() => openModal("profile")}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          title="编辑个人资料"
        >
          <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium leading-tight text-foreground">{user.displayName}</span>
            <span className="block truncate text-[10px] leading-tight text-muted-foreground">{user.statusText || ROLE_LABELS[user.role]}</span>
          </span>
        </button>
        <IconButton label="语音设置" size="sm" onClick={() => openModal("settings")} className="h-7 w-7">
          <Settings className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="退出登录" size="sm" variant="danger" onClick={() => void handleLogout()} className="h-7 w-7">
          <LogOut className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

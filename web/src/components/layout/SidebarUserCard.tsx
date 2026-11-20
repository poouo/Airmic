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
      message: "确定要退出当前账号吗？退出后将断开实时语音连接。",
      confirmText: "退出登录",
    });
    if (!confirmed) return;
    await logout();
    useUiStore.getState().toast("已退出登录", "info");
    navigate("/login", { replace: true });
  };

  return (
    <div className="shrink-0 border-t border-white/5 p-2.5">
      <div className="flex items-center gap-2 rounded-xl bg-ink-800/70 p-1.5 ring-1 ring-white/5">
        <button
          type="button"
          onClick={() => openModal("profile")}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-brand-400"
          title="编辑个人资料"
        >
          <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-mist-100">{user.displayName}</span>
            <span className="block truncate text-[10px] text-mist-500">{user.statusText || ROLE_LABELS[user.role]}</span>
          </span>
        </button>
        <IconButton label="语音设置" size="sm" onClick={() => openModal("settings")}>
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="退出登录" size="sm" variant="danger" onClick={() => void handleLogout()}>
          <LogOut className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

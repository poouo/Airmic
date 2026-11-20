import { useEffect, useRef, useState } from "react";
import type { Permission } from "@airmic/shared";
import { ChevronDown, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar, Badge } from "@/components/ui";
import { ROLE_LABELS } from "@airmic/shared";
import { cn } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

const ADMIN_PERMISSIONS: Permission[] = ["manage_server", "manage_rooms", "manage_users", "view_audit", "ban_users"];

export default function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const openModal = useUiStore((state) => state.openModal);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!user) return null;
  const canAdmin = ADMIN_PERMISSIONS.some((permission) => user.permissions.includes(permission));

  const handleLogout = async () => {
    setOpen(false);
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex items-center gap-2 rounded-xl px-1.5 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-400",
          open ? "bg-white/5" : "hover:bg-white/5",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="sm" />
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-[8rem] truncate text-xs font-medium text-mist-100">{user.displayName}</span>
          <span className="block text-[10px] text-mist-500">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-mist-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-2xl shadow-black/30 animate-fade-in" role="menu">
          <div className="border-b border-white/5 px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-mist-100">{user.displayName}</p>
                <p className="truncate text-[11px] text-mist-500">@{user.username}</p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Badge tone={user.role === "admin" ? "brand" : user.role === "moderator" ? "warn" : user.role === "guest" ? "neutral" : "good"}>
                {ROLE_LABELS[user.role]}
              </Badge>
              {user.isGuest && <Badge>游客账号</Badge>}
            </div>
            {user.statusText && <p className="mt-2 line-clamp-2 text-[11px] text-mist-400">{user.statusText}</p>}
          </div>

          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openModal("profile");
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs text-mist-200 transition-colors hover:bg-white/5 hover:text-mist-100"
            >
              <UserRound className="h-4 w-4 text-mist-400" />
              个人资料
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openModal("settings");
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs text-mist-200 transition-colors hover:bg-white/5 hover:text-mist-100"
            >
              <Settings className="h-4 w-4 text-mist-400" />
              语音设置
            </button>
            {canAdmin && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate("/admin");
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs text-brand-300 transition-colors hover:bg-brand-500/10"
              >
                <ShieldCheck className="h-4 w-4" />
                管理后台
              </button>
            )}
          </div>

          <div className="border-t border-white/5 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleLogout()}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs text-bad-400 transition-colors hover:bg-bad-500/10"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

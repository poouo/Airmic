import { useState } from "react";
import { ChevronDown, EarOff, MicOff } from "lucide-react";
import { Avatar } from "@/components/ui";
import { ROLE_LABELS } from "@airmic/shared";
import { cn } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";

export default function OnlineUsersList({ initiallyOpen }: { initiallyOpen: boolean }) {
  const onlineUsers = useAppStore((state) => state.onlineUsers);
  const selfId = useAuthStore((state) => state.user?.id ?? null);
  const [open, setOpen] = useState(initiallyOpen);

  const sorted = [...onlineUsers].sort((a, b) => {
    const roomA = a.roomName ?? "~大厅";
    const roomB = b.roomName ?? "~大厅";
    if (roomA !== roomB) return roomA.localeCompare(roomB, "zh-CN");
    return a.displayName.localeCompare(b.displayName, "zh-CN");
  });

  return (
    <div className="shrink-0 border-t border-sidebar-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen((previous) => !previous)} className="flex min-h-10 w-full items-center gap-2 px-3 text-xs font-semibold text-muted-foreground hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronDown className={cn("h-3.5 w-3.5", !open && "-rotate-90")} />
        <span className="mr-auto">在线用户</span>
        <span className="tabular rounded bg-sidebar-accent px-1.5 py-0.5 font-mono text-[10px] leading-4 text-muted-foreground">{onlineUsers.length}</span>
      </button>
      {open && <div className="app-scroll max-h-[min(10rem,22dvh)] overflow-y-auto px-2 pb-2">
        {sorted.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">暂无其他在线用户</p>
        ) : (
          <div className="space-y-0.5">
            {sorted.map((user) => (
              <div key={user.userId} className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-sidebar-accent/60">
                <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="xs" speaking={user.speaking} muted={user.muted} deafened={user.deafened} />
                <div className="min-w-0 flex-1">
                  <p className={cn("flex items-center gap-1 truncate text-[12px]", user.speaking ? "font-medium text-success" : "text-sidebar-foreground")}>
                    <span className="truncate">{user.displayName}</span>
                    {user.userId === selfId && <span className="shrink-0 text-[10px] text-muted-foreground">（你）</span>}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {user.roomName ?? "大厅"} · {ROLE_LABELS[user.role]}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  {user.deafened ? <EarOff className="h-3 w-3 text-muted-foreground" /> : user.muted ? <MicOff className="h-3 w-3 text-muted-foreground" /> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>}
    </div>
  );
}

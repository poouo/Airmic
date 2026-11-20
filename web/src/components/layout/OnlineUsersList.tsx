import { EarOff, MicOff } from "lucide-react";
import { Avatar, SectionTitle } from "@/components/ui";
import { ROLE_LABELS } from "@airmic/shared";
import { cn } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";

export default function OnlineUsersList() {
  const onlineUsers = useAppStore((state) => state.onlineUsers);
  const selfId = useAuthStore((state) => state.user?.id ?? null);

  const sorted = [...onlineUsers].sort((a, b) => {
    const roomA = a.roomName ?? "~大厅";
    const roomB = b.roomName ?? "~大厅";
    if (roomA !== roomB) return roomA.localeCompare(roomB, "zh-CN");
    return a.displayName.localeCompare(b.displayName, "zh-CN");
  });

  return (
    <div className="shrink-0 border-t border-white/5">
      <div className="flex items-center justify-between px-3 py-2">
        <SectionTitle>在线用户</SectionTitle>
        <span className="rounded-full bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-mist-400">{onlineUsers.length}</span>
      </div>
      <div className="max-h-48 overflow-y-auto app-scroll px-2 pb-2">
        {sorted.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-mist-500">暂无其他在线用户</p>
        ) : (
          <div className="space-y-0.5">
            {sorted.map((user) => (
              <div key={user.userId} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5">
                <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="xs" speaking={user.speaking} muted={user.muted} deafened={user.deafened} />
                <div className="min-w-0 flex-1">
                  <p className={cn("flex items-center gap-1 truncate text-[11px]", user.speaking ? "text-aqua-400" : "text-mist-200")}>
                    <span className="truncate">{user.displayName}</span>
                    {user.userId === selfId && <span className="shrink-0 text-[10px] text-mist-500">（你）</span>}
                  </p>
                  <p className="truncate text-[10px] text-mist-500">{user.roomName ?? "大厅"} · {ROLE_LABELS[user.role]}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-mist-500">
                  {user.deafened ? <EarOff className="h-3 w-3 text-bad-400" /> : user.muted ? <MicOff className="h-3 w-3 text-bad-400" /> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

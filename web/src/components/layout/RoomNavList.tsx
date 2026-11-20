import type { RoomSummary } from "@airmic/shared";
import { Hash, Lock, LockKeyhole, Plus } from "lucide-react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/format";
import { groupRoomsByCategory, useAppStore } from "@/stores/app";

export interface RoomNavListProps {
  currentRoomId: number | null;
  canCreateRooms: boolean;
  onSelect: (room: RoomSummary) => void;
  onCreate: () => void;
}

export default function RoomNavList({ currentRoomId, canCreateRooms, onSelect, onCreate }: RoomNavListProps) {
  const rooms = useAppStore((state) => state.rooms);
  const groups = groupRoomsByCategory(rooms);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">语音房间</p>
        {canCreateRooms && (
          <IconButton label="创建房间" size="sm" onClick={onCreate} className="h-6 w-6">
            <Plus className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto app-scroll px-2 pb-2">
        {groups.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">还没有可用房间</p>
            {canCreateRooms && (
              <button
                type="button"
                onClick={onCreate}
                className="mt-1.5 text-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              >
                创建一个房间
              </button>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.category} className="mb-2.5">
              <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {group.category}
                <span className="ml-1 font-normal text-muted-foreground/60">{group.rooms.length}</span>
              </p>
              <div className="space-y-0.5">
                {group.rooms.map((room) => {
                  const active = room.id === currentRoomId;
                  const full = room.maxUsers > 0 && room.userCount >= room.maxUsers;
                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => onSelect(room)}
                      title={room.locked ? "房间已锁定" : "加入「" + room.name + "」"}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-sidebar-accent text-foreground"
                          : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-foreground",
                        room.locked && !active && "opacity-55",
                      )}
                    >
                      <Hash className={cn("h-3.5 w-3.5 shrink-0", active ? "text-foreground" : "text-muted-foreground/70")} />
                      <span className={cn("min-w-0 flex-1 truncate text-[13px]", active && "font-medium")}>{room.name}</span>
                      {room.hasPassword && <Lock className="h-3 w-3 shrink-0 text-warning" />}
                      {room.locked && <LockKeyhole className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span
                        className={cn(
                          "tabular shrink-0 rounded px-1 py-px font-mono text-[10px] leading-4",
                          full ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {room.userCount}/{room.maxUsers > 0 ? room.maxUsers : "∞"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import type { RoomSummary } from "@airmic/shared";
import { Hash, Lock, LockKeyhole, Plus } from "lucide-react";
import { IconButton, SectionTitle } from "@/components/ui";
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
      <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
        <SectionTitle>语音房间</SectionTitle>
        {canCreateRooms && (
          <IconButton label="创建房间" size="sm" onClick={onCreate}>
            <Plus className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto app-scroll px-2 pb-2">
        {groups.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-mist-500">还没有可用房间</p>
            {canCreateRooms && (
              <button type="button" onClick={onCreate} className="mt-1.5 text-xs text-brand-400 hover:text-brand-300">
                创建一个房间
              </button>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.category} className="mb-3">
              <p className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-mist-500">
                {group.category}
                <span className="ml-1 font-normal text-mist-500/70">({group.rooms.length})</span>
              </p>
              <div className="space-y-0.5">
                {group.rooms.map((room) => {
                  const active = room.id === currentRoomId;
                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => onSelect(room)}
                      title={room.locked ? "房间已锁定" : "加入「" + room.name + "」"}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-brand-400",
                        active ? "bg-brand-500/15 text-mist-100 ring-1 ring-brand-400/25" : "text-mist-300 hover:bg-white/5 hover:text-mist-100",
                        room.locked && !active && "opacity-60",
                      )}
                    >
                      <Hash className={cn("h-3.5 w-3.5 shrink-0", active ? "text-brand-300" : "text-mist-500")} />
                      <span className="min-w-0 flex-1 truncate text-xs">{room.name}</span>
                      {room.hasPassword && <Lock className="h-3 w-3 shrink-0 text-warn-400/90" />}
                      {room.locked && <LockKeyhole className="h-3 w-3 shrink-0 text-mist-400" />}
                      <span
                        className={cn(
                          "shrink-0 rounded-md px-1 py-0.5 font-mono text-[10px]",
                          room.maxUsers > 0 && room.userCount >= room.maxUsers ? "bg-bad-500/10 text-bad-400" : "bg-white/5 text-mist-400",
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

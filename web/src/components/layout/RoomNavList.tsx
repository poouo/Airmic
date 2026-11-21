import { useState } from "react";
import type { RoomSummary } from "@airmic/shared";
import { Folder, FolderOpen, Layers, Lock, LockKeyhole, Plus, Settings2 } from "lucide-react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/format";
import { RoomIcon, iconLabel } from "@/components/room/roomIcons";
import { groupRoomDirectory, useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";

export interface RoomNavListProps {
  currentRoomId: number | null;
  canCreateRooms: boolean;
  canManage: boolean;
  onSelect: (room: RoomSummary) => void;
  onCreate: () => void;
}

export default function RoomNavList({ currentRoomId, canCreateRooms, canManage, onSelect, onCreate }: RoomNavListProps) {
  const rooms = useAppStore((state) => state.rooms);
  const directory = useAppStore((state) => state.directory);
  const groups = groupRoomDirectory(directory?.areas ?? [], rooms);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());

  const toggleGroup = (key: number) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <p className="text-xs font-semibold text-foreground">语音房间</p>
        <div className="flex items-center gap-1">
          {canManage && <IconButton label="分区与房间管理" aria-haspopup="dialog" onClick={() => useUiStore.getState().openModal("room-directory")}><Settings2 className="h-4 w-4" /></IconButton>}
          {canCreateRooms && (
            <IconButton label="创建房间" onClick={onCreate}><Plus className="h-4 w-4" /></IconButton>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto app-scroll px-2 pb-2">
        {groups.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">{directory ? "还没有分区" : "正在加载分区…"}</p>
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
          groups.map((group) => {
            const channelKey = group.area.id;
            const channelCollapsed = collapsed.has(channelKey);
            const channelRoomCount = group.children.reduce((sum, child) => sum + child.rooms.length, 0);
            return (
              <div key={channelKey} className="mb-2.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(channelKey)}
                  aria-expanded={!channelCollapsed}
                  title={group.area.name}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8"
                >
                  {channelCollapsed ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                    {group.area.name}
                  </span>
                  <span className="tabular shrink-0 rounded bg-sidebar-accent/70 px-1 py-px font-mono text-[10px] leading-4 text-muted-foreground/80">
                    {channelRoomCount}
                  </span>
                </button>

                {!channelCollapsed && (
                  <div className="mt-0.5 space-y-0.5">
                    {group.children.map((game) => {
                      const gameKey = game.area.id;
                      const gameCollapsed = collapsed.has(gameKey);
                      return (
                        <div key={gameKey}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(gameKey)}
                            aria-expanded={!gameCollapsed}
                            title={game.area.name}
                            className="flex min-h-9 w-full items-center gap-1.5 rounded-lg py-1 pl-5 pr-2 text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring lg:min-h-7"
                          >
                            <Layers className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground/80">
                              {game.area.name}
                            </span>
                            <span className="tabular shrink-0 rounded px-1 py-px font-mono text-[10px] leading-4 text-muted-foreground/60">
                              {game.rooms.length}
                            </span>
                          </button>

                          {!gameCollapsed && (
                            <div className="mt-0.5 space-y-0.5">
                              {game.rooms.map((room) => {
                                const active = room.id === currentRoomId;
                                const full = room.maxUsers > 0 && room.userCount >= room.maxUsers;
                                return (
                                  <button
                                    key={room.id}
                                    type="button"
                                    onClick={() => onSelect(room)}
                                    title={room.locked ? "房间已锁定" : "加入「" + room.name + "」"}
                                    className={cn(
                                      "flex min-h-11 w-full items-center gap-2 rounded-lg py-1.5 pl-7 pr-2 text-left outline-none transition-colors lg:min-h-8",
                                      "focus-visible:ring-2 focus-visible:ring-ring",
                                      active
                                        ? "bg-sidebar-accent text-foreground"
                                        : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-foreground",
                                      room.locked && !active && "opacity-55",
                                    )}
                                  >
                                    <span title={iconLabel(room.icon)} className="inline-flex shrink-0">
                                      <RoomIcon
                                        icon={room.icon}
                                        className={cn("h-3.5 w-3.5", active ? "text-foreground" : "text-muted-foreground/70")}
                                      />
                                    </span>
                                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", active && "font-medium")}>
                                      {room.name}
                                    </span>
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
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

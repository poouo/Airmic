import { useState } from "react";
import type { RoomSummary } from "@airmic/shared";
import { ChevronRight, KeyRound, Lock, LockKeyhole, Plus, Settings2, UserRoundCheck } from "lucide-react";
import { IconButton } from "@/components/ui";
import AreaIcon from "@/components/lobby/AreaIcon";
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
    <nav aria-label="房间目录" className="flex min-h-0 flex-1 flex-col">
      <div className="mx-3 mb-2 flex shrink-0 items-center justify-between border-b border-sidebar-border py-2">
        <p className="pl-1 text-sm font-semibold text-foreground">语音房间</p>
        <div className="flex items-center gap-1">
          {canManage && <IconButton label="分区与房间管理" aria-haspopup="dialog" onClick={() => useUiStore.getState().openModal("room-directory")}><Settings2 className="h-4 w-4" /></IconButton>}
          {canCreateRooms && (
            <IconButton label="创建房间" onClick={onCreate}><Plus className="h-4 w-4" /></IconButton>
          )}
        </div>
      </div>

      <div className="app-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-3">
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
              <div key={channelKey} className="mb-3">
                <button
                  type="button"
                  onClick={() => toggleGroup(channelKey)}
                  aria-expanded={!channelCollapsed}
                  title={group.area.name}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-card px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !channelCollapsed && "rotate-90")} />
                  <AreaIcon icon={group.area.icon} isRoot expanded={!channelCollapsed} className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                    {group.area.name}
                  </span>
                  <span className="tabular shrink-0 rounded-md bg-sidebar-accent px-1.5 py-px text-[11px] leading-4 text-muted-foreground">
                    {channelRoomCount}
                  </span>
                </button>

                {!channelCollapsed && (
                  <div className="ml-3 mt-1 space-y-1 border-l border-sidebar-border pl-2">
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
                            className="flex min-h-9 w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8"
                          >
                            <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", !gameCollapsed && "rotate-90")} />
                            <AreaIcon icon={game.area.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground">
                              {game.area.name}
                            </span>
                            <span className="tabular shrink-0 px-1 text-[11px] text-muted-foreground">
                              {game.rooms.length}
                            </span>
                          </button>

                          {!gameCollapsed && (
                            <div className="ml-2 mt-0.5 space-y-0.5">
                              {game.rooms.map((room) => {
                                const active = room.id === currentRoomId;
                                const full = room.maxUsers > 0 && room.userCount >= room.maxUsers;
                                return (
                                  <button
                                    key={room.id}
                                    type="button"
                                    onClick={() => onSelect(room)}
                                    aria-current={active ? "true" : undefined}
                                    title={room.locked ? "房间已锁定" : "加入「" + room.name + "」"}
                                    className={cn(
                                      "flex min-h-11 w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left outline-none transition-colors lg:min-h-9",
                                      "focus-visible:ring-2 focus-visible:ring-ring",
                                      active
                                        ? "border-primary/25 bg-primary/10 text-foreground"
                                        : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                                      room.locked && !active && "opacity-55",
                                    )}
                                  >
                                    <span title={iconLabel(room.icon)} className="inline-flex shrink-0">
                                      <RoomIcon
                                        icon={room.icon}
                                        className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")}
                                      />
                                    </span>
                                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", active && "font-medium")}>
                                      {room.name}
                                    </span>
                                    {room.hasPassword && <Lock className="h-3 w-3 shrink-0 text-warning" />}
                                    {room.codeOnly && <KeyRound aria-label="口令房" className="h-3 w-3 shrink-0 text-brand" />}
                                    {room.allowGuests === false && <span title="仅注册用户" className="shrink-0"><UserRoundCheck role="img" aria-label="仅注册用户" className="h-3 w-3 text-muted-foreground" /></span>}
                                    {room.locked && <LockKeyhole className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                    <span
                                      className={cn(
                                        "tabular shrink-0 rounded-md px-1 py-px text-[11px] leading-4",
                                        full ? "bg-destructive/10 text-destructive" : room.userCount > 0 ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground",
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
    </nav>
  );
}

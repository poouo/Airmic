import type { RoomSummary } from "@airmic/shared";
import { DoorOpen, Plus } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { groupRoomsByCategory } from "@/stores/app";
import RoomCard from "./RoomCard";

export interface LobbyRoomGridProps {
  rooms: RoomSummary[];
  currentRoomId: number | null;
  canEdit: boolean;
  canCreate: boolean;
  onJoin: (room: RoomSummary) => void;
  onEdit: (room: RoomSummary) => void;
  onCreate: () => void;
}

export default function LobbyRoomGrid({ rooms, currentRoomId, canEdit, canCreate, onJoin, onEdit, onCreate }: LobbyRoomGridProps) {
  if (rooms.length === 0) {
    return (
      <EmptyState
        icon={<DoorOpen className="h-6 w-6" />}
        title="还没有房间"
        description={canCreate ? "创建第一个语音房间，邀请朋友一起开黑吧" : "等待管理员创建语音房间，或先邀请朋友注册账号"}
        action={
          canCreate ? (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>
              创建房间
            </Button>
          ) : undefined
        }
      />
    );
  }

  const groups = groupRoomsByCategory(rooms);
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.category}>
          <div className="mb-2.5 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-mist-200">{group.category}</h2>
            <span className="rounded-full bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-mist-500">{group.rooms.length}</span>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.rooms.map((room) => (
              <RoomCard key={room.id} room={room} isCurrent={room.id === currentRoomId} canEdit={canEdit} onJoin={onJoin} onEdit={onEdit} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

import type { RoomSummary } from "@airmic/shared";
import { Lock, MonitorUp, Pencil, Users } from "lucide-react";
import { Badge, Button, IconButton } from "@/components/ui";
import { RoomIcon, iconLabel } from "@/components/room/roomIcons";
import { cn } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";

export interface RoomCardProps {
  room: RoomSummary;
  isCurrent: boolean;
  canEdit: boolean;
  onJoin: (room: RoomSummary) => void;
  onEdit: (room: RoomSummary) => void;
}

export default function RoomCard({ room, isCurrent, canEdit, onJoin, onEdit }: RoomCardProps) {
  const isGuest = useAuthStore((state) => state.user?.isGuest);
  const guestBlocked = isGuest && room.allowGuests === false;
  const full = room.maxUsers > 0 && room.userCount >= room.maxUsers;
  const disabled = !isCurrent && (guestBlocked || room.locked || full);
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card p-4 text-left shadow-card transition-[border-color,box-shadow]",
        isCurrent ? "border-primary/40" : "border-border hover:border-brand/35 hover:shadow-raised",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
          <span title={iconLabel(room.icon)} className="inline-flex shrink-0"><RoomIcon icon={room.icon} className="h-4 w-4 text-muted-foreground" /></span>
          <span className="truncate" title={room.name}>{room.name}</span>
        </h4>
        {room.hasPassword && <Badge tone="warn"><Lock className="h-3 w-3" />需密码</Badge>}
        {room.allowGuests === false && <Badge>仅注册用户</Badge>}
        {isCurrent && <Badge tone="brand">当前</Badge>}
      </div>
      {room.description && <p className="mt-1.5 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">{room.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-3 text-xs text-muted-foreground">
        <span className={cn("tabular inline-flex items-center gap-1", full && "font-medium text-destructive")}>
          <Users className="h-3.5 w-3.5" />
          {room.userCount}/{room.maxUsers > 0 ? room.maxUsers : "∞"}
        </span>
        {room.screenShareEnabled && (
          <span className="inline-flex items-center gap-1">
            <MonitorUp className="h-3.5 w-3.5" />
            共享
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <Button
          size="md"
          variant={isCurrent ? "secondary" : "primary"}
          disabled={disabled}
          className="min-h-11 flex-1 sm:min-h-9"
          onClick={() => onJoin(room)}
        >
          {isCurrent ? "返回房间" : guestBlocked ? "注册后可进入" : room.locked ? "已锁定" : full ? "房间已满" : "进入房间"}
        </Button>
        {canEdit && (
          <IconButton
            label="编辑房间"
            size="md"
            variant="solid"
            className="h-11 w-11 sm:h-9 sm:w-9"
            onClick={() => onEdit(room)}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
        )}
      </div>
    </article>
  );
}

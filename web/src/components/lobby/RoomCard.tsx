import type { RoomSummary } from "@airmic/shared";
import { KeyRound, Lock, MonitorUp, Pencil, Users } from "lucide-react";
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
        "workspace-panel flex min-w-0 flex-col rounded-2xl border p-3.5 text-left shadow-card transition-[border-color,box-shadow] duration-200 sm:p-4",
        isCurrent ? "border-primary/40" : "border-border hover:border-brand/35 hover:shadow-raised",
      )}
    >
      <div className="flex items-start gap-3">
        <span title={iconLabel(room.icon)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-brand">
          <RoomIcon icon={room.icon} className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="min-w-0 truncate text-sm font-semibold text-foreground" title={room.name}>{room.name}</h4>
            {room.hasPassword && <Badge tone="warn"><Lock className="h-3 w-3" />需密码</Badge>}
            {room.codeOnly && <Badge tone="brand"><KeyRound className="h-3 w-3" />口令房</Badge>}
            {room.allowGuests === false && <Badge>仅注册用户</Badge>}
            {isCurrent && <Badge tone="brand">当前</Badge>}
          </div>
          {room.description && <p className="mt-0.5 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">{room.description}</p>}
        </div>
        {canEdit && (
          <IconButton label="编辑房间" className="h-9 w-9" onClick={() => onEdit(room)}>
            <Pencil className="h-4 w-4" />
          </IconButton>
        )}
      </div>
      <div className="mt-auto pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
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
          <Button
            size="md"
            variant={isCurrent ? "primary" : "outline"}
            disabled={disabled}
            className="ml-auto min-h-10 sm:min-h-9"
            onClick={() => onJoin(room)}
          >
            {isCurrent ? "返回房间" : guestBlocked ? "注册后可进入" : room.locked ? "已锁定" : full ? "房间已满" : room.codeOnly ? "输入口令" : "进入房间"}
          </Button>
        </div>
      </div>
    </article>
  );
}

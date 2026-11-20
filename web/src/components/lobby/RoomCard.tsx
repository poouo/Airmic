import type { RoomSummary } from "@airmic/shared";
import { KeyRound, Lock, LockKeyhole, MessageSquare, MonitorUp, Pencil, Users } from "lucide-react";
import { Badge, Button, IconButton } from "@/components/ui";
import { RoomIcon, iconLabel } from "@/components/room/roomIcons";
import { cn } from "@/lib/format";

export interface RoomCardProps {
  room: RoomSummary;
  isCurrent: boolean;
  canEdit: boolean;
  onJoin: (room: RoomSummary) => void;
  onEdit: (room: RoomSummary) => void;
}

export default function RoomCard({ room, isCurrent, canEdit, onJoin, onEdit }: RoomCardProps) {
  const full = room.maxUsers > 0 && room.userCount >= room.maxUsers;
  const disabled = room.locked;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!disabled) onJoin(room);
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !disabled) {
          event.preventDefault();
          onJoin(room);
        }
      }}
      className={cn(
        "group flex flex-col rounded-2xl border bg-card p-5 text-left shadow-card outline-none transition-[border-color,box-shadow]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isCurrent ? "border-primary/40" : "border-border hover:border-muted-foreground/40",
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
            <span title={iconLabel(room.icon)} className="inline-flex shrink-0">
              <RoomIcon icon={room.icon} className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <span className="truncate">{room.name}</span>
            {room.hasPassword && <Lock className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="房间有密码" />}
            {room.locked && <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="房间已锁定" />}
            {isCurrent && <Badge tone="brand">当前</Badge>}
            {room.locked && <Badge tone="warn">已锁定</Badge>}
          </h3>
          <p className="mt-1.5 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-muted-foreground">{room.description || "暂无房间简介"}</p>
        </div>
        <Badge className="shrink-0">{room.category}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
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
        {room.hasPassword && (
          <span className="inline-flex items-center gap-1">
            <KeyRound className="h-3.5 w-3.5" />
            密码
          </span>
        )}
        {room.description && (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            聊天
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <Button
          size="md"
          variant={isCurrent ? "secondary" : "primary"}
          disabled={disabled}
          className="flex-1"
          onClick={(event) => {
            event.stopPropagation();
            onJoin(room);
          }}
        >
          {disabled ? "已锁定" : isCurrent ? "返回房间" : full ? "房间已满" : "进入房间"}
        </Button>
        {canEdit && (
          <IconButton
            label="编辑房间"
            size="md"
            variant="solid"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(room);
            }}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

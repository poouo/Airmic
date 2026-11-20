import type { RoomSummary } from "@airmic/shared";
import { KeyRound, Lock, LockKeyhole, MessageSquare, MonitorUp, Pencil, Users } from "lucide-react";
import { Badge, Button, IconButton } from "@/components/ui";
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
        "group flex flex-col rounded-2xl border bg-ink-850 p-4 text-left outline-none transition-all",
        "focus-visible:ring-2 focus-visible:ring-brand-400",
        isCurrent ? "border-brand-400/50 bg-brand-500/10" : "border-white/5 hover:border-brand-400/30 hover:bg-ink-800/80",
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold text-mist-100">
            <span className="truncate">{room.name}</span>
            {room.hasPassword && <Lock className="h-3.5 w-3.5 shrink-0 text-warn-400" aria-label="房间有密码" />}
            {room.locked && <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-mist-400" aria-label="房间已锁定" />}
            {isCurrent && <Badge tone="brand">当前</Badge>}
          </h3>
          <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-mist-500">{room.description || "暂无房间简介"}</p>
        </div>
        <span className="shrink-0 rounded-lg bg-white/5 px-2 py-1 text-[10px] text-mist-400">{room.category}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-mist-400">
        <span className={cn("inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5", full ? "bg-bad-500/10 text-bad-400" : "bg-white/5")}>
          <Users className="h-3 w-3" />
          {room.userCount}/{room.maxUsers > 0 ? room.maxUsers : "∞"}
        </span>
        {room.locked && <Badge tone="warn">已锁定</Badge>}
        {room.screenShareEnabled && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-1.5 py-0.5">
            <MonitorUp className="h-3 w-3" />
            共享
          </span>
        )}
        {room.hasPassword && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-1.5 py-0.5">
            <KeyRound className="h-3 w-3" />
            密码
          </span>
        )}
        {room.description && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-1.5 py-0.5">
            <MessageSquare className="h-3 w-3" />
            聊天
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant={isCurrent ? "secondary" : "primary"}
          disabled={disabled}
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
            size="sm"
            variant="solid"
            className="ml-auto"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(room);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

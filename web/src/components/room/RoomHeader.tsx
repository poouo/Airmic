import { ArrowLeft, KeyRound, Lock, Mic2, Settings2, Shield, Users } from "lucide-react";
import type { RoomDetail } from "@airmic/shared";
import { Badge, Button, IconButton } from "@/components/ui";
import { useAppStore } from "@/stores/app";
import { RoomIcon } from "./roomIcons";

export function RoomHeader({ room, memberCount, capacity, stageOnCount, onBack, onEdit, onManageMembers, onViewCode }: {
  room: RoomDetail;
  memberCount: number;
  capacity: number;
  stageOnCount?: number;
  onBack: () => void;
  onEdit?: () => void;
  onManageMembers?: () => void;
  onViewCode?: () => void;
}) {
  const voiceAvailable = useAppStore((state) => state.server?.voiceAvailable ?? true);
  const path = `${room.channel} / ${room.category}`;

  return (
    <header className="workspace-panel workspace-enter flex shrink-0 items-center gap-2 border-b border-border px-2 py-2 sm:gap-3 sm:px-4 lg:rounded-2xl lg:border lg:shadow-card">
      <IconButton label="返回大厅" onClick={onBack} className="h-10 w-10"><ArrowLeft className="h-5 w-5" /></IconButton>
      <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-brand sm:flex"><RoomIcon icon={room.icon} className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h1 className="min-w-0 truncate text-base font-semibold" title={room.name}>{room.name}</h1>
          {room.hasPassword && <Lock aria-label="需密码" className="h-3.5 w-3.5 shrink-0 text-warning" />}
          {room.codeOnly && <KeyRound aria-label="口令房" className="h-3.5 w-3.5 shrink-0 text-brand" />}
          {room.locked && <Badge tone="warn">已锁定</Badge>}
          <Badge tone={room.voiceMode === "stage" ? "brand" : "neutral"}>
            <Mic2 className="h-3 w-3" />{room.voiceMode === "stage" ? `上麦 ${room.stageSeats}` : "自由发言"}
          </Badge>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate" title={path}>{path}</span>
          <span className="flex shrink-0 items-center gap-1 tabular-nums" title="房间人数"><Users className="h-3 w-3" />{memberCount}/{capacity || "∞"}</span>
          {room.voiceMode === "stage" && typeof stageOnCount === "number" && <span className="shrink-0 text-brand tabular-nums">麦位 {stageOnCount}/{room.stageSeats}</span>}
          {!voiceAvailable && <span className="shrink-0 text-warning">语音未配置</span>}
        </div>
      </div>
      {onViewCode && <Button variant="secondary" size="sm" className="min-h-9 shrink-0" aria-haspopup="dialog"
        icon={<KeyRound className="h-3.5 w-3.5" />} onClick={onViewCode}>查看口令</Button>}
      {onEdit && <IconButton label="编辑当前房间" onClick={onEdit} className="h-10 w-10"><Settings2 className="h-4 w-4" /></IconButton>}
      {onManageMembers && <IconButton label="管理房间成员" onClick={onManageMembers} className="h-10 w-10"><Shield className="h-4 w-4" /></IconButton>}
    </header>
  );
}

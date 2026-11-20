import { ArrowLeft, Gauge, Lock, MessageSquare, MicOff, Server, Users } from "lucide-react";
import { audioSummary } from "@airmic/shared";
import type { RoomDetail } from "@airmic/shared";
import { Badge, Button, IconButton } from "@/components/ui";
import { useAppStore } from "@/stores/app";

export interface RoomHeaderProps {
  room: RoomDetail;
  memberCount: number;
  /** 房间上限（0 表示不限） */
  capacity: number;
  hasMicrophone: boolean;
  onBack: () => void;
  onToggleChat: () => void;
  onRetryMicrophone: () => void;
}

/** 房间顶部信息栏：名称、分类、人数、音质摘要与麦克风状态 */
export function RoomHeader({
  room,
  memberCount,
  capacity,
  hasMicrophone,
  onBack,
  onToggleChat,
  onRetryMicrophone,
}: RoomHeaderProps) {
  const voiceAvailable = useAppStore((state) => state.server?.voiceAvailable ?? true);

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-white/5 bg-ink-900/70 px-2 py-2 backdrop-blur sm:gap-3 sm:px-4 sm:py-2.5">
      <IconButton label="返回大厅" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
      </IconButton>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-mist-100 sm:text-base">{room.name}</h1>
          {room.hasPassword && (
            <span title="房间已设置密码" className="shrink-0 text-mist-400">
              <Lock className="h-3.5 w-3.5" />
            </span>
          )}
          {room.locked && (
            <Badge tone="warn" className="shrink-0">
              已锁定
            </Badge>
          )}
          {room.category && (
            <Badge tone="brand" className="hidden shrink-0 sm:inline-flex">
              {room.category}
            </Badge>
          )}
          {room.screenShareEnabled === false && (
            <Badge tone="neutral" className="hidden shrink-0 md:inline-flex">
              禁止共享
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-3 text-[11px] text-mist-500">
          <span className="flex shrink-0 items-center gap-1">
            <Users className="h-3 w-3" />
            {capacity > 0 ? memberCount + "/" + capacity : memberCount + " 人"}
          </span>
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
            <Gauge className="h-3 w-3" />
            {audioSummary(room.audioSettings)}
          </span>
          <span className="hidden shrink-0 items-center gap-1 sm:flex" title="语音媒体由服务端 LiveKit SFU 中转，客户端之间不建立 P2P 连接">
            <Server className="h-3 w-3" />
            服务端 SFU 中转
          </span>
          {!voiceAvailable && (
            <Badge tone="warn" className="shrink-0">
              语音未配置
            </Badge>
          )}
          {room.description && <span className="hidden min-w-0 truncate md:inline">· {room.description}</span>}
        </div>
      </div>

      {!hasMicrophone && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={onRetryMicrophone}
          icon={<MicOff className="h-3.5 w-3.5 text-warn-400" />}
          title="当前只能收听，点击重新申请麦克风权限"
        >
          <span className="hidden sm:inline">仅收听 · </span>启用麦克风
        </Button>
      )}

      <IconButton label="打开聊天" onClick={onToggleChat}>
        <MessageSquare className="h-4 w-4" />
      </IconButton>
    </header>
  );
}

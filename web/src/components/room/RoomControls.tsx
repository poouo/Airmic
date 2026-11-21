import type { ReactNode } from "react";
import { Hand, HeadphoneOff, Headphones, LogOut, MessageSquare, Mic, MicOff, MonitorOff, MonitorUp, Settings } from "lucide-react";
import { cn, prettyKey } from "@/lib/format";
import { Kbd } from "@/components/ui";
import { useRoomStore } from "@/stores/room";
import type { PeerNetworkStats, VoiceStateSnapshot } from "@/voice/engine";
import { qualityMeta, worstQuality } from "./quality";

interface RoomControlsProps {
  selfState: VoiceStateSnapshot;
  pttEnabled: boolean;
  pttKey: string;
  stageMode: boolean;
  onStage: boolean;
  stagePending: boolean;
  screenShareAllowed: boolean;
  shareBusy: boolean;
  peerStats: PeerNetworkStats[];
  chatOpen: boolean;
  onToggleMic: () => void;
  onToggleStage: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onLeave: () => void;
}

export function RoomControls({ selfState, pttEnabled, pttKey, stageMode, onStage, stagePending, screenShareAllowed, shareBusy, peerStats,
  chatOpen, onToggleMic, onToggleStage, onToggleDeafen, onToggleScreenShare, onToggleChat, onOpenSettings, onLeave,
}: RoomControlsProps) {
  const latency = useRoomStore((state) => state.latency);
  const samples = Object.values(latency).filter((value): value is number => value !== null);
  const average = samples.length ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length) : null;
  const quality = peerStats.length ? qualityMeta(worstQuality(peerStats)) : null;
  const micMuted = !selfState.micEnabled || !selfState.hasMicrophone || selfState.forceMuted;
  const micLabel = selfState.forceMuted ? "已被强制静音" : !selfState.hasMicrophone ? "启用麦克风" : micMuted ? "取消静音" : "静音麦克风";
  const listeningLabel = selfState.deafened ? "恢复收听" : "关闭收听";
  const stageLabel = onStage ? "下麦" : stagePending ? "取消申请" : "申请上麦";

  return (
    <footer aria-label="语音控制" className="shrink-0 border-t border-border bg-card px-2 py-1.5 sm:px-4 sm:py-2.5">
      {(pttEnabled || selfState.forceMuted) && <div className="mb-1 flex justify-center text-xs text-muted-foreground">
        {selfState.forceMuted ? <span className="text-destructive">已被强制静音</span> : selfState.pttActive ? (
          <span className="text-success">正在说话</span>
        ) : <span className="flex items-center gap-1">按住 <Kbd>{prettyKey(pttKey)}</Kbd> 说话</span>}
      </div>}
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <div className="hidden min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground sm:flex">
          {quality && <span className={quality.textClass}>{quality.label}</span>}
          {average !== null && <span className="tabular-nums">{average} ms</span>}
        </div>
        <div className={cn("grid min-w-0 flex-1 gap-1 sm:flex sm:flex-none sm:gap-2", stageMode && onStage ? "grid-cols-7" : "grid-cols-6")}>
          {stageMode && <Control label={stageLabel} caption={onStage ? "下麦" : stagePending ? "等待" : "上麦"}
            selected={onStage || stagePending} onClick={onToggleStage} icon={<Hand />} />}
          {(!stageMode || onStage) && <Control label={micLabel} caption={micMuted ? "静音" : "麦克风"} selected={!micMuted} danger={micMuted} onClick={onToggleMic} icon={micMuted ? <MicOff /> : <Mic />} />}
          <Control label={listeningLabel} caption={listeningLabel} selected={selfState.deafened} onClick={onToggleDeafen} icon={selfState.deafened ? <HeadphoneOff /> : <Headphones />} />
          <Control label={selfState.screenSharing ? "停止共享屏幕" : "共享屏幕"} caption="共享" selected={selfState.screenSharing}
            disabled={shareBusy || (!screenShareAllowed && !selfState.screenSharing)} onClick={onToggleScreenShare} icon={selfState.screenSharing ? <MonitorOff /> : <MonitorUp />} />
          <Control label="聊天" caption="聊天" selected={chatOpen} onClick={onToggleChat} icon={<MessageSquare />} />
          <Control label="语音设置" caption="设置" onClick={onOpenSettings} icon={<Settings />} />
          <Control label="离开房间" caption="离开" danger onClick={onLeave} icon={<LogOut />} />
        </div>
      </div>
    </footer>
  );
}

function Control({ label, caption, icon, onClick, selected, danger, disabled }: {
  label: string;
  caption: string;
  icon: ReactNode;
  onClick: () => void;
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={selected}
    className={cn(
      "flex min-h-12 min-w-0 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[10px] font-medium leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:h-11 sm:min-h-0 sm:min-w-11 sm:px-3 sm:text-xs",
      "[&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:shrink-0",
      danger ? "bg-destructive/10 text-destructive hover:bg-destructive/20" : selected ? "bg-accent text-brand" : "text-muted-foreground hover:bg-accent hover:text-foreground",
    )}>
    {icon}
    <span className={cn("max-w-full truncate", label !== "离开房间" && "sm:sr-only")}>{caption}</span>
  </button>;
}

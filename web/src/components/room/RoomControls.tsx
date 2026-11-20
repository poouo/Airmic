import {
  HeadphoneOff,
  Headphones,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Settings,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { SocketStatus } from "@/lib/ws";
import { cn, prettyKey } from "@/lib/format";
import { Kbd } from "@/components/ui";
import { useRoomStore } from "@/stores/room";
import type { PeerNetworkStats, VoiceStateSnapshot } from "@/voice/engine";
import { qualityMeta, worstQuality } from "./quality";

export interface RoomControlsProps {
  selfState: VoiceStateSnapshot;
  pttEnabled: boolean;
  pttKey: string;
  screenShareAllowed: boolean;
  /** 屏幕共享按钮是否正在等待浏览器/服务端响应 */
  shareBusy: boolean;
  connection: SocketStatus;
  peerStats: PeerNetworkStats[];
  chatOpen: boolean;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onLeave: () => void;
}

/** 底部控制栏：麦克风、耳聋、屏幕共享、聊天、设置、离开 + 连接质量概览 */
export function RoomControls({
  selfState,
  pttEnabled,
  pttKey,
  screenShareAllowed,
  shareBusy,
  connection,
  peerStats,
  chatOpen,
  onToggleMic,
  onToggleDeafen,
  onToggleScreenShare,
  onToggleChat,
  onOpenSettings,
  onLeave,
}: RoomControlsProps) {
  // 延迟由服务端心跳测得并广播（见 hub 的 ping/pong），这里取房间内已测到的平均值
  const latencyMap = useRoomStore((state) => state.latency);
  const latencyValues = Object.values(latencyMap).filter((value): value is number => typeof value === "number");
  const latency =
    latencyValues.length > 0 ? Math.round(latencyValues.reduce((total, value) => total + value, 0) / latencyValues.length) : null;
  const quality = peerStats.length > 0 ? qualityMeta(worstQuality(peerStats)) : null;
  const connected = connection === "online";
  const micMuted = !selfState.micEnabled || !selfState.hasMicrophone || selfState.forceMuted;

  return (
    <footer className="shrink-0 px-2 pb-2 pt-1 sm:px-4 sm:pb-4">
      {pttEnabled && (
        <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          {selfState.pttActive ? (
            <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 font-medium text-success">
              <Mic className="h-3 w-3" /> 正在说话…
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              按住 <Kbd>{prettyKey(pttKey)}</Kbd> 说话
              {!selfState.hasMicrophone && <span className="text-warning">（未检测到麦克风）</span>}
            </span>
          )}
        </div>
      )}

      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-2 rounded-full border border-border bg-card px-2 py-1.5 shadow-card sm:px-3">
        <div className="hidden min-w-0 flex-1 items-center gap-2 overflow-hidden pl-1.5 text-[11px] text-muted-foreground sm:flex">
          <span className={cn("flex shrink-0 items-center gap-1 font-medium", connected ? "text-success" : "text-warning")}>
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connectionLabel(connection)}
          </span>
          {connected && quality && (
            <span className="hidden min-w-0 items-center gap-2 md:flex">
              <span className="text-border">|</span>
              <span className={quality.textClass}>{quality.label}</span>
              <span className="tabular whitespace-nowrap">{latency === null ? "服务端中转" : "延迟 " + latency + " ms"}</span>
            </span>
          )}
          {selfState.forceMuted && (
            <span className="flex shrink-0 items-center gap-1 text-destructive">
              <ShieldAlert className="h-3.5 w-3.5" /> 已被管理员强制静音
            </span>
          )}
        </div>

        <div className="flex flex-1 items-center justify-center gap-1 sm:flex-none sm:gap-1.5">
          <ControlButton
            label={selfState.forceMuted ? "已被管理员强制静音" : micMuted ? "取消静音" : "静音麦克风"}
            active={!micMuted}
            danger={micMuted && selfState.hasMicrophone}
            onClick={onToggleMic}
            icon={micMuted ? <MicOff className="h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
          />
          <ControlButton
            label={selfState.deafened ? "取消耳聋" : "耳聋（关闭所有声音）"}
            active={selfState.deafened}
            warn
            onClick={onToggleDeafen}
            icon={selfState.deafened ? <HeadphoneOff className="h-[18px] w-[18px]" /> : <Headphones className="h-[18px] w-[18px]" />}
          />
          <ControlButton
            label={selfState.screenSharing ? "停止共享屏幕" : "共享屏幕"}
            active={selfState.screenSharing}
            aqua
            disabled={!screenShareAllowed}
            loading={shareBusy}
            onClick={onToggleScreenShare}
            icon={selfState.screenSharing ? <MonitorOff className="h-[18px] w-[18px]" /> : <MonitorUp className="h-[18px] w-[18px]" />}
            title={!screenShareAllowed ? "该房间未开启屏幕共享" : undefined}
          />
          <span className="mx-0.5 hidden h-6 w-px shrink-0 bg-border sm:block" />
          <ControlButton label="聊天" active={chatOpen} onClick={onToggleChat} icon={<MessageSquare className="h-[18px] w-[18px]" />} />
          <ControlButton label="语音设置" onClick={onOpenSettings} icon={<Settings className="h-[18px] w-[18px]" />} />
        </div>

        <div className="flex shrink-0 justify-end">
          <button
            type="button"
            onClick={onLeave}
            title="离开房间"
            aria-label="离开房间"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-destructive px-2.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 sm:h-10 sm:px-3.5"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">离开</span>
          </button>
        </div>
      </div>
    </footer>
  );
}

function connectionLabel(status: SocketStatus): string {
  switch (status) {
    case "online":
      return "已连接";
    case "connecting":
      return "连接中";
    case "reconnecting":
      return "重连中";
    case "offline":
      return "已断开";
    default:
      return "未连接";
  }
}

interface ControlButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  warn?: boolean;
  aqua?: boolean;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}

function ControlButton({ label, icon, onClick, active, danger, warn, aqua, disabled, loading, title }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors sm:h-10 sm:w-10",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active && !danger && warn && "bg-warning/12 text-warning hover:bg-warning/20",
        active && !danger && aqua && "bg-info/12 text-info hover:bg-info/20",
        active && !danger && !warn && !aqua && "bg-accent text-foreground hover:bg-accent/80",
        danger && "bg-destructive/10 text-destructive hover:bg-destructive/15",
        !active && !danger && "text-muted-foreground hover:bg-accent hover:text-foreground",
        loading && "animate-pulse",
      )}
    >
      {icon}
    </button>
  );
}

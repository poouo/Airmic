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
import type { PeerNetworkStats, VoiceStateSnapshot } from "@/voice/engine";
import { averageRtt, qualityMeta, worstQuality } from "./quality";

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
  const latency = averageRtt(peerStats);
  const quality = peerStats.length > 0 ? qualityMeta(worstQuality(peerStats)) : null;
  const connected = connection === "online";
  const micMuted = !selfState.micEnabled || !selfState.hasMicrophone || selfState.forceMuted;

  return (
    <footer className="shrink-0 border-t border-white/5 bg-ink-900/85 px-2 py-2 backdrop-blur sm:px-4 sm:py-3">
      {pttEnabled && (
        <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] text-mist-400">
          {selfState.pttActive ? (
            <span className="flex items-center gap-1.5 rounded-full bg-aqua-400/15 px-2.5 py-1 font-medium text-aqua-400">
              <Mic className="h-3 w-3" /> 正在说话…
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              按住 <Kbd>{prettyKey(pttKey)}</Kbd> 说话
              {!selfState.hasMicrophone && <span className="text-warn-400">（未检测到麦克风）</span>}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="hidden min-w-0 flex-1 items-center gap-2 text-[11px] text-mist-500 sm:flex">
          <span className={cn("flex items-center gap-1", connected ? "text-good-400" : "text-warn-400")}>
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connectionLabel(connection)}
          </span>
          {connected && quality && (
            <>
              <span className="text-ink-500">|</span>
              <span className={quality.textClass}>{quality.label}</span>
              <span className="font-mono">{latency === null ? "服务端中转" : "延迟 " + latency + " ms"}</span>
            </>
          )}
          {selfState.forceMuted && (
            <span className="flex items-center gap-1 text-bad-400">
              <ShieldAlert className="h-3.5 w-3.5" /> 已被管理员强制静音
            </span>
          )}
        </div>

        <div className="flex flex-1 items-center justify-center gap-1.5 sm:flex-none sm:gap-2">
          <ControlButton
            label={selfState.forceMuted ? "已被管理员强制静音" : micMuted ? "取消静音" : "静音麦克风"}
            active={!micMuted}
            danger={micMuted && selfState.hasMicrophone}
            onClick={onToggleMic}
            icon={micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          />
          <ControlButton
            label={selfState.deafened ? "取消耳聋" : "耳聋（关闭所有声音）"}
            active={selfState.deafened}
            warn
            onClick={onToggleDeafen}
            icon={selfState.deafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
          />
          <ControlButton
            label={selfState.screenSharing ? "停止共享屏幕" : "共享屏幕"}
            active={selfState.screenSharing}
            aqua
            disabled={!screenShareAllowed}
            loading={shareBusy}
            onClick={onToggleScreenShare}
            icon={selfState.screenSharing ? <MonitorOff className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />}
            title={!screenShareAllowed ? "该房间未开启屏幕共享" : undefined}
          />
          <span className="mx-0.5 hidden h-7 w-px bg-ink-600 sm:block" />
          <ControlButton label="聊天" active={chatOpen} onClick={onToggleChat} icon={<MessageSquare className="h-5 w-5" />} />
          <ControlButton label="语音设置" onClick={onOpenSettings} icon={<Settings className="h-5 w-5" />} />
        </div>

        <div className="flex flex-1 justify-end sm:flex-none">
          <button
            type="button"
            onClick={onLeave}
            title="离开房间"
            aria-label="离开房间"
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-bad-500/90 px-3 text-xs font-medium text-white transition-colors hover:bg-bad-400 sm:h-12 sm:px-4"
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
        "relative inline-flex h-11 w-11 items-center justify-center rounded-full ring-1 transition-all sm:h-12 sm:w-12",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-40",
        active && !danger && warn && "bg-warn-500/15 text-warn-400 ring-warn-500/40 hover:bg-warn-500/20",
        active && !danger && aqua && "bg-aqua-400/15 text-aqua-400 ring-aqua-400/40 hover:bg-aqua-400/20",
        active && !danger && !warn && !aqua && "bg-brand-500/25 text-brand-300 ring-brand-400/50",
        danger && "bg-bad-500/20 text-bad-400 ring-bad-500/30 hover:bg-bad-500/30",
        !active && !danger && "bg-ink-750/90 text-mist-200 ring-white/10 hover:bg-ink-700",
        loading && "animate-pulse",
      )}
    >
      {icon}
    </button>
  );
}

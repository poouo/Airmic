import { useEffect, useState } from "react";
import { MicOff, MonitorUp, ShieldAlert, SignalHigh, SignalLow, SignalMedium, Signal, Volume1, Volume2, VolumeX } from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import { cn, formatRelative } from "@/lib/format";
import { voice } from "@/voice/engine";
import type { PeerNetworkStats } from "@/voice/engine";
import { LevelMeter } from "./LevelMeter";
import { qualityMeta, qualityTooltip } from "./quality";
import { ROLE_LABEL, ROLE_TONE, showRoleBadge } from "./roleMeta";
import type { RoomMember } from "./types";

export interface MemberCardProps {
  member: RoomMember;
  stats?: PeerNetworkStats;
  volume: number;
  onVolumeChange: (userId: number, volume: number) => void;
  onLocalMute: (userId: number, muted: boolean) => void;
  /** 屏幕共享布局下的紧凑样式 */
  compact?: boolean;
}

/** 成员卡片：头像/说话高亮/角色徽章/状态标识/连接质量 + 本地音量面板 */
export function MemberCard({ member, stats, volume, onVolumeChange, onLocalMute, compact = false }: MemberCardProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const canOpenPanel = !member.isSelf;

  const togglePanel = () => {
    if (!canOpenPanel) return;
    setPanelOpen((open) => !open);
  };

  return (
    <div
      role={canOpenPanel ? "button" : undefined}
      tabIndex={canOpenPanel ? 0 : undefined}
      aria-label={canOpenPanel ? "调整 " + member.displayName + " 的本地音量" : undefined}
      aria-expanded={canOpenPanel ? panelOpen : undefined}
      onClick={togglePanel}
      onKeyDown={(event) => {
        if (!canOpenPanel) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          togglePanel();
        }
      }}
      className={cn(
        "group relative flex select-none flex-col items-center gap-2 rounded-2xl border bg-ink-850/80 text-center transition-all",
        compact ? "min-w-[9.5rem] shrink-0 p-2.5" : "p-3 pt-4",
        member.speaking
          ? "border-aqua-400/60 shadow-[0_0_30px_-10px_rgba(34,211,238,0.85)]"
          : "border-white/5 hover:border-white/15",
        canOpenPanel && "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70",
      )}
    >
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
        {!member.isSelf && stats && <QualityIndicator stats={stats} />}
        {member.forceMuted && (
          <span title="已被管理员强制静音" className="text-bad-400">
            <ShieldAlert className="h-3.5 w-3.5" />
          </span>
        )}
        {member.screenSharing && (
          <span title="正在共享屏幕" className="text-aqua-400">
            <MonitorUp className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <Avatar
        name={member.displayName}
        color={member.avatarColor}
        emoji={member.avatarEmoji}
        size={compact ? "md" : "lg"}
        speaking={member.speaking}
        muted={member.muted}
        deafened={member.deafened}
      />

      <div className="flex w-full min-w-0 flex-col items-center gap-1">
        <div className="flex max-w-full items-center justify-center gap-1.5">
          <span className="truncate text-sm font-medium text-mist-100" title={member.username}>
            {member.displayName}
          </span>
          {member.isSelf && (
            <span className="rounded bg-brand-500/25 px-1 py-0.5 text-[10px] leading-none text-brand-300">你</span>
          )}
        </div>

        {(showRoleBadge(member.role) || member.forceMuted) && (
          <div className="flex flex-wrap items-center justify-center gap-1">
            {showRoleBadge(member.role) && <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABEL[member.role]}</Badge>}
            {member.forceMuted && <Badge tone="bad">强制静音</Badge>}
          </div>
        )}

        {member.statusText && !member.isSelf && (
          <p className="max-w-full truncate text-[11px] text-mist-500" title={member.statusText}>
            {member.statusText}
          </p>
        )}

        {member.isSelf ? (
          <div className="mt-1 w-full space-y-1.5">
            <SelfLevelMeter active={!member.muted} />
            <p className="text-[10px] text-mist-500">
              {member.muted ? (member.forceMuted ? "已被强制静音" : "麦克风已静音") : "麦克风已开启"}
              {member.deafened ? " · 已关闭声音" : ""}
            </p>
          </div>
        ) : (
          <p className="text-[10px] text-mist-500">
            {member.muted ? "已静音" : member.deafened ? "关闭了声音" : "在房间中"}
            {member.joinedAt ? " · " + formatRelative(member.joinedAt) + "加入" : ""}
          </p>
        )}

        {panelOpen && !member.isSelf && (
          <div
            className="mt-1 w-full space-y-2 rounded-xl bg-ink-900/90 p-2.5 text-left ring-1 ring-white/10"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 text-mist-400">
                {volume <= 0 ? <VolumeX className="h-3 w-3" /> : volume < 60 ? <Volume1 className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                本地音量
              </span>
              <span className="font-mono text-mist-300">{volume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volume}
              aria-label={member.displayName + " 的本地音量"}
              onChange={(event) => onVolumeChange(member.userId, Number(event.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-600 accent-brand-500"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onLocalMute(member.userId, volume > 0)}
                className={cn(
                  "flex-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
                  volume > 0 ? "bg-white/5 text-mist-300 hover:bg-white/10" : "bg-good-500/15 text-good-400",
                )}
              >
                {volume > 0 ? "本地静音" : "恢复声音"}
              </button>
              <button
                type="button"
                onClick={() => onVolumeChange(member.userId, 100)}
                className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-mist-400 transition-colors hover:bg-white/10 hover:text-mist-200"
              >
                100%
              </button>
            </div>
          </div>
        )}
      </div>

      {member.muted && !member.isSelf && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-ink-900 p-1 ring-1 ring-white/10" title="已静音">
          <MicOff className="h-3 w-3 text-bad-400" />
        </span>
      )}
    </div>
  );
}

/** 自己的电平条独立订阅，避免整个房间页每秒重渲染 */
function SelfLevelMeter({ active }: { active: boolean }) {
  const [level, setLevel] = useState(0);
  useEffect(() => voice.on("local-level", (payload) => setLevel(payload.level)), []);
  return <LevelMeter level={level} active={active} />;
}

function QualityIndicator({ stats }: { stats: PeerNetworkStats }) {
  const meta = qualityMeta(stats.quality);
  const Icon =
    stats.quality === "poor" ? SignalLow : stats.quality === "fair" ? SignalMedium : stats.quality === "good" ? SignalHigh : Signal;
  return (
    <span title={qualityTooltip(stats)} className={cn("inline-flex", meta.textClass)}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

import { useEffect, useState } from "react";
import { MicOff, MonitorUp, ShieldAlert, SignalHigh, SignalLow, SignalMedium, Signal, Volume1, Volume2, VolumeX } from "lucide-react";
import { Avatar, Badge, Slider } from "@/components/ui";
import { cn, formatRelative } from "@/lib/format";
import { voice } from "@/voice/engine";
import type { PeerNetworkStats } from "@/voice/engine";
import { LevelMeter } from "./LevelMeter";
import { qualityMeta, qualityTooltip } from "./quality";
import { ROLE_LABEL, ROLE_TONE, showRoleBadge } from "./roleMeta";
import type { RoomMember } from "./types";

export interface MemberCardProps {
  member: RoomMember;
  stageMode?: boolean;
  stats?: PeerNetworkStats;
  /** 该成员到语音服务器的往返延迟（毫秒）；未知为 null/undefined */
  latency?: number | null;
  volume: number;
  onVolumeChange: (userId: number, volume: number) => void;
  onLocalMute: (userId: number, muted: boolean) => void;
  /** 屏幕共享布局下的紧凑样式 */
  compact?: boolean;
}

/** 成员卡片：头像/说话高亮/角色徽章/状态标识/连接质量 + 本地音量面板 */
export function MemberCard({ member, stageMode = false, stats, latency, volume, onVolumeChange, onLocalMute, compact = false }: MemberCardProps) {
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
        // 音量滑杆等子元素内的按键不应触发展开面板
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          togglePanel();
        }
      }}
      className={cn(
        "workspace-panel group relative flex select-none flex-col items-center gap-2 rounded-2xl border border-border text-center shadow-card transition-[border-color,box-shadow,background-color]",
        compact ? "p-2.5" : "p-3 pt-4",
        canOpenPanel && "cursor-pointer outline-none hover:border-ring/40 focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
        {!member.isSelf && stats && <QualityIndicator stats={stats} />}
        {member.forceMuted && (
          <span title="已被管理员强制静音" className="text-destructive">
            <ShieldAlert className="h-3.5 w-3.5" />
          </span>
        )}
        {member.screenSharing && (
          <span title="正在共享屏幕" className="text-info">
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
          <span className="truncate text-sm font-medium text-foreground" title={member.username}>
            {member.displayName}
          </span>
          {member.isSelf && (
            <span className="rounded bg-brand/10 px-1 py-0.5 text-[10px] leading-none text-brand">你</span>
          )}
          {typeof latency === "number" && (
            <span
              title={"延迟 " + latency + " ms（到语音服务器往返）"}
              className={cn(
                "shrink-0 rounded px-1 py-0.5 text-[10px] leading-none tabular",
                latency <= 80
                  ? "bg-success/10 text-success"
                  : latency <= 160
                    ? "bg-warning/10 text-warning"
                    : "bg-destructive/10 text-destructive",
              )}
            >
              {latency} ms
            </span>
          )}
        </div>

        {(showRoleBadge(member.role) || member.forceMuted || (stageMode && (member.stageMuted || member.stageRequested || member.onStage))) && (
          <div className="flex flex-wrap items-center justify-center gap-1">
            {showRoleBadge(member.role) && <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABEL[member.role]}</Badge>}
            {member.forceMuted && <Badge tone="bad">强制静音</Badge>}
            {stageMode && member.stageRequested && <Badge tone="warn">申请上麦</Badge>}
            {stageMode && member.onStage && <Badge tone="good">麦上</Badge>}
            {stageMode && member.stageMuted && !member.stageRequested && <Badge tone="neutral">听众</Badge>}
          </div>
        )}

        {member.statusText && !member.isSelf && (
          <p className="max-w-full truncate text-[11px] text-muted-foreground" title={member.statusText}>
            {member.statusText}
          </p>
        )}

        {member.isSelf ? (
          <div className="mt-1 w-full space-y-1.5">
            <SelfLevelMeter active={!member.muted} />
            <p className="text-[10px] text-muted-foreground">
              {member.muted ? (member.forceMuted ? "已被强制静音" : "麦克风已静音") : "麦克风已开启"}
              {member.deafened ? " · 已关闭收听" : ""}
            </p>
          </div>
        ) : (
          <>
            <p className="text-[10px] text-muted-foreground">
              {stageMode && member.stageRequested ? "等待上麦" : stageMode && member.stageMuted ? "听众" : member.muted ? "已静音" : member.deafened ? "已关闭收听" : "在房间中"}
              {member.joinedAt ? " · " + formatRelative(member.joinedAt) + "加入" : ""}
            </p>
            <div
              className="mt-0.5 w-full space-y-1.5"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 text-muted-foreground">
                  {volume <= 0 ? <VolumeX className="h-3 w-3" /> : volume < 60 ? <Volume1 className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                  本地音量
                </span>
                <span className="tabular font-medium text-foreground">{volume}%</span>
              </div>
              <Slider
                value={volume}
                min={0}
                max={100}
                step={1}
                onChange={(value) => onVolumeChange(member.userId, value)}
              />
            </div>
          </>
        )}

        {panelOpen && !member.isSelf && (
          <div
            className="mt-0.5 flex w-full items-center gap-1.5"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => onLocalMute(member.userId, volume > 0)}
              className={cn(
                "flex-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                volume > 0
                  ? "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                  : "border-success/25 bg-success/10 text-success",
              )}
            >
              {volume > 0 ? "本地静音" : "取消本地静音"}
            </button>
            <button
              type="button"
              onClick={() => onVolumeChange(member.userId, 100)}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              100%
            </button>
          </div>
        )}
      </div>

      {member.muted && !member.isSelf && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card p-1" title="已静音">
          <MicOff className="h-3 w-3 text-destructive" />
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

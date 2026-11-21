import type { ReactNode } from "react";
import { Activity, Server, Wifi } from "lucide-react";
import { audioSummary, formatBitrate } from "@airmic/shared";
import type { AudioOverride } from "@airmic/shared";
import { Alert, Badge, Divider, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/format";
import { usePeerStats } from "@/components/room/useVoice";
import { useAppStore } from "@/stores/app";
import { useRoomStore } from "@/stores/room";
import { useSettingsStore } from "@/stores/settings";
import { replaceLocalAudioOverride, useEffectiveAudioSettings } from "./audioPrefs";

type QualityMode = "follow" | "low" | "minimal" | "mono";

interface QualityModeOption {
  id: QualityMode;
  title: string;
  build: () => AudioOverride | null;
}

const QUALITY_MODES: QualityModeOption[] = [
  {
    id: "follow",
    title: "跟随房间",
    build: () => null,
  },
  {
    id: "low",
    title: "省流模式（24 kbps）",
    build: () => ({ bitrate: 24000, channels: 1, dtx: true }),
  },
  {
    id: "minimal",
    title: "极省流（16 kbps）",
    build: () => ({ bitrate: 16000, channels: 1, dtx: true }),
  },
  {
    id: "mono",
    title: "仅降为单声道",
    build: () => ({ channels: 1 }),
  },
];

type QualityTone = { dot: string; text: string };

const QUALITY_TONES: Record<"good" | "fair" | "poor" | "unknown", QualityTone> = {
  good: { dot: "bg-success", text: "text-success" },
  fair: { dot: "bg-warning", text: "text-warning" },
  poor: { dot: "bg-destructive", text: "text-destructive" },
  unknown: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

/** 网络设置：连接概览、成员质量与本地省流覆盖 */
export function NetworkTab() {
  const effective = useEffectiveAudioSettings();
  const override = useSettingsStore((state) => state.localAudioOverride);
  const connection = useAppStore((state) => state.connection);
  const server = useAppStore((state) => state.server);
  const peers = useRoomStore((state) => state.peers);
  const peerStats = usePeerStats();

  const mode = detectMode(override);
  const connected = connection === "online";
  const voiceAvailable = server?.voiceAvailable === true;

  const applyMode = (option: QualityModeOption) => {
    replaceLocalAudioOverride(option.build());
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionTitle>连接状态</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          <InfoRow
            icon={<Wifi className={cn("h-3.5 w-3.5", connected ? "text-success" : "text-warning")} />}
            label="实时连接"
            value={connected ? "已连接" : connection === "reconnecting" ? "重连中" : connection === "connecting" ? "连接中" : "已断开"}
            tone={connected ? "good" : "warn"}
          />
          <InfoRow
            icon={<Server className={cn("h-3.5 w-3.5", voiceAvailable ? "text-info" : "text-warning")} />}
            label="语音传输"
            value={voiceAvailable ? "LiveKit" : "未配置"}
            tone={voiceAvailable ? "good" : "warn"}
          />
        </div>
        {!voiceAvailable && <Alert tone="warning">语音未配置，请联系管理员。</Alert>}
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>队友连接质量</SectionTitle>
        {peers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-5 text-center text-xs text-muted-foreground">
            暂无队友
          </div>
        ) : (
          <div className="space-y-1.5">
            {peers.map((peer) => {
              const stats = peerStats[peer.userId];
              const tone = QUALITY_TONES[stats?.quality ?? "unknown"];
              return (
                <div
                  key={peer.userId}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2 text-xs text-foreground/85">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} />
                    <span className="truncate">{peer.displayName}</span>
                  </span>
                  <span className={cn("flex shrink-0 items-center gap-2 text-xs", tone.text)}>
                    <Activity className="h-3 w-3 shrink-0" />
                    <span className="tabular">{stats?.rttMs !== null && stats?.rttMs !== undefined ? stats.rttMs + " ms" : "检测中"}</span>
                    {stats && stats.packetLossPct !== null && <span className="tabular">丢包 {stats.packetLossPct.toFixed(1)}%</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>我的发送音质</SectionTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          目标码率 {formatBitrate(effective.bitrate)}{mode === "custom" && ` · 自定义 · ${audioSummary(effective)}`}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {QUALITY_MODES.map((option) => {
            const active = mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => applyMode(option)}
                className={cn(
                  "min-h-11 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary/30 bg-accent" : "border-border bg-card hover:bg-accent/60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-xs", active ? "font-medium text-foreground" : "text-foreground/85")}>{option.title}</span>
                  {active && <Badge tone="brand">使用中</Badge>}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function detectMode(override: AudioOverride | null): QualityMode | "custom" {
  if (!override) return "follow";
  if (override.bitrate === 24000 && override.channels === 1) return "low";
  if (override.bitrate === 16000 && override.channels === 1) return "minimal";
  if (override.channels === 1 && override.bitrate === undefined) return "mono";
  return "custom";
}

function InfoRow({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "truncate text-xs font-medium",
          tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

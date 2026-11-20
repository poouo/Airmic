import type { ReactNode } from "react";
import { Activity, Globe, Server, Wifi, WifiOff } from "lucide-react";
import { audioSummary, formatBitrate } from "@airmic/shared";
import type { AudioOverride } from "@airmic/shared";
import { Alert, Badge, Divider, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/format";
import { usePeerStats } from "@/components/room/useVoice";
import { useAppStore } from "@/stores/app";
import { useRoomStore } from "@/stores/room";
import { useSettingsStore } from "@/stores/settings";
import { replaceLocalAudioOverride, useBaseAudioSettings, useEffectiveAudioSettings } from "./audioPrefs";

type QualityMode = "follow" | "low" | "minimal" | "mono";

interface QualityModeOption {
  id: QualityMode;
  title: string;
  description: string;
  build: () => AudioOverride | null;
}

const QUALITY_MODES: QualityModeOption[] = [
  {
    id: "follow",
    title: "跟随房间",
    description: "使用房间与服务器下发的音质参数",
    build: () => null,
  },
  {
    id: "low",
    title: "省流模式（24 kbps）",
    description: "单声道 + DTX，移动网络下更省流量",
    build: () => ({ bitrate: 24000, channels: 1, dtx: true }),
  },
  {
    id: "minimal",
    title: "极省流（16 kbps）",
    description: "码率降到最低，优先保证不断连",
    build: () => ({ bitrate: 16000, channels: 1, dtx: true }),
  },
  {
    id: "mono",
    title: "仅降为单声道",
    description: "保留房间码率，只把立体声改为单声道",
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
  const base = useBaseAudioSettings();
  const effective = useEffectiveAudioSettings();
  const override = useSettingsStore((state) => state.localAudioOverride);
  const connection = useAppStore((state) => state.connection);
  const server = useAppStore((state) => state.server);
  const peers = useRoomStore((state) => state.peers);
  const peerStats = usePeerStats();

  const mode = detectMode(override);
  const totalUpload = effective.bitrate * Math.max(0, peers.length);
  const connected = connection === "online";
  const voiceAvailable = server?.voiceAvailable === true;
  const livekitUrl = server?.livekitUrl ?? null;

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
            icon={<Globe className={cn("h-3.5 w-3.5", livekitUrl ? "text-muted-foreground" : "text-warning")} />}
            label="LiveKit 地址"
            value={livekitUrl ? "已配置" : "未配置"}
            tone={livekitUrl ? "neutral" : "warn"}
          />
          <InfoRow
            icon={<Server className={cn("h-3.5 w-3.5", voiceAvailable ? "text-info" : "text-warning")} />}
            label="语音传输"
            value={voiceAvailable ? "服务端 SFU 中转" : "语音中转服务未配置"}
            tone={voiceAvailable ? "good" : "warn"}
          />
          <InfoRow
            icon={<Server className="h-3.5 w-3.5 text-muted-foreground" />}
            label="房间成员"
            value={peers.length + " 位队友"}
          />
        </div>
        {livekitUrl ? (
          <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
            <p className="truncate font-mono text-xs text-muted-foreground" title={livekitUrl}>
              所有语音经服务端 SFU 中转：{livekitUrl}
            </p>
          </div>
        ) : (
          <Alert tone="warning">语音中转服务未配置，请管理员在后台或环境变量中配置 LiveKit，配置完成前房间内无法通话。</Alert>
        )}
        {!connected && (
          <p className="flex items-center gap-1.5 text-xs leading-relaxed text-warning">
            <WifiOff className="h-3.5 w-3.5 shrink-0" /> 实时连接断开时无法收发语音，连接恢复后会自动重建。
          </p>
        )}
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>队友连接质量</SectionTitle>
        {peers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-5 text-center text-xs text-muted-foreground">
            房间里还没有其他成员
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
        <SectionTitle>本地音质覆盖（省流量）</SectionTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          只影响你发送给队友的语音码率，不会改变房间设置。当前生效：{audioSummary(effective)}
          {peers.length > 0 && " · 预计上行约 " + formatBitrate(totalUpload)}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {QUALITY_MODES.map((option) => {
            const active = mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => applyMode(option)}
                className={cn(
                  "rounded-xl border px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary/30 bg-accent" : "border-border bg-card hover:bg-accent/60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-xs", active ? "font-medium text-foreground" : "text-foreground/85")}>{option.title}</span>
                  {active && <Badge tone="brand">使用中</Badge>}
                </div>
                <p className={cn("mt-1 text-xs leading-relaxed", active ? "text-muted-foreground" : "text-muted-foreground/90")}>
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>
        {mode === "custom" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            当前使用了自定义的音质覆盖（{audioSummary(effective)}），选择上面的模式可以快速切换。房间基准音质：{audioSummary(base)}。
          </p>
        )}
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

import { Activity, Globe, Server, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { audioSummary, formatBitrate } from "@airmic/shared";
import type { AudioOverride } from "@airmic/shared";
import { Badge, Divider, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/format";
import { qualityMeta } from "@/components/room/quality";
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
  const urls = (server?.iceServers ?? []).flatMap((item) =>
    typeof item.urls === "string" ? [item.urls] : item.urls,
  );
  const totalUpload = effective.bitrate * Math.max(0, peers.length);
  const connected = connection === "online";

  const applyMode = (option: QualityModeOption) => {
    replaceLocalAudioOverride(option.build());
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionTitle>连接状态</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          <InfoRow
            icon={<Wifi className={cn("h-3.5 w-3.5", connected ? "text-good-400" : "text-warn-400")} />}
            label="实时连接"
            value={connected ? "已连接" : connection === "reconnecting" ? "重连中" : connection === "connecting" ? "连接中" : "已断开"}
            tone={connected ? "good" : "warn"}
          />
          <InfoRow
            icon={<Globe className="h-3.5 w-3.5 text-mist-400" />}
            label="ICE 服务器"
            value={urls.length + " 台"}
          />
          <InfoRow
            icon={<ShieldCheck className={cn("h-3.5 w-3.5", server?.forceRelay ? "text-warn-400" : "text-mist-400")} />}
            label="传输模式"
            value={server?.forceRelay ? "强制 TURN 中继" : "P2P 优先（失败时才中继）"}
            tone={server?.forceRelay ? "warn" : "neutral"}
          />
          <InfoRow
            icon={<Server className="h-3.5 w-3.5 text-mist-400" />}
            label="房间成员"
            value={peers.length + " 位队友"}
          />
        </div>
        {urls.length > 0 && (
          <div className="max-h-24 space-y-0.5 overflow-y-auto rounded-xl bg-ink-900/60 px-3 py-2 app-scroll ring-1 ring-white/5">
            {urls.map((url, index) => (
              <p key={url + index} className="truncate font-mono text-[11px] text-mist-500">
                {url}
              </p>
            ))}
          </div>
        )}
        {!connected && (
          <p className="flex items-center gap-1.5 text-[11px] text-warn-400">
            <WifiOff className="h-3 w-3" /> 实时连接断开时无法收发语音，连接恢复后会自动重建。
          </p>
        )}
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>队友连接质量</SectionTitle>
        {peers.length === 0 ? (
          <p className="rounded-xl bg-ink-900/60 px-3 py-3 text-center text-[11px] text-mist-500 ring-1 ring-white/5">
            房间里还没有其他成员
          </p>
        ) : (
          <div className="space-y-1.5">
            {peers.map((peer) => {
              const stats = peerStats[peer.userId];
              const meta = qualityMeta(stats?.quality ?? "unknown");
              return (
                <div
                  key={peer.userId}
                  className="flex items-center justify-between gap-2 rounded-xl bg-ink-900/60 px-3 py-2 ring-1 ring-white/5"
                >
                  <span className="flex min-w-0 items-center gap-2 text-xs text-mist-200">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dotClass)} />
                    <span className="truncate">{peer.displayName}</span>
                  </span>
                  <span className={cn("flex shrink-0 items-center gap-2 text-[11px]", meta.textClass)}>
                    <Activity className="h-3 w-3" />
                    <span>{stats?.rttMs !== null && stats?.rttMs !== undefined ? stats.rttMs + " ms" : "检测中"}</span>
                    {stats && stats.packetLossPct !== null && <span>丢包 {stats.packetLossPct.toFixed(1)}%</span>}
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
        <p className="-mt-1 text-[11px] text-mist-500">
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
                  "rounded-xl border px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border-brand-400/60 bg-brand-500/15"
                    : "border-white/10 bg-ink-900/60 hover:border-white/20 hover:bg-ink-800/60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-xs font-medium", active ? "text-brand-200" : "text-mist-200")}>{option.title}</span>
                  {active && <Badge tone="brand">使用中</Badge>}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-mist-500">{option.description}</p>
              </button>
            );
          })}
        </div>
        {mode === "custom" && (
          <p className="text-[11px] text-mist-500">
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
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-ink-900/60 px-3 py-2.5 ring-1 ring-white/5">
      <span className="flex items-center gap-1.5 text-[11px] text-mist-400">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "text-[11px] font-medium",
          tone === "good" ? "text-good-400" : tone === "warn" ? "text-warn-400" : "text-mist-200",
        )}
      >
        {value}
      </span>
    </div>
  );
}

import type { PeerNetworkStats, VoiceQuality } from "@/voice/engine";

export interface QualityMeta {
  label: string;
  textClass: string;
  dotClass: string;
  bars: number;
}

const QUALITY_META: Record<VoiceQuality, QualityMeta> = {
  good: { label: "连接良好", textClass: "text-success", dotClass: "bg-success", bars: 3 },
  fair: { label: "连接一般", textClass: "text-warning", dotClass: "bg-warning", bars: 2 },
  poor: { label: "连接较差", textClass: "text-destructive", dotClass: "bg-destructive", bars: 1 },
  unknown: { label: "正在检测", textClass: "text-muted-foreground", dotClass: "bg-muted-foreground", bars: 0 },
};

export function qualityMeta(quality: VoiceQuality): QualityMeta {
  return QUALITY_META[quality];
}

export function qualityTooltip(stats: PeerNetworkStats | undefined): string {
  if (!stats) return "正在检测连接质量";
  const parts: string[] = [qualityMeta(stats.quality).label];
  if (stats.rttMs !== null) parts.push("延迟 " + stats.rttMs + " ms");
  if (stats.packetLossPct !== null) parts.push("丢包 " + stats.packetLossPct.toFixed(1) + "%");
  if (stats.jitterMs !== null) parts.push("抖动 " + stats.jitterMs + " ms");
  // SFU 模式下目前只汇总连接质量，码率/丢包等详细统计可能不可用
  if (stats.outboundKbps > 0 || stats.inboundKbps > 0) {
    parts.push("上行 " + Math.round(stats.outboundKbps) + " kbps", "下行 " + Math.round(stats.inboundKbps) + " kbps");
  }
  parts.push("服务端中转");
  return parts.join(" · ");
}

const QUALITY_RANK: Record<VoiceQuality, number> = { poor: 0, fair: 1, unknown: 2, good: 3 };

/** 取一组成员里最差的质量等级（用于底部控制栏的连接概览） */
export function worstQuality(list: PeerNetworkStats[]): VoiceQuality {
  let result: VoiceQuality = "unknown";
  let rank = 99;
  for (const stats of list) {
    const next = QUALITY_RANK[stats.quality];
    if (next < rank) {
      rank = next;
      result = stats.quality;
    }
  }
  return result;
}

export function averageRtt(list: PeerNetworkStats[]): number | null {
  const values = list.map((stats) => stats.rttMs).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

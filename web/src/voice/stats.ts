import type { PeerNetworkStats, VoiceQuality } from "./types";

interface RawStats {
  timestamp: number;
  bytesReceived: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  jitterSeconds: number | null;
  bytesSent: number | null;
  rttSeconds: number | null;
  fractionLost: number | null;
}

interface CounterSample {
  timestamp: number;
  bytesReceived: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  bytesSent: number | null;
}

/**
 * 从 RTCPeerConnection.getStats() 的报告中提取音频收发指标。
 * 每次 collect 与上一次结果做差得到实时码率/丢包率。
 */
export class PeerStatsCollector {
  private previous: CounterSample | null = null;

  constructor(private readonly userId: number) {}

  async collect(connection: RTCPeerConnection): Promise<PeerNetworkStats> {
    let report: RTCStatsReport;
    try {
      report = await connection.getStats();
    } catch {
      return emptyStats(this.userId);
    }
    const raw = extractRawStats(report);
    const previous = this.previous;

    let inboundKbps = 0;
    let outboundKbps = 0;
    let lossPct: number | null = null;

    if (previous && raw.timestamp > previous.timestamp) {
      const elapsedSeconds = (raw.timestamp - previous.timestamp) / 1000;
      if (raw.bytesReceived !== null && previous.bytesReceived !== null) {
        const delta = Math.max(0, raw.bytesReceived - previous.bytesReceived);
        inboundKbps = (delta * 8) / 1000 / elapsedSeconds;
      }
      if (raw.bytesSent !== null && previous.bytesSent !== null) {
        const delta = Math.max(0, raw.bytesSent - previous.bytesSent);
        outboundKbps = (delta * 8) / 1000 / elapsedSeconds;
      }
      if (raw.packetsReceived !== null && previous.packetsReceived !== null) {
        const received = Math.max(0, raw.packetsReceived - previous.packetsReceived);
        const lost =
          raw.packetsLost !== null && previous.packetsLost !== null
            ? Math.max(0, raw.packetsLost - previous.packetsLost)
            : 0;
        const total = received + lost;
        if (total > 0) lossPct = (lost / total) * 100;
      }
    }
    if (lossPct === null && raw.fractionLost !== null) lossPct = raw.fractionLost * 100;

    const rttMs = raw.rttSeconds === null ? null : Math.round(raw.rttSeconds * 1000);
    const jitterMs = raw.jitterSeconds === null ? null : Math.round(raw.jitterSeconds * 1000);

    this.previous = {
      timestamp: raw.timestamp,
      bytesReceived: raw.bytesReceived,
      packetsReceived: raw.packetsReceived,
      packetsLost: raw.packetsLost,
      bytesSent: raw.bytesSent,
    };

    return {
      userId: this.userId,
      rttMs,
      packetLossPct: lossPct === null ? null : round1(lossPct),
      jitterMs,
      inboundKbps: round1(inboundKbps),
      outboundKbps: round1(outboundKbps),
      quality: evaluateQuality(rttMs, lossPct, jitterMs),
    };
  }
}

function emptyStats(userId: number): PeerNetworkStats {
  return {
    userId,
    rttMs: null,
    packetLossPct: null,
    jitterMs: null,
    inboundKbps: 0,
    outboundKbps: 0,
    quality: "unknown",
  };
}

function extractRawStats(report: RTCStatsReport): RawStats {
  const raw: RawStats = {
    timestamp: performance.now(),
    bytesReceived: null,
    packetsReceived: null,
    packetsLost: null,
    jitterSeconds: null,
    bytesSent: null,
    rttSeconds: null,
    fractionLost: null,
  };
  let fallbackCandidateRtt: number | null = null;
  let nominatedCandidateRtt: number | null = null;

  report.forEach((value: unknown) => {
    const stat = asRecord(value);
    if (!stat) return;
    const type = stringField(stat, "type");
    const kind = stringField(stat, "kind");
    if (type === "inbound-rtp" && kind === "audio") {
      raw.bytesReceived = maxDefined(raw.bytesReceived, numberField(stat, "bytesReceived"));
      raw.packetsReceived = maxDefined(raw.packetsReceived, numberField(stat, "packetsReceived"));
      raw.packetsLost = maxDefined(raw.packetsLost, numberField(stat, "packetsLost"));
      raw.jitterSeconds = maxDefined(raw.jitterSeconds, numberField(stat, "jitter"));
    } else if (type === "outbound-rtp" && kind === "audio") {
      raw.bytesSent = maxDefined(raw.bytesSent, numberField(stat, "bytesSent"));
    } else if (type === "remote-inbound-rtp" && kind === "audio") {
      raw.rttSeconds = maxDefined(raw.rttSeconds, numberField(stat, "roundTripTime"));
      raw.fractionLost = maxDefined(raw.fractionLost, numberField(stat, "fractionLost"));
    } else if (type === "candidate-pair" && stringField(stat, "state") === "succeeded") {
      const rtt = numberField(stat, "currentRoundTripTime");
      if (rtt !== null) {
        if (stat["nominated"] === true) nominatedCandidateRtt = maxDefined(nominatedCandidateRtt, rtt);
        else fallbackCandidateRtt = maxDefined(fallbackCandidateRtt, rtt);
      }
    }
  });

  if (raw.rttSeconds === null) {
    raw.rttSeconds = nominatedCandidateRtt ?? fallbackCandidateRtt;
  }
  return raw;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function maxDefined(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  if (current === null) return next;
  return Math.max(current, next);
}

function evaluateQuality(rttMs: number | null, lossPct: number | null, jitterMs: number | null): VoiceQuality {
  if (rttMs === null && lossPct === null && jitterMs === null) return "unknown";
  if ((lossPct !== null && lossPct >= 8) || (rttMs !== null && rttMs >= 400) || (jitterMs !== null && jitterMs >= 60)) {
    return "poor";
  }
  if ((lossPct !== null && lossPct >= 3) || (rttMs !== null && rttMs >= 200) || (jitterMs !== null && jitterMs >= 30)) {
    return "fair";
  }
  return "good";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

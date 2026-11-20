import { useEffect, useState } from "react";
import { voice } from "@/voice/engine";
import type { PeerNetworkStats, VoiceStateSnapshot } from "@/voice/engine";

export interface LocalLevelState {
  level: number;
  speaking: boolean;
}

/** 订阅语音引擎状态 */
export function useVoiceState(): VoiceStateSnapshot {
  const [state, setState] = useState<VoiceStateSnapshot>(() => voice.getState());
  useEffect(() => voice.on("state", setState), []);
  return state;
}

/** 订阅本地麦克风电平（约 10 次/秒，只应在电平条组件中使用） */
export function useLocalLevel(): LocalLevelState {
  const [level, setLevel] = useState<LocalLevelState>({ level: 0, speaking: false });
  useEffect(() => voice.on("local-level", (payload) => setLevel(payload)), []);
  return level;
}

/** 只订阅"是否正在说话"（值不变时不会触发重渲染） */
export function useLocalSpeaking(): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(
    () =>
      voice.on("local-level", (payload) => {
        setSpeaking((current) => (current === payload.speaking ? current : payload.speaking));
      }),
    [],
  );
  return speaking;
}

/** 订阅每个成员的连接质量（每 2 秒更新） */
export function usePeerStats(): Record<number, PeerNetworkStats> {
  const [stats, setStats] = useState<Record<number, PeerNetworkStats>>({});
  useEffect(
    () =>
      voice.on("peer-stats", (payload) => {
        setStats((current) => {
          const previous = current[payload.userId];
          if (
            previous &&
            previous.rttMs === payload.rttMs &&
            previous.packetLossPct === payload.packetLossPct &&
            previous.jitterMs === payload.jitterMs &&
            previous.inboundKbps === payload.inboundKbps &&
            previous.outboundKbps === payload.outboundKbps &&
            previous.quality === payload.quality
          ) {
            return current;
          }
          return { ...current, [payload.userId]: payload };
        });
      }),
    [],
  );
  return stats;
}

/** 订阅远端屏幕共享流（按 userId 索引，userId 为 null 时清空） */
export function useScreenStreams(): Record<number, MediaStream | null> {
  const [streams, setStreams] = useState<Record<number, MediaStream | null>>({});
  useEffect(
    () =>
      voice.on("screen-stream", (payload) => {
        if (payload.userId === null) {
          setStreams({});
          return;
        }
        setStreams((current) => {
          const userId = payload.userId as number;
          if (current[userId] === payload.stream) return current;
          return { ...current, [userId]: payload.stream };
        });
      }),
    [],
  );
  return streams;
}

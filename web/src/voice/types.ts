import type { AudioSettings } from "@airmic/shared";

/** 语音连接质量等级（用于成员卡片的质量图标） */
export type VoiceQuality = "good" | "fair" | "poor" | "unknown";

/** 一个参与者的语音连接质量（SFU 模式下由 LiveKit ConnectionQuality 汇总，每 2 秒更新） */
export interface PeerNetworkStats {
  userId: number;
  /** 往返延迟（毫秒） */
  rttMs: number | null;
  /** 下行丢包率（0-100） */
  packetLossPct: number | null;
  /** 抖动（毫秒） */
  jitterMs: number | null;
  /** 接收码率（kbps） */
  inboundKbps: number;
  /** 发送码率（kbps） */
  outboundKbps: number;
  quality: VoiceQuality;
}

/** 语音引擎对外暴露的状态快照 */
export interface VoiceStateSnapshot {
  /** 用户意图：是否开启麦克风 */
  micEnabled: boolean;
  /** 是否开启耳聋（静音所有远端声音） */
  deafened: boolean;
  /** 是否正在共享屏幕 */
  screenSharing: boolean;
  /** PTT 按键当前是否被按住 */
  pttActive: boolean;
  /** 是否被管理员强制静音 */
  forceMuted: boolean;
  /** 是否成功获取到麦克风轨道（false 表示只能收听） */
  hasMicrophone: boolean;
  /** 浏览器自动播放策略拦截了音频输出时为 true */
  audioBlocked: boolean;
  /** 当前生效的音频参数（房间音质 + 本机覆盖） */
  audioSettings: AudioSettings | null;
}

/** 语音引擎事件表 */
export interface VoiceEventMap {
  /** 本地麦克风音量（0-1）与说话判定 */
  "local-level": { level: number; speaking: boolean };
  /** 远端成员音量/说话状态（本地分析，用于可选的 UI 动效） */
  "peer-level": { userId: number; level: number; speaking: boolean };
  /** 远端成员音频流（引擎自行通过 Web Audio 播放，事件用于可视化/调试） */
  "peer-stream": { userId: number; stream: MediaStream | null };
  /** 远端成员屏幕共享流；userId 为 null 表示清空全部 */
  "screen-stream": { userId: number | null; stream: MediaStream | null };
  /** 每个成员的连接质量 */
  "peer-stats": PeerNetworkStats;
  /** 语音引擎状态变化 */
  state: VoiceStateSnapshot;
  /** 错误提示（页面/设置弹窗通过 Toast 展示） */
  error: { code: string; message: string };
}

export type VoiceEventHandler<K extends keyof VoiceEventMap> = (payload: VoiceEventMap[K]) => void;

export const INITIAL_VOICE_STATE: VoiceStateSnapshot = {
  micEnabled: true,
  deafened: false,
  screenSharing: false,
  pttActive: false,
  forceMuted: false,
  hasMicrophone: false,
  audioBlocked: false,
  audioSettings: null,
};

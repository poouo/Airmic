import type { AudioOverride, AudioPresetId, AudioSettings } from "./types.js";

export const APP_NAME = "AirMic";
export const APP_VERSION = "1.2.2";
export const PROTOCOL_VERSION = 1;

export const AUDIO_LIMITS = {
  minBitrate: 6000,
  maxBitrate: 160000,
  bitrateStep: 1000,
  sampleRates: [16000, 24000, 32000, 48000] as const,
  minChannels: 1,
  maxChannels: 2,
} as const;

const PRESET_DEFINITIONS: Record<Exclude<AudioPresetId, "custom">, AudioSettings> = {
  "voice-low": {
    preset: "voice-low",
    bitrate: 16000,
    sampleRate: 24000,
    channels: 1,
    dtx: true,
    fec: true,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  "voice-standard": {
    preset: "voice-standard",
    bitrate: 32000,
    sampleRate: 48000,
    channels: 1,
    dtx: true,
    fec: true,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  "voice-high": {
    preset: "voice-high",
    bitrate: 64000,
    sampleRate: 48000,
    channels: 1,
    dtx: false,
    fec: true,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  music: {
    preset: "music",
    bitrate: 96000,
    sampleRate: 48000,
    channels: 2,
    dtx: false,
    fec: true,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

export const AUDIO_PRESETS = PRESET_DEFINITIONS;

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { ...PRESET_DEFINITIONS["voice-standard"] };

export interface AudioPresetInfo {
  id: AudioPresetId;
  label: string;
  description: string;
  settings: AudioSettings;
}

export const AUDIO_PRESET_LIST: AudioPresetInfo[] = [
  {
    id: "voice-low",
    label: "省流语音",
    description: "16 kbps 单声道，弱网/移动网络优先",
    settings: PRESET_DEFINITIONS["voice-low"],
  },
  {
    id: "voice-standard",
    label: "标准语音",
    description: "32 kbps 单声道，日常开黑推荐",
    settings: PRESET_DEFINITIONS["voice-standard"],
  },
  {
    id: "voice-high",
    label: "高清语音",
    description: "64 kbps 单声道，人声更清晰",
    settings: PRESET_DEFINITIONS["voice-high"],
  },
  {
    id: "music",
    label: "音乐模式",
    description: "96 kbps 立体声，关闭降噪适合放歌",
    settings: PRESET_DEFINITIONS["music"],
  },
  {
    id: "custom",
    label: "自定义",
    description: "手动设置码率、采样率、声道与处理开关",
    settings: { ...DEFAULT_AUDIO_SETTINGS, preset: "custom" },
  },
];

export function isAudioPresetId(value: unknown): value is AudioPresetId {
  return value === "voice-low" || value === "voice-standard" || value === "voice-high" || value === "music" || value === "custom";
}

export function presetSettings(id: AudioPresetId): AudioSettings {
  if (id === "custom") return { ...DEFAULT_AUDIO_SETTINGS, preset: "custom" };
  return { ...PRESET_DEFINITIONS[id] };
}

/** 将任意外部输入规范化为合法的音频设置 */
export function normalizeAudioSettings(input: Partial<AudioSettings> | null | undefined, base: AudioSettings = DEFAULT_AUDIO_SETTINGS): AudioSettings {
  const merged: AudioSettings = { ...base, ...(input ?? {}) } as AudioSettings;
  const bitrate = clampNumber(Number(merged.bitrate), AUDIO_LIMITS.minBitrate, AUDIO_LIMITS.maxBitrate);
  const stepped = Math.round(bitrate / AUDIO_LIMITS.bitrateStep) * AUDIO_LIMITS.bitrateStep;
  const sampleRates = AUDIO_LIMITS.sampleRates as readonly number[];
  const sampleRate = sampleRates.includes(Number(merged.sampleRate))
    ? Number(merged.sampleRate)
    : nearestNumber(sampleRates, Number(merged.sampleRate));

  const result: AudioSettings = {
    preset: isAudioPresetId(merged.preset) ? merged.preset : "custom",
    bitrate: stepped,
    sampleRate,
    channels: Number(merged.channels) === 2 ? 2 : 1,
    dtx: Boolean(merged.dtx),
    fec: Boolean(merged.fec),
    echoCancellation: Boolean(merged.echoCancellation),
    noiseSuppression: Boolean(merged.noiseSuppression),
    autoGainControl: Boolean(merged.autoGainControl),
  };
  if (result.preset !== "custom" && !audioSettingsEqual(result, PRESET_DEFINITIONS[result.preset])) {
    result.preset = "custom";
  }
  return result;
}

/**
 * 服务器默认参数 + 房间覆盖 => 房间生效参数。
 * 若覆盖里指定了预设，则以该预设为基础再叠加显式字段。
 */
export function mergeAudioSettings(base: AudioSettings, override: AudioOverride | null | undefined): AudioSettings {
  if (!override) return normalizeAudioSettings(base, base);
  const { preset, ...fields } = override;
  let result: AudioSettings = preset && preset !== "custom" ? { ...PRESET_DEFINITIONS[preset] } : { ...base };
  result = { ...result, ...fields } as AudioSettings;
  result.preset = preset ?? deriveAudioPreset(result);
  return normalizeAudioSettings(result, base);
}

/** 计算房间覆盖与基准的差异；与基准一致时返回 null */
export function diffAudioSettings(base: AudioSettings, settings: AudioSettings): AudioOverride | null {
  const out: AudioOverride = {};
  let any = false;
  const keys: (keyof Omit<AudioSettings, "preset">)[] = [
    "bitrate",
    "sampleRate",
    "channels",
    "dtx",
    "fec",
    "echoCancellation",
    "noiseSuppression",
    "autoGainControl",
  ];
  for (const key of keys) {
    if (settings[key] !== base[key]) {
      (out as Record<string, unknown>)[key] = settings[key];
      any = true;
    }
  }
  const derived = deriveAudioPreset(settings);
  if (derived !== "custom" && derived !== deriveAudioPreset(base)) {
    out.preset = derived;
    any = true;
  }
  return any ? out : null;
}

export function deriveAudioPreset(settings: AudioSettings): AudioPresetId {
  for (const [id, preset] of Object.entries(PRESET_DEFINITIONS) as [Exclude<AudioPresetId, "custom">, AudioSettings][]) {
    if (audioSettingsEqual(settings, preset)) return id;
  }
  return "custom";
}

export function audioSettingsEqual(a: AudioSettings, b: AudioSettings): boolean {
  return (
    a.bitrate === b.bitrate &&
    a.sampleRate === b.sampleRate &&
    a.channels === b.channels &&
    a.dtx === b.dtx &&
    a.fec === b.fec &&
    a.echoCancellation === b.echoCancellation &&
    a.noiseSuppression === b.noiseSuppression &&
    a.autoGainControl === b.autoGainControl
  );
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function nearestNumber(values: readonly number[], value: number): number {
  if (!Number.isFinite(value)) return values[values.length - 1] as number;
  return values.reduce((best, cur) => (Math.abs(cur - value) < Math.abs(best - value) ? cur : best), values[0] as number);
}

/** getUserMedia 使用的音频约束 */
export function audioConstraints(settings: AudioSettings): Record<string, unknown> {
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: settings.channels,
    sampleRate: settings.sampleRate,
  };
}

/** 生成 Opus fmtp 参数串（用于 SDP 修饰） */
export function buildOpusFmtp(settings: AudioSettings): string {
  const params: Record<string, string> = {
    maxaveragebitrate: String(settings.bitrate),
    stereo: settings.channels === 2 ? "1" : "0",
    "sprop-stereo": settings.channels === 2 ? "1" : "0",
    useinbandfec: settings.fec ? "1" : "0",
    usedtx: settings.dtx ? "1" : "0",
  };
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join(";");
}

/**
 * 修改 SDP 中 opus 的 fmtp 参数，用于设置码率/立体声/DTX/FEC。
 * 只处理带 opus 的媒体段，生成内容不影响其他编解码器。
 */
export function applyOpusToSdp(sdp: string, settings: AudioSettings): string {
  if (!sdp || !sdp.includes("opus")) return sdp;
  const lines = sdp.split(/\r\n|\n/);
  const output: string[] = [];
  const fmtp = buildOpusFmtp(settings);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const rtpmapMatch = line.match(/^a=rtpmap:(\d+) opus\/48000\/2/i);
    if (rtpmapMatch) {
      const payloadType = rtpmapMatch[1] as string;
      output.push(line);
      // 如果原 SDP 已有该 PT 的 fmtp，替换下一行（任何位置稍后统一处理）
      const existingFmtpIndex = lines.findIndex((candidate, index) => {
        if (index <= i) return false;
        if (!candidate.startsWith("a=fmtp:")) return false;
        const m = candidate.match(/^a=fmtp:(\d+) /);
        return m !== null && m[1] === payloadType;
      });
      if (existingFmtpIndex >= 0) {
        const existing = lines[existingFmtpIndex] as string;
        const existingParams = existing.replace(/^a=fmtp:\d+ /, "");
        lines[existingFmtpIndex] = `a=fmtp:${payloadType} ${mergeFmtpParams(existingParams, fmtp)}`;
      } else {
        output.push(`a=fmtp:${payloadType} ${fmtp}`);
      }
      continue;
    }
    output.push(line);
  }
  return output.join("\r\n");
}

function mergeFmtpParams(existing: string, overrides: string): string {
  const map = new Map<string, string>();
  for (const part of existing.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) map.set(trimmed.slice(0, eq).trim().toLowerCase(), trimmed.slice(eq + 1).trim());
  }
  for (const part of overrides.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) map.set(trimmed.slice(0, eq).trim().toLowerCase(), trimmed.slice(eq + 1).trim());
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join(";");
}

export function formatBitrate(bitrate: number): string {
  if (bitrate >= 1000) return `${Math.round(bitrate / 1000)} kbps`;
  return `${bitrate} bps`;
}

export function audioSummary(settings: AudioSettings): string {
  const channel = settings.channels === 2 ? "立体声" : "单声道";
  return `${formatBitrate(settings.bitrate)} · ${settings.sampleRate / 1000} kHz · ${channel}`;
}
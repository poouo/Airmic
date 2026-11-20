import type { AudioSettings, ServerSettingsPublic } from "@airmic/shared";
import { applyOpusToSdp, audioConstraints } from "@airmic/shared";

/** 服务器没有配置 ICE 时的兜底 STUN，保证局域网/公网能尝试直连 */
const FALLBACK_STUN = "stun:stun.l.google.com:19302";

export interface VoiceErrorInfo {
  code: string;
  message: string;
}

/** 根据服务器设置构造 RTCConfiguration（STUN/TURN + 强制中继） */
export function buildRtcConfiguration(server: ServerSettingsPublic | null): RTCConfiguration {
  const iceServers: RTCIceServer[] = [];
  if (server) {
    for (const item of server.iceServers) {
      if (!item || !item.urls) continue;
      const urls = typeof item.urls === "string" ? item.urls.trim() : item.urls.map((url) => url.trim()).filter(Boolean);
      if (urls.length === 0) continue;
      const ice: RTCIceServer = { urls };
      if (item.username) ice.username = item.username;
      if (item.credential) ice.credential = item.credential;
      iceServers.push(ice);
    }
  }
  if (iceServers.length === 0) iceServers.push({ urls: FALLBACK_STUN });
  const configuration: RTCConfiguration = { iceServers, iceCandidatePoolSize: 2 };
  if (server?.forceRelay) configuration.iceTransportPolicy = "relay";
  return configuration;
}

/** 根据生效音质与设备偏好构造 getUserMedia 音频约束 */
export function buildMicrophoneConstraints(settings: AudioSettings, deviceId: string | null): MediaStreamConstraints {
  const base = audioConstraints(settings);
  const audio: MediaTrackConstraints = {
    echoCancellation: Boolean(base.echoCancellation),
    noiseSuppression: Boolean(base.noiseSuppression),
    autoGainControl: Boolean(base.autoGainControl),
    channelCount: Number(base.channelCount) === 2 ? 2 : 1,
    sampleRate: Number(base.sampleRate),
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio, video: false };
}

/** 用 Opus fmtp 参数修饰本地 offer/answer 的 SDP */
export function tuneAudioSdp(sdp: string, settings: AudioSettings): string {
  if (!sdp) return sdp;
  return applyOpusToSdp(sdp, settings);
}

/** 把 getUserMedia 的异常翻译成中文提示 */
export function describeMicrophoneError(error: unknown): VoiceErrorInfo {
  const name = readStringProperty(error, "name");
  const rawMessage = readStringProperty(error, "message");
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        code: "mic_denied",
        message: "麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试。你仍可以收听房间语音。",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { code: "mic_not_found", message: "未检测到可用的麦克风设备，已切换为只收听模式。" };
    case "NotReadableError":
    case "TrackStartError":
      return { code: "mic_busy", message: "麦克风被其他程序占用或系统权限不足，已切换为只收听模式。" };
    case "OverconstrainedError":
      return { code: "mic_constraint", message: "当前麦克风不支持所选音频参数，已切换为只收听模式。" };
    case "TypeError":
      return { code: "mic_unsupported", message: "当前环境无法采集麦克风（需要通过 HTTPS 或 localhost 访问）。" };
    default:
      return {
        code: "mic_unavailable",
        message: "无法启用麦克风" + (rawMessage ? "：" + rawMessage : "") + "，你仍可以收听房间语音。",
      };
  }
}

/** 读取传入对象的字符串属性（不依赖 instanceof，兼容各浏览器的 DOMException） */
function readStringProperty(value: unknown, key: "name" | "message"): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const field = record[key];
  return typeof field === "string" ? field : "";
}

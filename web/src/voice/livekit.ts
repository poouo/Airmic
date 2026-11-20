import type { AudioSettings, LivekitTokenResponse } from "@airmic/shared";
import { ConnectionQuality, supportsAudioOutputSelection } from "livekit-client";
import type { AudioCaptureOptions, RoomOptions, TrackPublishOptions } from "livekit-client";
import type { VoiceQuality } from "./types";

/** 换取 LiveKit 令牌失败 */
export class VoiceTokenError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VoiceTokenError";
    this.code = code;
  }
}

/** 请求服务端签发 LiveKit 访问令牌（cookie 认证，需已通过 WS 加入房间） */
export async function fetchLivekitToken(roomId: number): Promise<LivekitTokenResponse> {
  let response: Response;
  try {
    response = await fetch("/api/rooms/" + roomId + "/livekit-token", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new VoiceTokenError("network_error", "无法连接服务器，请检查网络后重试。");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const info = readApiError(payload);
    throw new VoiceTokenError(info.code, info.message);
  }
  if (!isLivekitTokenResponse(payload)) {
    throw new VoiceTokenError("invalid_response", "语音令牌响应格式不正确，请稍后重试。");
  }
  return payload;
}

/** 把令牌接口的错误翻译成用户可读提示 */
export function describeTokenError(error: unknown): { code: string; message: string } {
  if (error instanceof VoiceTokenError) {
    if (error.code === "voice_not_configured") {
      return {
        code: "voice_unavailable",
        message: "语音中转服务未配置，请联系管理员在后台或环境变量中配置 LiveKit。",
      };
    }
    if (error.code === "forbidden") {
      return { code: "voice_token_forbidden", message: "获取语音令牌失败：请先加入房间后再试。" };
    }
    if (error.code === "network_error") {
      return { code: "voice_token_network", message: error.message };
    }
    return { code: "voice_token_failed", message: error.message };
  }
  return { code: "voice_token_failed", message: "获取语音令牌失败，请稍后重试。" };
}

/** 本地麦克风采集约束（来自房间生效音质） */
export function buildAudioCaptureOptions(settings: AudioSettings, deviceId: string | null): AudioCaptureOptions {
  const options: AudioCaptureOptions = {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    sampleRate: settings.sampleRate,
    channelCount: settings.channels,
  };
  if (deviceId) options.deviceId = { exact: deviceId };
  return options;
}

/** 音频发布参数：码率/DTX/FEC(RED)/立体声，静音时停止采集以释放麦克风 */
export function buildTrackPublishOptions(settings: AudioSettings): TrackPublishOptions {
  return {
    audioPreset: { maxBitrate: settings.bitrate },
    dtx: settings.dtx,
    red: settings.fec,
    forceStereo: settings.channels === 2,
    stopMicTrackOnMute: true,
  };
}

/** 构造 LiveKit Room 选项（媒体只与 SFU 服务器相连，无任何 P2P） */
export function buildRoomOptions(
  settings: AudioSettings,
  inputDeviceId: string | null,
  outputDeviceId: string | null,
): RoomOptions {
  const options: RoomOptions = {
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: buildAudioCaptureOptions(settings, inputDeviceId),
    publishDefaults: buildTrackPublishOptions(settings),
    // 页面关闭时由 SDK 主动断开，避免服务端残留参与者
    disconnectOnPageLeave: true,
  };
  if (outputDeviceId && supportsAudioOutputSelection()) {
    options.audioOutput = { deviceId: outputDeviceId };
  }
  return options;
}

/** LiveKit ConnectionQuality -> 界面使用的质量等级 */
export function mapConnectionQuality(quality: ConnectionQuality): VoiceQuality {
  switch (quality) {
    case ConnectionQuality.Excellent:
    case ConnectionQuality.Good:
      return "good";
    case ConnectionQuality.Poor:
      return "poor";
    case ConnectionQuality.Lost:
      return "poor";
    default:
      return "unknown";
  }
}

/** 解析参与者身份中的数字 userId（服务端令牌 identity = String(user.id)） */
export function parseIdentityUserId(identity: string | null | undefined): number | null {
  if (!identity) return null;
  const trimmed = identity.trim();
  if (/^\d+$/.test(trimmed)) {
    const value = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const prefixed = /^(?:user|u)[-_]?(\d+)$/i.exec(trimmed);
  if (prefixed) {
    const value = Number.parseInt(prefixed[1] ?? "", 10);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  return null;
}

/** 从参与者 metadata 中解析 userId（服务端也会写入 userId） */
export function parseMetadataUserId(metadata: string | null | undefined): number | null {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    for (const key of ["userId", "user_id", "uid"]) {
      const value = record[key];
      if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
      if (typeof value === "string" && /^\d+$/.test(value)) {
        const parsedValue = Number.parseInt(value, 10);
        if (Number.isSafeInteger(parsedValue) && parsedValue > 0) return parsedValue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** 本地麦克风异常提示 */
export function describeMicrophoneError(error: unknown): { code: string; message: string } {
  // 非安全来源时浏览器根本不提供麦克风能力（getUserMedia 被禁用），
  // 报错常常是 NotAllowedError/TypeError，容易被误导成"用户拒绝了权限"。
  // 这里优先识别来源问题，直接告诉用户该怎么办。
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return {
      code: "mic_insecure_origin",
      message:
        "当前页面是 HTTP（非安全来源），浏览器禁止使用麦克风。请改用 https:// 或 localhost 访问；你仍可以收听房间语音。",
    };
  }
  const name = readErrorName(error);
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
        message: "无法启用麦克风" + (readErrorMessage(error) ? "：" + readErrorMessage(error) : "") + "，你仍可以收听房间语音。",
      };
  }
}

export function readErrorName(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

export function readErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function isLivekitTokenResponse(value: unknown): value is LivekitTokenResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.url === "string" &&
    record.url.length > 0 &&
    typeof record.token === "string" &&
    record.token.length > 0 &&
    typeof record.room === "string" &&
    typeof record.identity === "string"
  );
}

function readApiError(payload: unknown): { code: string; message: string } {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object") {
      const body = error as Record<string, unknown>;
      const code = typeof body.code === "string" ? body.code : "http_error";
      const message = typeof body.message === "string" ? body.message : "";
      if (message) return { code, message };
      return { code, message: "获取语音令牌失败（" + code + "）" };
    }
  }
  return { code: "http_error", message: "获取语音令牌失败，请稍后重试。" };
}

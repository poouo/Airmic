import type { MediaTransport } from "./types.js";

/** 语音媒体传输方式：始终为服务端 SFU 中转，不使用客户端 P2P */
export const MEDIA_TRANSPORT: MediaTransport = "sfu";
/** LiveKit 房间名前缀，实际房间名为 prefix + roomId */
export const LIVEKIT_ROOM_PREFIX = "airmic-r";
/** LiveKit 访问令牌默认有效期（秒） */
export const LIVEKIT_TOKEN_TTL_SECONDS = 2 * 60 * 60;
/** 单房间推荐人数上限（SFU 模式软上限，可在管理后台调整） */
export const SFU_RECOMMENDED_ROOM_USERS = 100;

export interface LivekitCredentials {
  url: string | null;
  apiKey: string | null;
  apiSecret: string | null;
}

/** LiveKit 三项配置是否齐全 */
export function isLivekitConfigured(credentials: LivekitCredentials): boolean {
  return Boolean(credentials.url && credentials.apiKey && credentials.apiSecret);
}

export function livekitRoomName(roomId: number): string {
  return LIVEKIT_ROOM_PREFIX + roomId;
}

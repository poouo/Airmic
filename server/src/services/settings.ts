import {
  APP_VERSION,
  DEFAULT_AUDIO_SETTINGS,
  MEDIA_TRANSPORT,
  SFU_RECOMMENDED_ROOM_USERS,
  isLivekitConfigured,
  normalizeAudioSettings,
} from "@airmic/shared";
import type {
  AudioSettings,
  IceServerConfig,
  LivekitCredentials,
  RegistrationMode,
  ServerSettings,
  ServerSettingsPublic,
} from "@airmic/shared";
import type { AppConfig } from "../config.js";
import type { Database } from "../db.js";
import { randomCode, randomToken } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

/** LiveKit 配置字段长度上限，与设置接口校验保持一致 */
const LIVEKIT_URL_MAX_LENGTH = 300;
const LIVEKIT_API_KEY_MAX_LENGTH = 200;
const LIVEKIT_API_SECRET_MAX_LENGTH = 300;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  name: "AirMic 语音服务器",
  motd: "欢迎来到 AirMic！打开网页就能开黑，无需下载客户端。",
  registrationMode: "open",
  registrationCode: "",
  guestEnabled: true,
  maxUsers: 500,
  maxUsersPerRoom: SFU_RECOMMENDED_ROOM_USERS,
  maxRooms: 100,
  allowRoomCreation: false,
  allowGuestRoomCreation: false,
  allowScreenShare: true,
  allowTextChat: true,
  allowGuestChat: true,
  maxChatLength: 1000,
  maxMessagesPerRoom: 300,
  defaultAudioSettings: { ...DEFAULT_AUDIO_SETTINGS },
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.miwifi.com:3478" },
  ],
  forceRelay: false,
  roomCategories: ["开黑房间", "娱乐房", "休息室"],
  livekitUrl: null,
  livekitApiKey: null,
  livekitApiSecret: null,
  voiceAvailable: false,
  mediaTransport: MEDIA_TRANSPORT,
  version: APP_VERSION,
};

const JSON_KEYS = new Set<keyof ServerSettings>(["defaultAudioSettings", "iceServers", "roomCategories"]);
const LIVEKIT_KEYS = new Set<keyof ServerSettings>(["livekitUrl", "livekitApiKey", "livekitApiSecret"]);
/** 由其他配置推导出来的字段，不写入数据库 */
const DERIVED_KEYS = new Set<keyof ServerSettings>(["voiceAvailable", "mediaTransport"]);
const SETTING_KEYS = (Object.keys(DEFAULT_SERVER_SETTINGS) as (keyof ServerSettings)[]).filter(
  (key) => !DERIVED_KEYS.has(key),
);

export class SettingsService {
  private cache: ServerSettings;
  private jwtSecretValue: string;

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
  ) {
    this.cache = this.load();
    this.jwtSecretValue = this.loadJwtSecret();
  }

  private load(): ServerSettings {
    const result: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      defaultAudioSettings: { ...DEFAULT_SERVER_SETTINGS.defaultAudioSettings },
      iceServers: DEFAULT_SERVER_SETTINGS.iceServers.map((server) => ({ ...server })),
      roomCategories: [...DEFAULT_SERVER_SETTINGS.roomCategories],
      // 环境变量作为首次部署的默认值；数据库里已保存的值优先（见下方循环）
      livekitUrl: normalizeOptionalText(this.config.livekitUrl, LIVEKIT_URL_MAX_LENGTH),
      livekitApiKey: normalizeOptionalText(this.config.livekitApiKey, LIVEKIT_API_KEY_MAX_LENGTH),
      livekitApiSecret: normalizeOptionalText(this.config.livekitApiSecret, LIVEKIT_API_SECRET_MAX_LENGTH),
      version: APP_VERSION,
    };
    const rows = this.db.all<{ key: string; value: string }>("SELECT key, value FROM settings");
    const known = new Set<string>(SETTING_KEYS);
    for (const row of rows) {
      if (!known.has(row.key)) continue;
      const key = row.key as keyof ServerSettings;
      try {
        if (JSON_KEYS.has(key)) {
          (result as unknown as Record<string, unknown>)[key] = JSON.parse(row.value);
        } else if (typeof DEFAULT_SERVER_SETTINGS[key] === "boolean") {
          (result as unknown as Record<string, unknown>)[key] = row.value === "true";
        } else if (typeof DEFAULT_SERVER_SETTINGS[key] === "number") {
          (result as unknown as Record<string, unknown>)[key] = Number(row.value);
        } else {
          // 字符串/null 字段：显式清空会保存为空串，空串与 "null" 都还原为 null
          (result as unknown as Record<string, unknown>)[key] = row.value;
        }
      } catch {
        /* 忽略损坏的设置项 */
      }
    }
    result.version = APP_VERSION;
    result.defaultAudioSettings = normalizeAudioSettings(result.defaultAudioSettings, DEFAULT_AUDIO_SETTINGS);
    result.livekitUrl = normalizeOptionalText(result.livekitUrl, LIVEKIT_URL_MAX_LENGTH);
    result.livekitApiKey = normalizeOptionalText(result.livekitApiKey, LIVEKIT_API_KEY_MAX_LENGTH);
    result.livekitApiSecret = normalizeOptionalText(result.livekitApiSecret, LIVEKIT_API_SECRET_MAX_LENGTH);
    result.voiceAvailable = isLivekitConfigured(credentialsOf(result));
    result.mediaTransport = MEDIA_TRANSPORT;
    return result;
  }

  private loadJwtSecret(): string {
    if (this.config.jwtSecret) return this.config.jwtSecret;
    const row = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'jwt_secret'");
    if (row?.value) return row.value;
    const secret = randomToken(48);
    this.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('jwt_secret', ?, ?)", secret, nowIso());
    return secret;
  }

  getJwtSecret(): string {
    return this.jwtSecretValue;
  }

  /** 当前生效的 LiveKit SFU 连接配置（用于签发访问令牌） */
  getLivekitCredentials(): LivekitCredentials {
    return credentialsOf(this.cache);
  }

  /** 语音中转服务是否已配置齐全（未配置时房间内无法通话） */
  isVoiceAvailable(): boolean {
    return isLivekitConfigured(this.getLivekitCredentials());
  }

  get(): ServerSettings {
    return {
      ...this.cache,
      defaultAudioSettings: { ...this.cache.defaultAudioSettings },
      iceServers: this.cache.iceServers.map((server) => ({ ...server })),
      roomCategories: [...this.cache.roomCategories],
    };
  }

  getPublic(): ServerSettingsPublic {
    const settings = this.get();
    const credentials = credentialsOf(settings);
    return {
      name: settings.name,
      motd: settings.motd,
      registrationMode: settings.registrationMode,
      guestEnabled: settings.guestEnabled,
      maxUsers: settings.maxUsers,
      maxUsersPerRoom: settings.maxUsersPerRoom,
      maxRooms: settings.maxRooms,
      allowRoomCreation: settings.allowRoomCreation,
      allowGuestRoomCreation: settings.allowGuestRoomCreation,
      allowScreenShare: settings.allowScreenShare,
      allowTextChat: settings.allowTextChat,
      allowGuestChat: settings.allowGuestChat,
      maxChatLength: settings.maxChatLength,
      defaultAudioSettings: { ...settings.defaultAudioSettings },
      iceServers: settings.iceServers.map((server) => ({ ...server })),
      forceRelay: settings.forceRelay,
      roomCategories: [...settings.roomCategories],
      version: APP_VERSION,
      // 不暴露 SFU 地址与 API Key/Secret：客户端在入房后通过令牌接口获取连接地址
      voiceAvailable: isLivekitConfigured(credentials),
      mediaTransport: MEDIA_TRANSPORT,
    };
  }

  /** 合并并校验管理员提交的设置，写库并更新缓存 */
  update(patch: Partial<ServerSettings>): ServerSettings {
    const current = this.cache;
    const next: ServerSettings = {
      ...current,
      defaultAudioSettings: { ...current.defaultAudioSettings },
      iceServers: current.iceServers.map((server) => ({ ...server })),
      roomCategories: [...current.roomCategories],
    };

    if (patch.name !== undefined) next.name = String(patch.name).trim().slice(0, 60) || current.name;
    if (patch.motd !== undefined) next.motd = String(patch.motd).slice(0, 500);
    if (patch.registrationMode !== undefined && ["open", "invite", "closed"].includes(patch.registrationMode)) {
      next.registrationMode = patch.registrationMode as RegistrationMode;
    }
    if (patch.registrationCode !== undefined) next.registrationCode = String(patch.registrationCode).trim().slice(0, 32);
    if (patch.guestEnabled !== undefined) next.guestEnabled = Boolean(patch.guestEnabled);
    if (patch.maxUsers !== undefined) next.maxUsers = clampInt(patch.maxUsers, 1, 10_000, current.maxUsers);
    if (patch.maxUsersPerRoom !== undefined) {
      next.maxUsersPerRoom = clampInt(patch.maxUsersPerRoom, 1, 500, current.maxUsersPerRoom);
    }
    if (patch.maxRooms !== undefined) next.maxRooms = clampInt(patch.maxRooms, 0, 1000, current.maxRooms);
    if (patch.allowRoomCreation !== undefined) next.allowRoomCreation = Boolean(patch.allowRoomCreation);
    if (patch.allowGuestRoomCreation !== undefined) next.allowGuestRoomCreation = Boolean(patch.allowGuestRoomCreation);
    if (patch.allowScreenShare !== undefined) next.allowScreenShare = Boolean(patch.allowScreenShare);
    if (patch.allowTextChat !== undefined) next.allowTextChat = Boolean(patch.allowTextChat);
    if (patch.allowGuestChat !== undefined) next.allowGuestChat = Boolean(patch.allowGuestChat);
    if (patch.maxChatLength !== undefined) next.maxChatLength = clampInt(patch.maxChatLength, 20, 5000, current.maxChatLength);
    if (patch.maxMessagesPerRoom !== undefined) {
      next.maxMessagesPerRoom = clampInt(patch.maxMessagesPerRoom, 0, 5000, current.maxMessagesPerRoom);
    }
    if (patch.defaultAudioSettings !== undefined) {
      next.defaultAudioSettings = normalizeAudioSettings(patch.defaultAudioSettings as Partial<AudioSettings>, current.defaultAudioSettings);
    }
    if (patch.iceServers !== undefined) next.iceServers = sanitizeIceServers(patch.iceServers);
    if (patch.forceRelay !== undefined) next.forceRelay = Boolean(patch.forceRelay);
    if (patch.roomCategories !== undefined) next.roomCategories = sanitizeCategories(patch.roomCategories);
    // LiveKit 配置：空串/空白表示清除（显式清空优先于环境变量兜底）
    if (patch.livekitUrl !== undefined) {
      next.livekitUrl = normalizeOptionalText(patch.livekitUrl, LIVEKIT_URL_MAX_LENGTH);
    }
    if (patch.livekitApiKey !== undefined) {
      next.livekitApiKey = normalizeOptionalText(patch.livekitApiKey, LIVEKIT_API_KEY_MAX_LENGTH);
    }
    if (patch.livekitApiSecret !== undefined) {
      next.livekitApiSecret = normalizeOptionalText(patch.livekitApiSecret, LIVEKIT_API_SECRET_MAX_LENGTH);
    }

    if (next.registrationMode === "invite" && !next.registrationCode) {
      next.registrationCode = randomCode(8);
    }

    next.voiceAvailable = isLivekitConfigured(credentialsOf(next));
    next.mediaTransport = MEDIA_TRANSPORT;

    const changed: [keyof ServerSettings, unknown][] = [];
    for (const key of SETTING_KEYS) {
      if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) changed.push([key, next[key]]);
    }
    if (changed.length > 0) {
      const timestamp = nowIso();
      this.db.transaction(() => {
        for (const [key, value] of changed) {
          // null 字符串字段保存为空串，便于区分"显式清空"与"从未配置"
          const storeValue = JSON_KEYS.has(key) ? JSON.stringify(value) : value === null ? "" : String(value);
          this.db.run(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            key,
            storeValue,
            timestamp,
          );
        }
      });
    }
    this.cache = next;
    return this.get();
  }

  /** 首次部署没有管理员账号 */
  setupRequired(): boolean {
    const row = this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_guest = 0");
    return Number(row?.count ?? 0) === 0;
  }
}

/** 从完整设置中提取 LiveKit 连接配置 */
function credentialsOf(settings: Pick<ServerSettings, "livekitUrl" | "livekitApiKey" | "livekitApiSecret">): LivekitCredentials {
  return {
    url: settings.livekitUrl,
    apiKey: settings.livekitApiKey,
    apiSecret: settings.livekitApiSecret,
  };
}

/** 可选文本设置：trim 后为空 / "null" / "undefined" 视为未配置 */
function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === "null" || text === "undefined") return null;
  return text.slice(0, maxLength);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

function sanitizeIceServers(input: unknown): IceServerConfig[] {
  if (!Array.isArray(input)) return DEFAULT_SERVER_SETTINGS.iceServers;
  const result: IceServerConfig[] = [];
  for (const item of input.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { urls?: unknown; username?: unknown; credential?: unknown };
    const urls = raw.urls;
    let normalized: string | string[] | null = null;
    if (typeof urls === "string") normalized = urls.trim().slice(0, 300);
    else if (Array.isArray(urls)) {
      const list = urls.filter((value): value is string => typeof value === "string").map((value) => value.trim().slice(0, 300));
      normalized = list.slice(0, 10);
    }
    if (!normalized || (Array.isArray(normalized) && normalized.length === 0)) continue;
    const server: IceServerConfig = { urls: normalized };
    if (typeof raw.username === "string" && raw.username.trim()) server.username = raw.username.trim().slice(0, 200);
    if (typeof raw.credential === "string" && raw.credential.trim()) server.credential = raw.credential.trim().slice(0, 300);
    result.push(server);
  }
  return result;
}

function sanitizeCategories(input: unknown): string[] {
  if (!Array.isArray(input)) return DEFAULT_SERVER_SETTINGS.roomCategories;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const value = item.trim().slice(0, 20);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= 20) break;
  }
  return result;
}

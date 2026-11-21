import type { AreaIconId } from "./area-icons.js";

/** 权限点 */
export type Permission =
  | "manage_server"
  | "manage_rooms"
  | "manage_users"
  | "kick_users"
  | "ban_users"
  | "moderate_voice"
  | "view_audit"
  | "create_rooms";

/** 用户角色，权限由低到高：guest < user < moderator < admin */
export type Role = "admin" | "moderator" | "user" | "guest";

export type RegistrationMode = "open" | "invite" | "closed";

/** 语音媒体传输方式：固定为服务端 SFU 中转（不进行客户端 P2P 互联） */
export type MediaTransport = "sfu";

/** 音频预设标识 */
export type AudioPresetId = "voice-low" | "voice-standard" | "voice-high" | "music" | "custom";

/** 一路语音的完整编码/处理参数 */
export interface AudioSettings {
  /** 预设名（custom 表示手动微调） */
  preset: AudioPresetId;
  /** 目标码率 bps（6000 - 160000） */
  bitrate: number;
  /** 采样率 Hz（16000 / 24000 / 32000 / 48000） */
  sampleRate: number;
  /** 声道数 1 = 单声道，2 = 立体声 */
  channels: 1 | 2;
  /** Opus DTX 不连续传输（静音时省流量） */
  dtx: boolean;
  /** Opus 带内 FEC 前向纠错（抗丢包） */
  fec: boolean;
  /** 浏览器回声消除 */
  echoCancellation: boolean;
  /** 浏览器噪声抑制 */
  noiseSuppression: boolean;
  /** 浏览器自动增益 */
  autoGainControl: boolean;
}

/** 房间对音频参数的覆盖（只保存与服务器默认不同的字段） */
export type AudioOverride = Partial<Omit<AudioSettings, "preset">> & { preset?: AudioPresetId };

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RoomAudioBitrateLimit {
  enabled: boolean;
  userThreshold: number;
  maxBitrate: number;
}

/** 公开的服务器设置（登录页/客户端可见） */
export interface ServerSettingsPublic {
  name: string;
  motd: string;
  registrationMode: RegistrationMode;
  guestEnabled: boolean;
  maxUsers: number;
  maxUsersPerRoom: number;
  maxRooms: number;
  allowRoomCreation: boolean;
  allowGuestRoomCreation: boolean;
  allowCodeRoomCreation: boolean;
  allowGuestCodeRoomCreation: boolean;
  allowScreenShare: boolean;
  allowTextChat: boolean;
  allowGuestChat: boolean;
  maxChatLength: number;
  defaultAudioSettings: AudioSettings;
  roomAudioBitrateLimit: RoomAudioBitrateLimit;
  iceServers: IceServerConfig[];
  forceRelay: boolean;
  roomCategories: string[];
  version: string;
  /** 语音中转服务是否已配置好（未配置时房间内无法通话） */
  voiceAvailable: boolean;
  /** 媒体传输方式，固定 sfu；SFU 连接地址只通过令牌接口下发，不在公开信息中暴露 */
  mediaTransport: MediaTransport;
}

/** 管理员可见的完整服务器设置 */
export interface ServerSettings extends ServerSettingsPublic {
  registrationCode: string;
  maxMessagesPerRoom: number;
  allowGuestChat: boolean;
  /** LiveKit SFU 信令地址（仅管理员可见；普通客户端通过令牌接口获取连接地址） */
  livekitUrl: string | null;
  /** LiveKit API Key（仅管理员可见） */
  livekitApiKey: string | null;
  /** LiveKit API Secret（仅管理员可见） */
  livekitApiSecret: string | null;
}

export interface UserPublic {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  avatarColor: string;
  avatarEmoji: string | null;
  statusText: string;
  createdAt: string;
}

export interface UserSelf extends UserPublic {
  permissions: Permission[];
  roomId: number | null;
}

export interface OnlineUser {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  avatarColor: string;
  avatarEmoji: string | null;
  roomId: number | null;
  roomName: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
}

export interface RoomArea {
  id: number;
  parentId: number | null;
  name: string;
  sortOrder: number;
  icon: AreaIconId | null;
  kind: "standard" | "code";
}

export interface RoomManagementScope {
  kind: "area" | "room";
  id: number;
}

export interface RoomDirectory {
  areas: RoomArea[];
  grants: RoomManagementScope[];
}

export interface RoomManager {
  userId: number;
  username: string;
  displayName: string;
}

export interface RoomSummary {
  id: number;
  areaId: number;
  createdById: number | null;
  name: string;
  description: string;
  category: string;
  /** 一级分组（频道） */
  channel: string;
  /** 房间图标 key（对应前端 ROOM_ICONS） */
  icon: string;
  hasPassword: boolean;
  codeOnly: boolean;
  allowGuests: boolean;
  textChatEnabled: boolean;
  chatHistoryDays: number;
  maxUsers: number;
  userCount: number;
  locked: boolean;
  sortOrder: number;
  screenShareEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomDetail extends RoomSummary {
  /** 生效的音频参数（服务器默认 + 房间覆盖） */
  audioSettings: AudioSettings;
  /** 房间显式覆盖的音频字段；null 表示继承服务器默认 */
  audioOverride: AudioOverride | null;
  createdBy: { id: number; displayName: string } | null;
}

export interface PeerInfo {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  avatarColor: string;
  avatarEmoji: string | null;
  statusText: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  screenSharing: boolean;
  forceMuted: boolean;
  /** 服务端用 WebSocket 心跳测得的往返延迟（毫秒）；还没测到时为 null */
  rttMs?: number | null;
  joinedAt: string;
}

export type ChatMessageKind = "text" | "system";

export interface ChatMessage {
  id: number;
  roomId: number;
  userId: number | null;
  senderName: string;
  senderRole: Role | "system";
  kind: ChatMessageKind;
  content: string;
  createdAt: string;
}

export interface RoomSnapshot {
  room: RoomDetail;
  inviteCode?: string;
  peers: PeerInfo[];
  messages: ChatMessage[];
  screenSharerId: number | null;
}

/** 用户在线实时状态补丁 */
export interface PeerStatePatch {
  muted?: boolean;
  deafened?: boolean;
  speaking?: boolean;
  screenSharing?: boolean;
  forceMuted?: boolean;
}

export interface IceCandidatePayload {
  candidate: string | null;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: IceCandidatePayload };

export interface BanRow {
  id: number;
  userId: number | null;
  username: string | null;
  ip: string | null;
  reason: string;
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
  bannedById: number | null;
  bannedByName: string | null;
}

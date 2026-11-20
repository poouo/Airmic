import type {
  AudioOverride,
  AudioSettings,
  BanRow,
  ChatMessage,
  OnlineUser,
  Role,
  RoomDetail,
  RoomSummary,
  ServerSettings,
  ServerSettingsPublic,
  UserPublic,
  UserSelf,
} from "./types.js";

// ============ 通用 ============

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

// ============ 运行日志 ============

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogCategory = "http" | "ws" | "auth" | "admin" | "system" | "room" | "voice" | "error" | "security";

export interface AdminLogRow {
  id: number;
  createdAt: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  /** 附加信息 JSON 字符串（可能为空） */
  meta: string | null;
  userId: number | null;
  username: string | null;
  ip: string | null;
  requestId: string | null;
}

export interface AdminLogListResponse extends Paginated<AdminLogRow> {
  /** 日志保留天数（默认 3） */
  retentionDays: number;
  oldest: string | null;
  newest: string | null;
  /** 按级别统计（当前筛选条件下） */
  levelCounts: Partial<Record<LogLevel, number>>;
}

export interface AdminLogQuery extends PageQuery {
  level?: LogLevel;
  category?: LogCategory;
  /** 关键字，匹配 message / username / ip / meta */
  search?: string;
  /** ISO 时间范围 */
  from?: string;
  to?: string;
}

// ============ 在线更新检查 ============

export interface UpdateCheckResponse {
  /** 当前运行版本（package.json / APP_VERSION） */
  currentVersion: string;
  /** GitHub 上最新版本（已去掉前缀 v）；仓库还没有 Release/Tag 时为 null */
  latestVersion: string | null;
  /** 用于下载的 ref：tag 名（如 v1.1.0）或分支名（main） */
  latestRef: string | null;
  latestSource: "release" | "tag" | "branch" | "unknown";
  updateAvailable: boolean;
  repo: string;
  repoUrl: string;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  checkedAt: string;
  /** 检查失败时的错误信息（网络/API 限流等） */
  error: string | null;
  /** 给管理员的升级提示命令 */
  upgradeHint: string;
}

// ============ 初始化引导 ============

export interface SetupStatusResponse {
  /** 是否还没有任何管理员账号（需要初始化） */
  setupRequired: boolean;
  /** 服务器是否通过 SETUP_TOKEN 环境变量要求初始化口令 */
  requiresToken: boolean;
  server: ServerSettingsPublic;
}

export interface SetupAdminInput {
  username: string;
  password: string;
  displayName?: string;
}

export interface SetupServerInput {
  name?: string;
  motd?: string;
  registrationMode?: "open" | "invite" | "closed";
  guestEnabled?: boolean;
  maxUsers?: number;
  maxUsersPerRoom?: number;
  defaultAudioSettings?: Partial<AudioSettings>;
  allowGuestChat?: boolean;
  /** LiveKit SFU 地址（ws:// 或 wss://），配置后房间内语音经服务器中转 */
  livekitUrl?: string;
  livekitApiKey?: string;
  livekitApiSecret?: string;
}

export interface SetupInitializeRequest {
  /** 服务器设置了 SETUP_TOKEN 时必填 */
  token?: string;
  admin: SetupAdminInput;
  server?: SetupServerInput;
  /** 是否创建两个默认房间（开黑大厅/休息室），默认 true */
  createDefaultRooms?: boolean;
}

export interface SetupInitializeResponse {
  user: UserSelf;
  server: ServerSettingsPublic;
  rooms: RoomSummary[];
}

// ============ 认证 ============

export interface RegisterRequest {
  username: string;
  password: string;
  displayName?: string;
  inviteCode?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface GuestLoginRequest {
  displayName: string;
}

/** 游客原地升级为正式账号（保留同一 user id / 房间身份） */
export interface UpgradeGuestRequest {
  username: string;
  password: string;
  displayName?: string;
}

export interface AuthResponse {
  user: UserSelf;
}

export interface ServerInfoResponse {
  server: ServerSettingsPublic;
  /** 是否还没有任何管理员账号（首次部署） */
  setupRequired: boolean;
  version: string;
}

// ============ 用户 ============

export interface UpdateProfileRequest {
  displayName?: string;
  avatarColor?: string;
  avatarEmoji?: string | null;
  statusText?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// ============ 房间 ============

export interface CreateRoomRequest {
  name: string;
  description?: string;
  category?: string;
  /** 设置房间密码；null / "" 表示无密码 */
  password?: string | null;
  maxUsers?: number;
  sortOrder?: number;
  locked?: boolean;
  screenShareEnabled?: boolean;
  audioOverride?: AudioOverride | null;
}

export type UpdateRoomRequest = Partial<CreateRoomRequest>;

export interface RoomMessagesResponse {
  messages: ChatMessage[];
}

// ============ 管理后台 ============

export interface AdminStats {
  users: number;
  guests: number;
  online: number;
  peakOnline: number;
  rooms: number;
  messages: number;
  activeBans: number;
  uptimeSeconds: number;
  startedAt: string;
}

export interface AdminOverviewResponse {
  stats: AdminStats;
  onlineUsers: OnlineUser[];
  recentAudit: AuditRow[];
  rooms: RoomSummary[];
}

export interface AdminSettingsResponse {
  settings: ServerSettings;
}

export interface UpdateSettingsRequest {
  name?: string;
  motd?: string;
  registrationMode?: "open" | "invite" | "closed";
  registrationCode?: string;
  guestEnabled?: boolean;
  maxUsers?: number;
  maxUsersPerRoom?: number;
  maxRooms?: number;
  allowRoomCreation?: boolean;
  allowGuestRoomCreation?: boolean;
  allowScreenShare?: boolean;
  allowTextChat?: boolean;
  allowGuestChat?: boolean;
  maxChatLength?: number;
  maxMessagesPerRoom?: number;
  defaultAudioSettings?: AudioSettings;
  iceServers?: { urls: string | string[]; username?: string; credential?: string }[];
  forceRelay?: boolean;
  roomCategories?: string[];
  livekitUrl?: string;
  livekitApiKey?: string;
  livekitApiSecret?: string;
}

export interface LivekitTokenResponse {
  url: string;
  token: string;
  room: string;
  identity: string;
}

export interface AdminUserRow extends UserPublic {
  isBanned: boolean;
  banReason: string | null;
  bannedUntil: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  online: boolean;
  roomId: number | null;
  roomName: string | null;
}

export interface AdminUserListResponse extends Paginated<AdminUserRow> {
  onlineCount: number;
}

export interface UpdateUserRequest {
  displayName?: string;
  role?: Role;
  statusText?: string;
}

export interface KickUserRequest {
  scope?: "server" | "room";
  reason?: string;
}

export interface ForceMuteRequest {
  muted: boolean;
  reason?: string;
}

export interface MoveUserRequest {
  roomId: number | null;
}

export interface CreateBanRequest {
  userId?: number;
  /** 直接按用户名封禁（可封禁未注册的游客昵称对应的 IP 需要填写 ip） */
  ip?: string;
  reason: string;
  /** 封禁时长（分钟）；0 或省略表示永久 */
  durationMinutes?: number;
}

export interface AdminBanListResponse extends Paginated<BanRow> {}

export interface UpdateBanRequest {
  active: boolean;
}

export interface AuditRow {
  id: number;
  actorId: number | null;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  details: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AdminAuditResponse extends Paginated<AuditRow> {}

export interface AdminRoomsResponse {
  rooms: RoomDetail[];
}

export interface AdminSessionsResponse {
  sessions: AdminSessionRow[];
}

export interface AdminSessionRow {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface IceConfigResponse {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  forceRelay: boolean;
}
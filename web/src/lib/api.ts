import type {
  AdminAuditResponse,
  AdminBanListResponse,
  AdminLogListResponse,
  AdminLogQuery,
  AdminOverviewResponse,
  AdminRoomsResponse,
  AdminSessionsResponse,
  AdminSettingsResponse,
  AdminUserListResponse,
  AdminUserRow,
  ApiErrorBody,
  AuthResponse,
  BanRow,
  ChangePasswordRequest,
  CreateBanRequest,
  CreateRoomRequest,
  GuestLoginRequest,
  KickUserRequest,
  LoginRequest,
  MoveUserRequest,
  RegisterRequest,
  UpgradeGuestRequest,
  RoomDetail,
  RoomMessagesResponse,
  RoomSummary,
  ServerInfoResponse,
  SetupInitializeRequest,
  SetupInitializeResponse,
  SetupStatusResponse,
  UpdateBanRequest,
  UpdateCheckResponse,
  SystemUpgradeResponse,
  UpdateProfileRequest,
  UpdateRoomRequest,
  UpdateSettingsRequest,
  UpdateUserRequest,
  UserSelf,
} from "@airmic/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, credentials: "same-origin", signal, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    throw new ApiError(0, "network_error", "无法连接服务器，请检查网络", error);
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const errorBody = data as ApiErrorBody | null;
    const message =
      errorBody && typeof errorBody === "object" && errorBody.error?.message
        ? errorBody.error.message
        : "请求失败（HTTP " + response.status + "）";
    throw new ApiError(response.status, errorBody?.error?.code ?? "http_error", message, errorBody?.error?.details);
  }
  return data as T;
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? "?" + text : "";
}

export const api = {
  serverInfo: (signal?: AbortSignal) => request<ServerInfoResponse>("GET", "/api/server", undefined, signal),
  iceConfig: (signal?: AbortSignal) => request<{ iceServers: unknown[]; forceRelay: boolean }>("GET", "/api/rtc/ice", undefined, signal),

  system: {
    update: (force = false) =>
      request<UpdateCheckResponse>("GET", "/api/system/update" + (force ? "?force=1" : "")),
    upgrade: () => request<SystemUpgradeResponse>("POST", "/api/system/upgrade"),
  },

  setup: {
    status: (signal?: AbortSignal) => request<SetupStatusResponse>("GET", "/api/setup/status", undefined, signal),
    initialize: (body: SetupInitializeRequest) => request<SetupInitializeResponse>("POST", "/api/setup/initialize", body),
  },

  auth: {
    register: (body: RegisterRequest) => request<AuthResponse>("POST", "/api/auth/register", body),
    login: (body: LoginRequest) => request<AuthResponse>("POST", "/api/auth/login", body),
    guest: (body: GuestLoginRequest) => request<AuthResponse>("POST", "/api/auth/guest", body),
    upgrade: (body: UpgradeGuestRequest) => request<AuthResponse>("POST", "/api/auth/upgrade", body),
    logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout"),
    me: (signal?: AbortSignal) => request<AuthResponse>("GET", "/api/auth/me", undefined, signal),
  },

  users: {
    updateProfile: (body: UpdateProfileRequest) => request<AuthResponse>("PATCH", "/api/users/me", body),
    changePassword: (body: ChangePasswordRequest) => request<{ ok: boolean }>("POST", "/api/users/me/password", body),
  },

  rooms: {
    list: (signal?: AbortSignal) => request<{ rooms: RoomSummary[] }>("GET", "/api/rooms", undefined, signal),
    create: (body: CreateRoomRequest) => request<{ room: RoomSummary }>("POST", "/api/rooms", body),
    update: (id: number, body: UpdateRoomRequest) => request<{ room: RoomDetail }>("PATCH", "/api/rooms/" + id, body),
    remove: (id: number) => request<{ ok: boolean }>("DELETE", "/api/rooms/" + id),
    messages: (id: number, beforeId?: number, limit = 50) =>
      request<RoomMessagesResponse>("GET", "/api/rooms/" + id + "/messages" + query({ beforeId, limit })),
    checkPassword: (id: number, password?: string) =>
      request<{ ok: boolean; required: boolean }>("POST", "/api/rooms/" + id + "/check-password", { password }),
  },

  admin: {
    overview: () => request<AdminOverviewResponse>("GET", "/api/admin/overview"),
    settings: () => request<AdminSettingsResponse>("GET", "/api/admin/settings"),
    updateSettings: (body: UpdateSettingsRequest) => request<AdminSettingsResponse>("PATCH", "/api/admin/settings", body),
    rooms: () => request<AdminRoomsResponse>("GET", "/api/admin/rooms"),
    users: (params: { search?: string; page?: number; pageSize?: number; role?: string }) =>
      request<AdminUserListResponse>("GET", "/api/admin/users" + query(params)),
    updateUser: (id: number, body: UpdateUserRequest) => request<{ user: AdminUserRow }>("PATCH", "/api/admin/users/" + id, body),
    deleteUser: (id: number) => request<{ ok: boolean }>("DELETE", "/api/admin/users/" + id),
    kick: (id: number, body: KickUserRequest) => request<{ ok: boolean }>("POST", "/api/admin/users/" + id + "/kick", body),
    mute: (id: number, muted: boolean, reason?: string) =>
      request<{ ok: boolean }>("POST", "/api/admin/users/" + id + "/mute", { muted, reason }),
    move: (id: number, body: MoveUserRequest) => request<{ ok: boolean }>("POST", "/api/admin/users/" + id + "/move", body),
    bans: (params: { active?: boolean; page?: number; pageSize?: number }) =>
      request<AdminBanListResponse>("GET", "/api/admin/bans" + query(params)),
    createBan: (body: CreateBanRequest) => request<{ ban: BanRow }>("POST", "/api/admin/bans", body),
    updateBan: (id: number, body: UpdateBanRequest) => request<{ ban: BanRow }>("PATCH", "/api/admin/bans/" + id, body),
    audit: (params: { page?: number; pageSize?: number; action?: string }) =>
      request<AdminAuditResponse>("GET", "/api/admin/audit" + query(params)),
    sessions: () => request<AdminSessionsResponse>("GET", "/api/admin/sessions"),
    logs: (params: AdminLogQuery) => request<AdminLogListResponse>("GET", "/api/admin/logs" + query({ ...params })),
    logsExportUrl: (params: AdminLogQuery, format: "csv" | "json") =>
      "/api/admin/logs/export" + query({ ...params, format }),
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "发生未知错误";
}

export type { UserSelf };
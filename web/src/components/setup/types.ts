import type { AudioPresetId, RegistrationMode, SetupInitializeRequest, SetupStatusResponse } from "@airmic/shared";
import { presetSettings, SFU_RECOMMENDED_ROOM_USERS } from "@airmic/shared";

/** 初始化向导可选音质预设（不允许 custom） */
export type SetupPresetId = Exclude<AudioPresetId, "custom">;

/** 初始化向导表单状态 */
export interface SetupFormState {
  token: string;
  name: string;
  motd: string;
  registrationMode: RegistrationMode;
  guestEnabled: boolean;
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  maxUsersPerRoom: string;
  preset: SetupPresetId;
  createDefaultRooms: boolean;
}

export interface SetupStepInfo {
  id: "server" | "admin" | "voice" | "confirm";
  title: string;
}

export const SETUP_STEPS: SetupStepInfo[] = [
  { id: "server", title: "服务器" },
  { id: "admin", title: "管理员" },
  { id: "voice", title: "语音" },
  { id: "confirm", title: "确认" },
];

export const REGISTRATION_OPTIONS: { value: RegistrationMode; label: string }[] = [
  { value: "open", label: "开放注册" },
  { value: "invite", label: "邀请码注册" },
  { value: "closed", label: "关闭注册" },
];

export const REGISTRATION_LABELS: Record<RegistrationMode, string> = {
  open: "开放注册",
  invite: "邀请码注册",
  closed: "关闭注册",
};

export function createInitialForm(status: SetupStatusResponse): SetupFormState {
  const server = status.server;
  const preset: SetupPresetId = server.defaultAudioSettings.preset === "custom" ? "voice-standard" : server.defaultAudioSettings.preset;
  return {
    token: "",
    name: server.name,
    motd: server.motd,
    registrationMode: server.registrationMode,
    guestEnabled: server.guestEnabled,
    username: "",
    displayName: "",
    password: "",
    confirmPassword: "",
    livekitUrl: "",
    livekitApiKey: "",
    livekitApiSecret: "",
    maxUsersPerRoom: String(SFU_RECOMMENDED_ROOM_USERS),
    preset,
    createDefaultRooms: true,
  };
}

/** 校验指定步骤，返回中文错误文案；通过返回 null */
export function validateStep(step: number, form: SetupFormState, requiresToken: boolean): string | null {
  if (step === 0) {
    if (requiresToken && !form.token.trim()) return "请输入初始化口令";
    const name = form.name.trim();
    if (!name) return "请填写服务器名称";
    if (Array.from(name).length > 60) return "服务器名称最多 60 个字符";
    if (Array.from(form.motd).length > 500) return "服务器公告最多 500 个字符";
    return null;
  }
  if (step === 1) {
    const username = form.username.trim();
    if (!username) return "请填写管理员用户名";
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) return "用户名需为 3 - 24 位字母、数字、下划线或短横线";
    if (Array.from(form.displayName.trim()).length > 24) return "管理员昵称最多 24 个字符";
    if (form.password.length < 6) return "密码至少 6 位";
    if (form.password.length > 128) return "密码最多 128 位";
    if (form.password !== form.confirmPassword) return "两次输入的密码不一致";
    return null;
  }
  if (step === 2) {
    const limit = Number(form.maxUsersPerRoom);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) return "单房间人数上限需在 1 - 500 之间";
    const url = form.livekitUrl.trim();
    if (url && !/^wss?:\/\/\S+$/i.test(url)) return "LiveKit URL 需以 ws:// 或 wss:// 开头";
    if (url.length > 300) return "LiveKit URL 最多 300 个字符";
    if (form.livekitApiKey.trim().length > 200) return "API Key 最多 200 个字符";
    if (form.livekitApiSecret.trim().length > 300) return "API Secret 最多 300 个字符";
    return null;
  }
  return null;
}

/** 组装初始化请求 */
export function buildInitializeRequest(form: SetupFormState, requiresToken: boolean): SetupInitializeRequest {
  const livekitUrl = form.livekitUrl.trim();
  const livekitApiKey = form.livekitApiKey.trim();
  const livekitApiSecret = form.livekitApiSecret.trim();
  return {
    token: requiresToken ? form.token.trim() : undefined,
    admin: {
      username: form.username.trim(),
      password: form.password,
      displayName: form.displayName.trim() || undefined,
    },
    server: {
      name: form.name.trim(),
      motd: form.motd,
      registrationMode: form.registrationMode,
      guestEnabled: form.guestEnabled,
      maxUsersPerRoom: Number(form.maxUsersPerRoom),
      // 发送完整预设参数：服务端 normalizeAudioSettings 需要完整字段才能正确应用预设（preset 字段也保留）
      defaultAudioSettings: presetSettings(form.preset),
      livekitUrl: livekitUrl || undefined,
      livekitApiKey: livekitApiKey || undefined,
      livekitApiSecret: livekitApiSecret || undefined,
    },
    createDefaultRooms: form.createDefaultRooms,
  };
}

/** 各步骤组件共享的 props */
export interface SetupStepProps {
  form: SetupFormState;
  update: (patch: Partial<SetupFormState>) => void;
  disabled?: boolean;
}

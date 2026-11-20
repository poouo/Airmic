import { useEffect, useState } from "react";
import type { ServerSettings, UpdateSettingsRequest } from "@airmic/shared";
import { DEFAULT_AUDIO_SETTINGS } from "@airmic/shared";
import { RefreshCw, Save, Sparkles } from "lucide-react";
import { Badge, Button, Input, Select, Switch, Textarea } from "@/components/ui";
import AudioSettingsEditor from "@/components/lobby/AudioSettingsEditor";
import { api, errorMessage } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";
import { useAsyncData } from "./useAsyncData";
import CategoriesEditor from "./CategoriesEditor";
import IceServersEditor, { iceRowsFrom, iceRowsToConfigs, type IceDraft } from "./IceServersEditor";
import { AdminErrorPanel, AdminLoading, SectionCard } from "./shared";

function cloneSettings(settings: ServerSettings): ServerSettings {
  return {
    ...settings,
    defaultAudioSettings: { ...settings.defaultAudioSettings },
    iceServers: settings.iceServers.map((server) => ({ ...server })),
    roomCategories: [...settings.roomCategories],
  };
}

function randomInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(8);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    const byte = bytes[index] ?? 0;
    code += chars[byte % chars.length] ?? "A";
  }
  return code;
}

export default function SettingsTab() {
  const { data, loading, error, reload } = useAsyncData(() => api.admin.settings(), []);
  const [draft, setDraft] = useState<ServerSettings | null>(null);
  const [iceRows, setIceRows] = useState<IceDraft[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft(cloneSettings(data.settings));
    setIceRows(iceRowsFrom(data.settings.iceServers));
    setCategories([...data.settings.roomCategories]);
    setFormError(null);
  }, [data]);

  const update = (patch: Partial<ServerSettings>) => {
    setFormError(null);
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const validate = (current: ServerSettings): string | null => {
    if (!current.name.trim()) return "服务器名称不能为空";
    if (Array.from(current.name).length > 60) return "服务器名称最多 60 个字符";
    if (Array.from(current.motd).length > 500) return "MOTD 最多 500 个字符";
    if (current.registrationMode === "invite" && !current.registrationCode.trim()) return "邀请码注册模式需要填写邀请码";
    if (current.maxUsers < 1 || current.maxUsers > 10000) return "服务器人数上限需在 1 - 10000 之间";
    if (current.maxUsersPerRoom < 1 || current.maxUsersPerRoom > 100) return "房间人数上限需在 1 - 100 之间";
    if (current.maxRooms < 0 || current.maxRooms > 1000) return "房间数量上限需在 0 - 1000 之间";
    if (current.maxChatLength < 20 || current.maxChatLength > 5000) return "聊天长度上限需在 20 - 5000 之间";
    if (current.maxMessagesPerRoom < 0 || current.maxMessagesPerRoom > 5000) return "房间消息保留数需在 0 - 5000 之间";
    if (categories.length === 0) return "至少保留一个房间分类";
    const brokenIndex = iceRows.findIndex((row) => !row.urls.trim() && (row.username.trim() || row.credential.trim()));
    if (brokenIndex >= 0) return "第 " + (brokenIndex + 1) + " 个 ICE 服务器缺少地址";
    return null;
  };

  const handleSave = async () => {
    if (!draft) return;
    const message = validate(draft);
    if (message) {
      setFormError(message);
      return;
    }
    setFormError(null);
    setSaving(true);
    const payload: UpdateSettingsRequest = {
      name: draft.name.trim(),
      motd: draft.motd,
      registrationMode: draft.registrationMode,
      registrationCode: draft.registrationCode.trim(),
      guestEnabled: draft.guestEnabled,
      maxUsers: draft.maxUsers,
      maxUsersPerRoom: draft.maxUsersPerRoom,
      maxRooms: draft.maxRooms,
      allowRoomCreation: draft.allowRoomCreation,
      allowGuestRoomCreation: draft.allowGuestRoomCreation,
      allowScreenShare: draft.allowScreenShare,
      allowTextChat: draft.allowTextChat,
      allowGuestChat: draft.allowGuestChat,
      maxChatLength: draft.maxChatLength,
      maxMessagesPerRoom: draft.maxMessagesPerRoom,
      defaultAudioSettings: draft.defaultAudioSettings,
      iceServers: iceRowsToConfigs(iceRows),
      forceRelay: draft.forceRelay,
      roomCategories: categories,
    };
    try {
      const result = await api.admin.updateSettings(payload);
      setDraft(cloneSettings(result.settings));
      setIceRows(iceRowsFrom(result.settings.iceServers));
      setCategories([...result.settings.roomCategories]);
      useAppStore.getState().setServer(result.settings);
      useUiStore.getState().toast("服务器设置已保存并实时生效", "success");
    } catch (caught) {
      const text = errorMessage(caught);
      setFormError(text);
      useUiStore.getState().toast(text, "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <AdminLoading text="正在加载服务器设置…" />;
  if (error) return <AdminErrorPanel message={error} onRetry={reload} />;
  if (!draft) return null;

  return (
    <div className="space-y-4">
      {formError && <div className="rounded-xl border border-bad-500/30 bg-bad-500/10 px-3 py-2.5 text-xs text-bad-400">{formError}</div>}

      <SectionCard title="基本信息" description="服务器名称与公告会展示在登录页和客户端顶栏">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="服务器名称" required value={draft.name} maxLength={60} onChange={(event) => update({ name: event.target.value })} />
          <div className="flex items-end">
            <Badge tone="brand">版本 {draft.version}</Badge>
          </div>
        </div>
        <div className="mt-3">
          <Textarea label="服务器公告（MOTD）" rows={3} maxLength={500} value={draft.motd} hint="支持换行，最多 500 个字符；展示在登录页与大厅欢迎区" onChange={(event) => update({ motd: event.target.value })} />
        </div>
      </SectionCard>

      <SectionCard title="注册与游客" description="控制新用户如何加入服务器">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <Select
              label="注册模式"
              options={[
                { value: "open", label: "开放注册" },
                { value: "invite", label: "邀请码注册" },
                { value: "closed", label: "关闭注册" },
              ]}
              value={draft.registrationMode}
              hint={draft.registrationMode === "closed" ? "仅允许已有账号登录" : undefined}
              onChange={(event) => update({ registrationMode: event.target.value === "invite" ? "invite" : event.target.value === "closed" ? "closed" : "open" })}
            />
            {draft.registrationMode === "invite" && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input label="邀请码" required value={draft.registrationCode} maxLength={32} placeholder="例如：AIRMIC2026" onChange={(event) => update({ registrationCode: event.target.value })} />
                </div>
                <Button variant="secondary" size="md" icon={<Sparkles className="h-4 w-4" />} onClick={() => update({ registrationCode: randomInviteCode() })}>
                  随机生成
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-3 rounded-xl border border-white/10 bg-ink-900/40 p-3">
            <Switch label="允许游客登录" description="关闭后游客入口不可用" checked={draft.guestEnabled} onChange={(guestEnabled) => update({ guestEnabled })} />
            <Switch label="允许游客创建房间" description="仅对游客角色生效" checked={draft.allowGuestRoomCreation} onChange={(allowGuestRoomCreation) => update({ allowGuestRoomCreation })} />
            <Switch label="允许游客发送聊天" description="关闭后游客只能收听" checked={draft.allowGuestChat} onChange={(allowGuestChat) => update({ allowGuestChat })} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="容量与限制" description="服务器总人数、房间数量与消息保留策略">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="服务器人数上限" value={draft.maxUsers} min={1} max={10000} hint="1 - 10000" onChange={(maxUsers) => update({ maxUsers })} />
          <NumberField label="单房间人数上限" value={draft.maxUsersPerRoom} min={1} max={100} hint="1 - 100，房间上限不会超过此值" onChange={(maxUsersPerRoom) => update({ maxUsersPerRoom })} />
          <NumberField label="房间数量上限" value={draft.maxRooms} min={0} max={1000} hint="0 表示不限制" onChange={(maxRooms) => update({ maxRooms })} />
          <NumberField label="聊天消息长度上限" value={draft.maxChatLength} min={20} max={5000} hint="20 - 5000 个字符" onChange={(maxChatLength) => update({ maxChatLength })} />
          <NumberField label="房间消息保留条数" value={draft.maxMessagesPerRoom} min={0} max={5000} hint="0 表示不保留历史消息" onChange={(maxMessagesPerRoom) => update({ maxMessagesPerRoom })} />
        </div>
      </SectionCard>

      <SectionCard title="功能开关" description="全局开启或关闭创建房间、屏幕共享与文字聊天">
        <div className="grid gap-3 sm:grid-cols-2">
          <Switch label="允许普通用户创建房间" description="管理员/版主始终可以创建" checked={draft.allowRoomCreation} onChange={(allowRoomCreation) => update({ allowRoomCreation })} />
          <Switch label="允许屏幕共享" description="关闭后房间内无法开启共享" checked={draft.allowScreenShare} onChange={(allowScreenShare) => update({ allowScreenShare })} />
          <Switch label="允许文字聊天" description="关闭后所有房间禁用聊天" checked={draft.allowTextChat} onChange={(allowTextChat) => update({ allowTextChat })} />
          <Switch label="强制 TURN 中继" description="所有语音都经过 TURN，隐私更强但更耗带宽" checked={draft.forceRelay} onChange={(forceRelay) => update({ forceRelay })} />
        </div>
      </SectionCard>

      <SectionCard title="默认音质" description="新建房间的默认音质，房间可单独覆盖；用户也可在本机设置中覆盖">
        <AudioSettingsEditor base={DEFAULT_AUDIO_SETTINGS} value={draft.defaultAudioSettings} onChange={(defaultAudioSettings) => update({ defaultAudioSettings })} />
      </SectionCard>

      <SectionCard title="ICE 服务器" description="STUN/TURN 配置，用于跨公网建立 WebRTC 连接">
        <IceServersEditor value={iceRows} onChange={setIceRows} />
      </SectionCard>

      <SectionCard title="房间分类" description="大厅与房间表单按分类分组展示">
        <CategoriesEditor value={categories} onChange={setCategories} />
      </SectionCard>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-ink-850 px-4 py-3">
        <p className="text-[11px] text-mist-500">保存后服务器会向所有在线用户广播新设置。</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={saving} onClick={reload}>
            重新加载
          </Button>
          <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={() => void handleSave()}>
            保存设置
          </Button>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <Input
      label={label}
      type="number"
      min={min}
      max={max}
      value={text}
      hint={hint}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = Number(next);
        if (next !== "" && Number.isFinite(parsed)) onChange(Math.trunc(parsed));
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

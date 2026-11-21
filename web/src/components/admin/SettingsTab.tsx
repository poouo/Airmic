import { useEffect, useState } from "react";
import type { ServerSettings, UpdateSettingsRequest } from "@airmic/shared";
import { DEFAULT_AUDIO_SETTINGS } from "@airmic/shared";
import { Eye, EyeOff, RadioTower, RefreshCw, Save, Sparkles, WifiOff } from "lucide-react";
import { Alert, Badge, Button, Card, Input, Select, Switch, Textarea } from "@/components/ui";
import AudioSettingsEditor from "@/components/lobby/AudioSettingsEditor";
import { api, errorMessage } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";
import { useAsyncData } from "./useAsyncData";
import UpdateCard from "./UpdateCard";
import { AdminErrorPanel, AdminLoading, SectionCard } from "./shared";

function cloneSettings(settings: ServerSettings): ServerSettings {
  return {
    ...settings,
    defaultAudioSettings: { ...settings.defaultAudioSettings },
    iceServers: settings.iceServers.map((server) => ({ ...server })),
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
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [livekitDirty, setLivekitDirty] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDraft(cloneSettings(data.settings));
    setLivekitDirty(false);
    setFormError(null);
  }, [data]);

  const update = (patch: Partial<ServerSettings>) => {
    setFormError(null);
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  /** 语音中转配置只有被修改时才提交，避免把服务端未返回的密钥清空 */
  const updateLivekit = (patch: Partial<Pick<ServerSettings, "livekitUrl" | "livekitApiKey" | "livekitApiSecret">>) => {
    setLivekitDirty(true);
    update(patch);
  };

  const validate = (current: ServerSettings): string | null => {
    if (!current.name.trim()) return "服务器名称不能为空";
    if (Array.from(current.name).length > 60) return "服务器名称最多 60 个字符";
    if (Array.from(current.motd).length > 500) return "MOTD 最多 500 个字符";
    if (current.registrationMode === "invite" && !current.registrationCode.trim()) return "邀请码注册模式需要填写邀请码";
    if (current.maxUsers < 1 || current.maxUsers > 10000) return "服务器人数上限需在 1 - 10000 之间";
    if (current.maxUsersPerRoom < 1 || current.maxUsersPerRoom > 500) return "单房间人数上限需在 1 - 500 之间";
    if (current.maxRooms < 0 || current.maxRooms > 1000) return "房间数量上限需在 0 - 1000 之间";
    if (current.maxChatLength < 20 || current.maxChatLength > 5000) return "聊天长度上限需在 20 - 5000 之间";
    if (current.maxMessagesPerRoom < 0 || current.maxMessagesPerRoom > 5000) return "房间消息保留数需在 0 - 5000 之间";
    const livekitUrl = (current.livekitUrl ?? "").trim();
    if (livekitUrl && !/^wss?:\/\/\S+$/i.test(livekitUrl)) return "LiveKit URL 需以 ws:// 或 wss:// 开头";
    if (livekitUrl.length > 300) return "LiveKit URL 最多 300 个字符";
    if ((current.livekitApiKey ?? "").trim().length > 200) return "LiveKit API Key 最多 200 个字符";
    if ((current.livekitApiSecret ?? "").trim().length > 300) return "LiveKit API Secret 最多 300 个字符";
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
    };
    if (livekitDirty) {
      // 空字符串表示清除对应配置（服务端会归一化为 null）
      payload.livekitUrl = (draft.livekitUrl ?? "").trim();
      payload.livekitApiKey = (draft.livekitApiKey ?? "").trim();
      payload.livekitApiSecret = (draft.livekitApiSecret ?? "").trim();
    }
    try {
      const result = await api.admin.updateSettings(payload);
      setDraft(cloneSettings(result.settings));
      setLivekitDirty(false);
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

  if (loading && !data)
    return (
      <Card>
        <AdminLoading text="正在加载服务器设置…" />
      </Card>
    );
  if (error)
    return (
      <Card>
        <div className="px-5 py-4">
          <AdminErrorPanel message={error} onRetry={reload} />
        </div>
      </Card>
    );
  if (!draft) return null;

  return (
    <div className="space-y-4">
      {formError && <Alert tone="error">{formError}</Alert>}

      <SectionCard title="基本信息">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="服务器名称" required value={draft.name} maxLength={60} onChange={(event) => update({ name: event.target.value })} />
          <div className="flex items-end pb-1">
            <Badge tone="brand">版本 {draft.version}</Badge>
          </div>
        </div>
        <div className="mt-3">
          <Textarea
            label="服务器公告（MOTD）"
            rows={3}
            maxLength={500}
            value={draft.motd}
            hint="最多 500 字，显示在登录页和大厅"
            onChange={(event) => update({ motd: event.target.value })}
          />
        </div>
      </SectionCard>

      <SectionCard title="注册与游客">
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
                  <Input
                    label="邀请码"
                    required
                    value={draft.registrationCode}
                    maxLength={32}
                    placeholder="例如：AIRMIC2026"
                    onChange={(event) => update({ registrationCode: event.target.value })}
                  />
                </div>
                <Button variant="secondary" size="md" icon={<Sparkles className="h-4 w-4" />} onClick={() => update({ registrationCode: randomInviteCode() })}>
                  随机生成
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3.5">
            <Switch label="允许游客登录" checked={draft.guestEnabled} onChange={(guestEnabled) => update({ guestEnabled })} />
            <Switch
              label="允许游客创建房间"
              checked={draft.allowGuestRoomCreation}
              onChange={(allowGuestRoomCreation) => update({ allowGuestRoomCreation })}
            />
            <Switch label="游客可发消息" checked={draft.allowGuestChat} onChange={(allowGuestChat) => update({ allowGuestChat })} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="容量与限制">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="服务器人数上限" value={draft.maxUsers} min={1} max={10000} hint="1 - 10000" onChange={(maxUsers) => update({ maxUsers })} />
          <NumberField
            label="单房间人数上限"
            value={draft.maxUsersPerRoom}
            min={1}
            max={500}
            hint="最多 500 人"
            onChange={(maxUsersPerRoom) => update({ maxUsersPerRoom })}
          />
          <NumberField label="房间数量上限" value={draft.maxRooms} min={0} max={1000} hint="0 表示不限制" onChange={(maxRooms) => update({ maxRooms })} />
          <NumberField label="聊天消息长度上限" value={draft.maxChatLength} min={20} max={5000} hint="20 - 5000 个字符" onChange={(maxChatLength) => update({ maxChatLength })} />
          <NumberField
            label="房间消息保留条数"
            value={draft.maxMessagesPerRoom}
            min={0}
            max={5000}
            hint="0 表示不保留历史消息"
            onChange={(maxMessagesPerRoom) => update({ maxMessagesPerRoom })}
          />
        </div>
      </SectionCard>

      <SectionCard title="房间功能">
        <div className="grid gap-3 sm:grid-cols-2">
          <Switch
            label="允许普通用户创建房间"
            checked={draft.allowRoomCreation}
            onChange={(allowRoomCreation) => update({ allowRoomCreation })}
          />
          <Switch label="允许屏幕共享" checked={draft.allowScreenShare} onChange={(allowScreenShare) => update({ allowScreenShare })} />
          <Switch label="允许文字聊天" checked={draft.allowTextChat} onChange={(allowTextChat) => update({ allowTextChat })} />
        </div>
      </SectionCard>

      <SectionCard title="语音中转">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={draft.voiceAvailable ? "good" : "warn"}>
            {draft.voiceAvailable ? <RadioTower className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {draft.voiceAvailable ? "语音可用" : "未配置语音中转"}
          </Badge>
          <Badge tone="neutral">SFU 服务端中转 · 不做 P2P</Badge>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{draft.livekitUrl ?? "未配置 LiveKit 地址"}</span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="LiveKit URL"
              value={draft.livekitUrl ?? ""}
              maxLength={300}
              placeholder="ws://localhost:7880"
              hint="支持 ws:// 和 wss://"
              onChange={(event) => updateLivekit({ livekitUrl: event.target.value })}
            />
          </div>
          <Input
            label="API Key"
            value={draft.livekitApiKey ?? ""}
            maxLength={200}
            placeholder="例如：devkey"
            onChange={(event) => updateLivekit({ livekitApiKey: event.target.value })}
          />
          <Input
            label="API Secret"
            type={secretVisible ? "text" : "password"}
            autoComplete="new-password"
            value={draft.livekitApiSecret ?? ""}
            maxLength={300}
            placeholder="LiveKit API Secret"
            rightSlot={
              <button
                type="button"
                onClick={() => setSecretVisible((value) => !value)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={secretVisible ? "隐藏 API Secret" : "显示 API Secret"}
              >
                {secretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
            onChange={(event) => updateLivekit({ livekitApiSecret: event.target.value })}
          />
        </div>

        <div className="mt-3 space-y-1 text-xs leading-relaxed text-muted-foreground">
          <p>填齐三项才能通话。修改后请重新加入房间。</p>
        </div>
      </SectionCard>

      <SectionCard title="默认音质">
        <AudioSettingsEditor base={DEFAULT_AUDIO_SETTINGS} value={draft.defaultAudioSettings} onChange={(defaultAudioSettings) => update({ defaultAudioSettings })} />
      </SectionCard>

      <UpdateCard />

      <div className="sticky bottom-0 z-20 flex items-center justify-end gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-popover sm:px-5">
        <div className="flex items-center gap-2">
          <Button variant="outline" className="min-h-11" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={saving} onClick={reload}>
            重载
          </Button>
          <Button className="min-h-11" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={() => void handleSave()}>
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

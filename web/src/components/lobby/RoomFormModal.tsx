import { useState } from "react";
import type { AudioSettings, CreateRoomRequest, RoomSummary, UpdateRoomRequest } from "@airmic/shared";
import { canManageArea, diffAudioSettings } from "@airmic/shared";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  FieldShell,
  Input,
  Modal,
  Select,
  Switch,
  Textarea,
} from "@/components/ui";
import { ROOM_ICONS } from "@/components/room/roomIcons";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import AudioSettingsEditor from "./AudioSettingsEditor";
import { roomCreationAreas } from "./access";
import type { RoomFormInitial } from "./roomForm";

export interface RoomFormModalProps {
  initial: RoomFormInitial;
  /** 服务器默认音质（音质编辑器的基准） */
  audioBase: AudioSettings;
  /** 编辑模式下是否允许删除房间 */
  canDelete?: boolean;
  onClose: () => void;
  onSaved: (room: RoomSummary) => void;
  onDeleted?: (roomId: number) => void;
}

export default function RoomFormModal({ initial, audioBase, canDelete = false, onClose, onSaved, onDeleted }: RoomFormModalProps) {
  const server = useAppStore((state) => state.server);
  const directory = useAppStore((state) => state.directory);
  const user = useAuthStore((state) => state.user);
  const isEdit = initial.id !== null;

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [areaId, setAreaId] = useState(initial.areaId);
  const [icon, setIcon] = useState(initial.icon);
  const [sortOrder, setSortOrder] = useState(String(initial.sortOrder ?? ""));
  const [maxUsers, setMaxUsers] = useState(String(initial.maxUsers));
  const [maxUsersDirty, setMaxUsersDirty] = useState(false);
  const [locked, setLocked] = useState(initial.locked);
  const [allowGuests, setAllowGuests] = useState(initial.allowGuests);
  const [textChatEnabled, setTextChatEnabled] = useState(initial.textChatEnabled);
  const [chatHistoryDays, setChatHistoryDays] = useState(String(initial.chatHistoryDays));
  const [screenShareEnabled, setScreenShareEnabled] = useState(initial.screenShareEnabled);
  const [requirePassword, setRequirePassword] = useState(initial.hasPassword);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [followDefault, setFollowDefault] = useState(initial.audioOverride === null);
  const [audio, setAudio] = useState<AudioSettings>(initial.audioSettings);
  const [audioDirty, setAudioDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const areas = directory?.areas ?? [];
  const destinations = isEdit
    ? areas.filter((area) => area.parentId !== null && (area.id === initial.areaId ||
      (!initial.codeOnly && area.kind !== "code" && user && directory && canManageArea(user, area, directory.grants))))
    : roomCreationAreas(user, server, directory);
  const areaOptions = destinations.map((area) => ({
    value: String(area.id),
    label: `${areas.find((root) => root.id === area.parentId)?.name ?? ""} / ${area.name}`,
  }));
  const roomLimit = server?.maxUsersPerRoom ?? 0;
  const screenShareAllowed = server?.allowScreenShare ?? true;

  const validate = (): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return "请填写房间名称";
    if (Array.from(trimmed).length > 40) return "房间名称最多 40 个字符";
    if (!destinations.some((area) => area.id === areaId)) return "请选择有效的子区";
    if (Array.from(description).length > 200) return "房间简介最多 200 个字符";
    if (requirePassword) {
      if (!password && !initial.hasPassword) return "请设置房间密码（至少 4 位）";
      if (password && (password.length < 4 || password.length > 64)) return "房间密码需为 4 - 64 位";
    }
    const limit = Number(maxUsers);
    if (!Number.isInteger(limit) || limit < 0 || limit > 500) return "人数上限需为 0 到 500 的整数";
    const days = Number(chatHistoryDays);
    if (!Number.isInteger(days) || days < 1 || days > 30) return "聊天记录保留天数需为 1 到 30";
    if (sortOrder && (!Number.isInteger(Number(sortOrder)) || Math.abs(Number(sortOrder)) > 100000)) return "排序值需为 -100000 到 100000 的整数";
    return null;
  };

  const handleSubmit = async () => {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setSubmitting(true);
    const payload: CreateRoomRequest = {
      name: name.trim(),
      description: description.trim(),
      icon,
      locked,
      screenShareEnabled,
    };
    if (!isEdit || areaId !== initial.areaId) payload.areaId = areaId;
    if (!isEdit || allowGuests !== initial.allowGuests) payload.allowGuests = allowGuests;
    if (!isEdit || textChatEnabled !== initial.textChatEnabled) payload.textChatEnabled = textChatEnabled;
    if (!isEdit || Number(chatHistoryDays) !== initial.chatHistoryDays) payload.chatHistoryDays = Number(chatHistoryDays);
    if (sortOrder !== "" && Number(sortOrder) !== initial.sortOrder) payload.sortOrder = Number(sortOrder);
    // 编辑时只有用户主动修改人数上限才提交，避免把“继承服务器上限”变成固定值
    if (!isEdit || maxUsersDirty) payload.maxUsers = Math.trunc(Number(maxUsers));
    // 创建时必须提交（null = 跟随服务器默认）；编辑时未改动音质则不提交，保留房间原有覆盖
    if (!isEdit || audioDirty) {
      payload.audioOverride = followDefault ? null : diffAudioSettings(audioBase, audio);
    }
    if (requirePassword) {
      if (password) payload.password = password;
    } else {
      payload.password = null;
    }
    try {
      if (initial.id !== null) {
        const result = await api.rooms.update(initial.id, payload as UpdateRoomRequest);
        useUiStore.getState().toast("房间「" + result.room.name + "」已更新", "success");
        onSaved(result.room);
      } else {
        const result = await api.rooms.create(payload);
        useUiStore.getState().toast("房间「" + result.room.name + "」创建成功", "success");
        onSaved(result.room);
      }
      onClose();
    } catch (caught) {
      const text = errorMessage(caught);
      setError(text);
      useUiStore.getState().toast(text, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (initial.id === null) return;
    const confirmed = await useUiStore.getState().confirm({
      title: "删除房间",
      message: `删除「${initial.name}」会移出所有成员并清除聊天记录。`,
      confirmText: "删除房间",
      danger: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await api.rooms.remove(initial.id);
      useUiStore.getState().toast("房间已删除", "success");
      onDeleted?.(initial.id);
      onClose();
    } catch (caught) {
      const text = errorMessage(caught);
      setError(text);
      useUiStore.getState().toast(text, "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open
      onClose={submitting || deleting ? () => undefined : onClose}
      title={isEdit ? "编辑房间" : "创建房间"}
      size="2xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {isEdit && canDelete && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
              loading={deleting}
              onClick={() => void handleDelete()}
            >
              删除房间
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting || deleting}>
            取消
          </Button>
          <Button size="sm" loading={submitting} onClick={() => void handleSubmit()} disabled={deleting}>
            {isEdit ? "保存修改" : "创建房间"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="基本信息" />
            <CardContent className="space-y-3">
              <Input label="房间名称" required value={name} maxLength={40} placeholder="例如：周末开黑房" onChange={(event) => setName(event.target.value)} />
              <Select
                label="所属子区"
                options={areaOptions}
                value={String(areaId)}
                disabled={areaOptions.length < 2}
                onChange={(event) => setAreaId(Number(event.target.value))}
              />
              <Textarea label="房间简介" rows={2} maxLength={200} value={description} placeholder="选填" onChange={(event) => setDescription(event.target.value)} />
              <details className="rounded-xl border border-border px-3">
                <summary className="cursor-pointer py-2.5 text-sm font-medium">排序和图标</summary>
                <div className="space-y-3 pb-3">
                  <Input label="排序值" type="number" min={-100000} max={100000} value={sortOrder} hint="数字越小越靠前" onChange={(event) => setSortOrder(event.target.value)} />
                  <FieldShell label="房间图标">
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="房间图标">
                      {ROOM_ICONS.map((item) => {
                        const selected = item.key === icon;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            aria-label={item.label}
                            aria-pressed={selected}
                            title={item.label}
                            onClick={() => setIcon(item.key)}
                            className={cn(
                              "flex h-10 w-10 items-center justify-center rounded-field border outline-none transition-colors sm:h-8 sm:w-8",
                              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                              selected
                                ? "border-brand/50 bg-brand/10 text-brand ring-1 ring-brand/30"
                                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                          >
                            <item.Icon className="h-4 w-4" />
                          </button>
                        );
                      })}
                    </div>
                  </FieldShell>
                </div>
              </details>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="人数与权限" />
            <CardContent className="space-y-3">
              <Input
                label="人数上限"
                type="number"
                min={0}
                max={500}
                value={maxUsers}
                hint={`0 = 服务器上限${roomLimit > 0 ? `（${roomLimit} 人）` : ""}`}
                onChange={(event) => {
                  setMaxUsers(event.target.value);
                  setMaxUsersDirty(true);
                }}
              />
              <div className="space-y-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
                <Switch label="锁定房间" description="锁定后禁止加入" checked={locked} onChange={setLocked} />
                <Switch label="允许游客进入" description="关闭后仅注册用户可加入" checked={allowGuests} onChange={setAllowGuests} />
                <Switch
                  label="允许屏幕共享"
                  description={screenShareAllowed ? undefined : "服务器已关闭共享"}
                  checked={screenShareEnabled && screenShareAllowed}
                  disabled={!screenShareAllowed}
                  onChange={setScreenShareEnabled}
                />
                <Switch label="允许文字聊天" checked={textChatEnabled} onChange={setTextChatEnabled} />
              </div>

              {!initial.codeOnly && <div className="space-y-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
                <Switch
                  label="需要密码"
                  description={isEdit && initial.hasPassword ? "关闭后清除密码" : undefined}
                  checked={requirePassword}
                  onChange={(checked) => {
                    setRequirePassword(checked);
                    if (!checked) setPassword("");
                  }}
                />
                {requirePassword && (
                  <Input
                    label="房间密码"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    maxLength={64}
                    autoComplete="new-password"
                    placeholder={isEdit && initial.hasPassword ? "留空保持密码" : "至少 4 位"}
                    rightSlot={
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    }
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}
              </div>}
            </CardContent>
          </Card>
        </div>

        <details className="rounded-xl border border-border bg-card px-4">
          <summary className="cursor-pointer py-3 text-sm font-medium">聊天记录</summary>
          <div className="max-w-xs pb-4">
            <Input label="聊天记录保留天数" type="number" min={1} max={30} value={chatHistoryDays} hint="1–30 天，到期自动清理"
              onChange={(event) => setChatHistoryDays(event.target.value)} />
          </div>
        </details>

        <details className="rounded-xl border border-border bg-card px-4">
          <summary className="cursor-pointer py-3 text-sm font-medium">音质设置</summary>
          <div className="pb-4">
              <AudioSettingsEditor
                base={audioBase}
                value={audio}
                onChange={(next) => {
                  setAudio(next);
                  setAudioDirty(true);
                }}
                followDefault={followDefault}
                onFollowDefaultChange={(next) => {
                  setFollowDefault(next);
                  setAudioDirty(true);
                }}
              />
          </div>
        </details>
      </div>
    </Modal>
  );
}

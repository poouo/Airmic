import { useState } from "react";
import type { AudioSettings, CreateRoomRequest, RoomSummary, UpdateRoomRequest } from "@airmic/shared";
import { diffAudioSettings } from "@airmic/shared";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardContent, CardHeader, Input, Modal, Select, Switch, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";
import AudioSettingsEditor from "./AudioSettingsEditor";
import { categoryOptions, type RoomFormInitial } from "./roomForm";

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
  const isEdit = initial.id !== null;

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [category, setCategory] = useState(initial.category);
  const [maxUsers, setMaxUsers] = useState(String(initial.maxUsers));
  const [maxUsersDirty, setMaxUsersDirty] = useState(false);
  const [locked, setLocked] = useState(initial.locked);
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

  const categories = categoryOptions(server?.roomCategories ?? [], initial.category);
  const roomLimit = server?.maxUsersPerRoom ?? 0;
  const screenShareAllowed = server?.allowScreenShare ?? true;

  const validate = (): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return "请填写房间名称";
    if (Array.from(trimmed).length > 40) return "房间名称最多 40 个字符";
    if (Array.from(description).length > 200) return "房间简介最多 200 个字符";
    if (requirePassword) {
      if (!password && !initial.hasPassword) return "请设置房间密码（至少 4 位）";
      if (password && (password.length < 4 || password.length > 64)) return "房间密码需为 4 - 64 位";
    }
    const limit = Number(maxUsers);
    if (!Number.isFinite(limit) || limit < 0 || limit > 100) return "人数上限需在 0 - 100 之间（0 表示跟随服务器）";
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
      category,
      locked,
      screenShareEnabled,
    };
    // 编辑时只有用户主动修改人数上限才提交，避免把“继承服务器上限”变成固定值
    if (!isEdit || maxUsersDirty) payload.maxUsers = Math.trunc(Number(maxUsers));
    // 创建时必须提交（null = 跟随服务器默认）；编辑时未改动音质则不提交，保留房间原有覆盖
    if (initial.audioKnown && (!isEdit || audioDirty)) {
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
      message: "确定删除房间「" + initial.name + "」吗？房间内的用户会被移出，聊天记录也会一并删除，此操作不可撤销。",
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
      subtitle={isEdit ? "修改房间信息、权限与音质；配置会实时同步给房间内用户" : "新房间会立即出现在大厅中，可随时再编辑"}
      size="2xl"
      footer={
        <div className="flex w-full items-center gap-2">
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
                label="房间分类"
                options={categories.map((item) => ({ value: item, label: item }))}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
              <Textarea
                label="房间简介"
                hint="选填，最多 200 个字符"
                rows={2}
                maxLength={200}
                value={description}
                placeholder="介绍一下这个房间…"
                onChange={(event) => setDescription(event.target.value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="人数与权限" />
            <CardContent className="space-y-3">
              <Input
                label="人数上限"
                type="number"
                min={0}
                max={100}
                value={maxUsers}
                hint={"0 = 跟随服务器上限" + (roomLimit > 0 ? "（当前服务器上限 " + roomLimit + " 人）" : "") + "；不修改则保持原有设置"}
                onChange={(event) => {
                  setMaxUsers(event.target.value);
                  setMaxUsersDirty(true);
                }}
              />
              <div className="space-y-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
                <Switch label="房间锁定" description="锁定后普通用户无法加入" checked={locked} onChange={setLocked} />
                <Switch
                  label="允许屏幕共享"
                  description={screenShareAllowed ? "房间内同时仅允许一人共享" : "服务器已全局关闭屏幕共享"}
                  checked={screenShareEnabled && screenShareAllowed}
                  disabled={!screenShareAllowed}
                  onChange={setScreenShareEnabled}
                />
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
                <Switch
                  label="需要密码"
                  description={isEdit && initial.hasPassword ? "关闭开关并保存将清除当前密码" : "开启后用户进入房间需输入密码"}
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
                    placeholder={isEdit && initial.hasPassword ? "留空保持当前密码" : "至少 4 位"}
                    hint={isEdit && initial.hasPassword ? "留空表示不修改密码" : "4 - 64 位，房间内用户需输入此密码"}
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
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader title="音质设置" action={!initial.audioKnown ? <Badge tone="warn">需要服务器管理权限才能编辑音质</Badge> : undefined} />
          <CardContent>
            {initial.audioKnown ? (
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
            ) : (
              <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                当前账号可以编辑房间的基础信息、密码与人数，但修改音质需要「服务器管理」权限。保存时不会改动房间已有的音质配置。
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </Modal>
  );
}

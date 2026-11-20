import { useState } from "react";
import { AUDIO_PRESET_LIST, formatBitrate, SFU_RECOMMENDED_ROOM_USERS } from "@airmic/shared";
import { Eye, EyeOff } from "lucide-react";
import { Alert, IconButton, Input, Switch } from "@/components/ui";
import { cn } from "@/lib/format";
import type { SetupPresetId, SetupStepProps } from "./types";

const PRESETS = AUDIO_PRESET_LIST.filter((preset) => preset.id !== "custom");

/** 第 3 步：语音中转与音质 */
export default function SetupVoiceStep({ form, update, disabled }: SetupStepProps) {
  const [secretVisible, setSecretVisible] = useState(false);

  return (
    <div className="space-y-4">
      <Alert tone="info">AirMic 的语音全部经你自己的 LiveKit 服务器中转，不做客户端 P2P，房间人数可支持 50-100+。</Alert>

      <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-foreground">LiveKit 语音中转</p>
          <span className="text-[10px] text-muted-foreground">可选，稍后也可在管理后台配置</span>
        </div>
        <Input
          label="LiveKit URL"
          value={form.livekitUrl}
          maxLength={300}
          placeholder="ws://localhost:7880"
          hint="ws:// 或 wss:// 地址；客户端将通过该地址连接语音中转服务"
          disabled={disabled}
          onChange={(event) => update({ livekitUrl: event.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="API Key"
            value={form.livekitApiKey}
            maxLength={200}
            placeholder="例如：devkey"
            hint="LiveKit 配置中的 API Key"
            disabled={disabled}
            onChange={(event) => update({ livekitApiKey: event.target.value })}
          />
          <Input
            label="API Secret"
            type={secretVisible ? "text" : "password"}
            autoComplete="new-password"
            value={form.livekitApiSecret}
            maxLength={300}
            placeholder="LiveKit API Secret"
            hint="仅保存在服务器，用于签发访问令牌"
            disabled={disabled}
            rightSlot={
              <IconButton
                label={secretVisible ? "隐藏 API Secret" : "显示 API Secret"}
                size="sm"
                onClick={() => setSecretVisible((value) => !value)}
              >
                {secretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </IconButton>
            }
            onChange={(event) => update({ livekitApiSecret: event.target.value })}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">需要自行部署 LiveKit，详见部署文档；也可稍后在管理后台配置。三项配置齐全后房间内语音才可用。</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="单房间人数上限"
          type="number"
          min={1}
          max={500}
          value={form.maxUsersPerRoom}
          placeholder={String(SFU_RECOMMENDED_ROOM_USERS)}
          hint="SFU 中转模式推荐 50 - 100+ 人，范围 1 - 500"
          disabled={disabled}
          onChange={(event) => update({ maxUsersPerRoom: event.target.value })}
        />
        <div className="flex flex-col justify-center rounded-xl border border-border bg-muted/40 px-4 py-3">
          <Switch
            label="创建默认房间"
            description="初始化后自动创建「开黑大厅」与「休息室」两个默认房间"
            checked={form.createDefaultRooms}
            disabled={disabled}
            onChange={(createDefaultRooms) => update({ createDefaultRooms })}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-foreground">默认音质预设</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((preset) => {
            const active = form.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => update({ preset: preset.id as SetupPresetId })}
                className={cn(
                  "rounded-xl border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  active ? "border-foreground/30 bg-secondary" : "border-border bg-card hover:border-foreground/20 hover:bg-accent",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{preset.label}</span>
                  <span className={cn("h-2 w-2 rounded-full", active ? "bg-primary" : "bg-border")} />
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{preset.description}</span>
                <span className="mt-1.5 block font-mono text-[10px] text-muted-foreground">
                  {formatBitrate(preset.settings.bitrate)} · {preset.settings.sampleRate / 1000} kHz · {preset.settings.channels === 2 ? "立体声" : "单声道"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

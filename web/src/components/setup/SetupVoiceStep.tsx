import { useState } from "react";
import { AUDIO_PRESET_LIST, formatBitrate, SFU_RECOMMENDED_ROOM_USERS } from "@airmic/shared";
import { Eye, EyeOff, RadioTower } from "lucide-react";
import { Input, Switch } from "@/components/ui";
import { cn } from "@/lib/format";
import type { SetupPresetId, SetupStepProps } from "./types";

const PRESETS = AUDIO_PRESET_LIST.filter((preset) => preset.id !== "custom");

/** 第 3 步：语音中转与音质 */
export default function SetupVoiceStep({ form, update, disabled }: SetupStepProps) {
  const [secretVisible, setSecretVisible] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-brand-400/25 bg-brand-500/10 px-3 py-2.5 text-xs leading-relaxed text-mist-300">
        <RadioTower className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
        <span>AirMic 的语音全部经你自己的 LiveKit 服务器中转，不做客户端 P2P，房间人数可支持 50-100+。</span>
      </div>

      <div className="space-y-3 rounded-xl border border-white/10 bg-ink-900/40 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-mist-200">LiveKit 语音中转</p>
          <span className="text-[10px] text-mist-500">可选，稍后也可在管理后台配置</span>
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
              <button
                type="button"
                onClick={() => setSecretVisible((value) => !value)}
                className="rounded-lg p-1.5 text-mist-400 transition-colors hover:bg-white/5 hover:text-mist-100"
                aria-label={secretVisible ? "隐藏 API Secret" : "显示 API Secret"}
              >
                {secretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
            onChange={(event) => update({ livekitApiSecret: event.target.value })}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-mist-500">需要自行部署 LiveKit，详见部署文档；也可稍后在管理后台配置。三项配置齐全后房间内语音才可用。</p>
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
        <div className="flex flex-col justify-center rounded-xl border border-white/10 bg-ink-900/40 px-3 py-2.5">
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
        <p className="mb-2 text-xs font-medium text-mist-300">默认音质预设</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((preset) => {
            const active = form.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                onClick={() => update({ preset: preset.id as SetupPresetId })}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  active ? "border-brand-400/60 bg-brand-500/10" : "border-white/10 bg-ink-900/60 hover:border-white/25 hover:bg-ink-900",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-mist-100">{preset.label}</span>
                  <span className={cn("h-2 w-2 rounded-full", active ? "bg-brand-400" : "bg-white/10")} />
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-mist-500">{preset.description}</span>
                <span className="mt-1.5 block font-mono text-[10px] text-mist-400">
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

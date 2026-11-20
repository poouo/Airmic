import { AUDIO_LIMITS, AUDIO_PRESET_LIST, audioSummary, deriveAudioPreset, formatBitrate, presetSettings } from "@airmic/shared";
import type { AudioPresetId, AudioSettings } from "@airmic/shared";
import { Check, Headphones } from "lucide-react";
import { Select, Slider, Switch } from "@/components/ui";
import { cn } from "@/lib/format";

export interface AudioSettingsEditorProps {
  /** 服务器默认音质（跟随默认时展示与作为基准） */
  base: AudioSettings;
  /** 当前完整音质参数 */
  value: AudioSettings;
  onChange: (next: AudioSettings) => void;
  /** 传入时展示“跟随服务器默认”开关（房间表单使用） */
  followDefault?: boolean;
  onFollowDefaultChange?: (follow: boolean) => void;
  disabled?: boolean;
}

const sampleRateOptions = AUDIO_LIMITS.sampleRates.map((rate) => ({ value: String(rate), label: rate / 1000 + " kHz" }));
const channelOptions = [
  { value: "1", label: "单声道（语音推荐）" },
  { value: "2", label: "立体声（音乐/共享）" },
];

function summarize(settings: AudioSettings): string {
  return audioSummary(settings) + " · " + (settings.dtx ? "DTX 开" : "DTX 关") + " · " + (settings.fec ? "FEC 开" : "FEC 关");
}

export default function AudioSettingsEditor({
  base,
  value,
  onChange,
  followDefault,
  onFollowDefaultChange,
  disabled = false,
}: AudioSettingsEditorProps) {
  const follow = followDefault ?? false;
  const locked = disabled || follow;
  const activePreset = deriveAudioPreset(value);

  const update = (patch: Partial<AudioSettings>) => {
    const next: AudioSettings = { ...value, ...patch };
    next.preset = deriveAudioPreset(next);
    onChange(next);
  };

  const applyPreset = (id: AudioPresetId) => {
    onChange(presetSettings(id));
  };

  return (
    <div className="space-y-4">
      {onFollowDefaultChange && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-900/50 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm text-mist-100">跟随服务器默认音质</p>
            <p className="text-xs text-mist-500">关闭后可单独调整该房间的编码与音频处理参数</p>
          </div>
          <Switch checked={follow} onChange={onFollowDefaultChange} disabled={disabled} />
        </div>
      )}

      {follow ? (
        <div className="rounded-xl border border-brand-400/20 bg-brand-500/5 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-brand-300">
            <Headphones className="h-3.5 w-3.5" />
            当前跟随服务器默认音质
          </p>
          <p className="mt-1 font-mono text-[11px] text-mist-400">{summarize(base)}</p>
        </div>
      ) : (
        <>
          <div>
            <p className="mb-2 text-xs font-medium text-mist-300">音质预设</p>
            <div className={cn("grid gap-2 sm:grid-cols-2", locked && "pointer-events-none opacity-60")}>
              {AUDIO_PRESET_LIST.filter((preset) => preset.id !== "custom").map((preset) => {
                const active = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    disabled={locked}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-brand-400/60 bg-brand-500/10"
                        : "border-white/10 bg-ink-900/60 hover:border-brand-400/40 hover:bg-ink-800",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-mist-100">{preset.label}</span>
                      {active && <Check className="h-3.5 w-3.5 text-brand-300" />}
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-mist-500">{preset.description}</span>
                    <span className="mt-1.5 block font-mono text-[10px] text-mist-400">
                      {formatBitrate(preset.settings.bitrate)} · {preset.settings.sampleRate / 1000} kHz ·{" "}
                      {preset.settings.channels === 2 ? "立体声" : "单声道"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={cn("space-y-4 rounded-xl border border-white/10 bg-ink-900/40 p-3.5", locked && "pointer-events-none opacity-60")}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-mist-300">自定义参数</p>
              <span className="font-mono text-[10px] text-mist-500">{activePreset === "custom" ? "自定义" : "基于预设微调"}</span>
            </div>
            <Slider
              label="目标码率"
              value={value.bitrate}
              min={AUDIO_LIMITS.minBitrate}
              max={AUDIO_LIMITS.maxBitrate}
              step={AUDIO_LIMITS.bitrateStep}
              disabled={locked}
              formatValue={(bitrate) => Math.round(bitrate / 1000) + " kbps"}
              onChange={(bitrate) => update({ bitrate })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="采样率"
                options={sampleRateOptions}
                value={String(value.sampleRate)}
                disabled={locked}
                onChange={(event) => update({ sampleRate: Number(event.target.value) })}
              />
              <Select
                label="声道"
                options={channelOptions}
                value={String(value.channels)}
                disabled={locked}
                onChange={(event) => update({ channels: event.target.value === "2" ? 2 : 1 })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Switch
                label="DTX 静音省流"
                description="不讲话时不发送音频包"
                checked={value.dtx}
                disabled={locked}
                onChange={(dtx) => update({ dtx })}
              />
              <Switch
                label="FEC 前向纠错"
                description="丢包时提升可听性"
                checked={value.fec}
                disabled={locked}
                onChange={(fec) => update({ fec })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Switch
                label="回声消除"
                description="外放时抑制回声"
                checked={value.echoCancellation}
                disabled={locked}
                onChange={(echoCancellation) => update({ echoCancellation })}
              />
              <Switch
                label="噪声抑制"
                description="过滤键盘/风扇等底噪"
                checked={value.noiseSuppression}
                disabled={locked}
                onChange={(noiseSuppression) => update({ noiseSuppression })}
              />
              <Switch
                label="自动增益"
                description="自动稳定麦克风音量"
                checked={value.autoGainControl}
                disabled={locked}
                onChange={(autoGainControl) => update({ autoGainControl })}
              />
            </div>
            <p className="border-t border-white/5 pt-2.5 font-mono text-[10px] text-mist-500">{summarize(value)}</p>
          </div>
        </>
      )}
    </div>
  );
}

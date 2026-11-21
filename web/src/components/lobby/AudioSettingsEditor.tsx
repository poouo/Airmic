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
        <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-2.5">
          <Switch label="跟随服务器默认" checked={follow} onChange={onFollowDefaultChange} disabled={disabled} />
        </div>
      )}

      {follow ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Headphones className="h-3.5 w-3.5 text-brand" />
            当前音质
          </p>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">{summarize(base)}</p>
        </div>
      ) : (
        <>
          <div>
            <p className="mb-2 text-xs font-medium text-foreground/80">音质预设</p>
            <div className={cn("grid gap-2 sm:grid-cols-2", locked && "pointer-events-none opacity-60")}>
              {AUDIO_PRESET_LIST.filter((preset) => preset.id !== "custom").map((preset) => {
                const active = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    aria-pressed={active}
                    disabled={locked}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      active ? "border-primary/50 bg-accent" : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/40",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">{preset.label}</span>
                      {active && <Check className="h-3.5 w-3.5 text-foreground" />}
                    </span>
                    <span className="mt-1.5 block font-mono text-[10px] text-muted-foreground/80">
                      {formatBitrate(preset.settings.bitrate)} · {preset.settings.sampleRate / 1000} kHz ·{" "}
                      {preset.settings.channels === 2 ? "立体声" : "单声道"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <details className={cn("rounded-xl border border-border bg-muted/20 px-3", locked && "pointer-events-none opacity-60")}>
            <summary className="cursor-pointer py-3 text-sm font-medium">高级音质参数</summary>
            <div className="space-y-4 pb-3">
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
                <Switch label="DTX 静音省流" description="不讲话时不发送音频包" checked={value.dtx} disabled={locked} onChange={(dtx) => update({ dtx })} />
                <Switch label="FEC 前向纠错" description="丢包时提升可听性" checked={value.fec} disabled={locked} onChange={(fec) => update({ fec })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Switch label="回声消除" description="外放时抑制回声" checked={value.echoCancellation} disabled={locked} onChange={(echoCancellation) => update({ echoCancellation })} />
                <Switch label="噪声抑制" description="过滤键盘/风扇等底噪" checked={value.noiseSuppression} disabled={locked} onChange={(noiseSuppression) => update({ noiseSuppression })} />
                <Switch label="自动增益" description="自动稳定麦克风音量" checked={value.autoGainControl} disabled={locked} onChange={(autoGainControl) => update({ autoGainControl })} />
              </div>
              <p className="border-t border-border pt-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">{summarize(value)}</p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

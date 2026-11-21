import { useEffect, useState } from "react";
import { Check, Keyboard, Mic, RefreshCw } from "lucide-react";
import type { AudioSettings } from "@airmic/shared";
import { Button, Divider, Kbd, SectionTitle, Select, Slider, Switch } from "@/components/ui";
import { LevelMeter } from "@/components/room/LevelMeter";
import { cn, prettyKey } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings";
import { describeMicrophoneError } from "@/voice/sdp";
import { voice } from "@/voice/engine";
import { updateLocalAudioOverride, useEffectiveAudioSettings } from "./audioPrefs";
import { deviceLabel, useAudioDevices } from "./useAudioDevices";

type ProcessingKey = "noiseSuppression" | "echoCancellation" | "autoGainControl";

const PROCESSING_OPTIONS: { key: ProcessingKey; label: string; description: string }[] = [
  { key: "noiseSuppression", label: "噪声抑制", description: "过滤键盘声、风扇声等背景噪音" },
  { key: "echoCancellation", label: "回声消除", description: "消除扬声器外放产生的回音" },
  { key: "autoGainControl", label: "自动增益", description: "自动稳定说话音量，避免忽大忽小" },
];

/** 麦克风设置：设备选择、实时电平测试、处理开关、PTT 与 VAD */
export function MicrophoneTab() {
  const { inputs, refresh } = useAudioDevices();
  const inputDeviceId = useSettingsStore((state) => state.inputDeviceId);
  const pttEnabled = useSettingsStore((state) => state.pttEnabled);
  const pttKey = useSettingsStore((state) => state.pttKey);
  const vadThreshold = useSettingsStore((state) => state.vadThreshold);
  const effective = useEffectiveAudioSettings();
  const [listeningKey, setListeningKey] = useState(false);

  const handleSelectDevice = (value: string) => {
    useSettingsStore.getState().update({ inputDeviceId: value ? value : null });
    void voice.switchInputDevice(value);
  };

  const handleProcessing = (key: ProcessingKey, value: boolean) => {
    const patch: Partial<AudioSettings> = {};
    patch[key] = value;
    updateLocalAudioOverride(patch);
  };

  useEffect(() => {
    if (!listeningKey) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setListeningKey(false);
        return;
      }
      if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code)) return;
      useSettingsStore.getState().update({ pttKey: event.code });
      setListeningKey(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [listeningKey]);

  const inputOptions = [
    { value: "", label: "系统默认麦克风" },
    ...inputs.map((device, index) => ({
      value: device.deviceId,
      label: deviceLabel(device, "麦克风 " + (index + 1)),
    })),
  ];

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionTitle
          action={
            <Button
              variant="ghost"
              size="sm"
              className="-mr-1"
              onClick={() => void refresh()}
              icon={<RefreshCw className="h-3 w-3" />}
            >
              刷新设备
            </Button>
          }
        >
          输入设备
        </SectionTitle>
        <Select
          label="麦克风"
          options={inputOptions}
          value={inputDeviceId ?? ""}
          onChange={(event) => handleSelectDevice(event.target.value)}
        />
        <MicTestPanel deviceId={inputDeviceId} />
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>音频处理</SectionTitle>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {PROCESSING_OPTIONS.map((option) => (
            <div key={option.key} className="px-3.5 py-3">
              <Switch
                checked={effective[option.key]}
                onChange={(checked) => handleProcessing(option.key, checked)}
                label={option.label}
                description={option.description}
              />
            </div>
          ))}
        </div>
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>按键说话（PTT）</SectionTitle>
        <Switch
          checked={pttEnabled}
          onChange={(checked) => {
            useSettingsStore.getState().update({ pttEnabled: checked });
            if (!checked) voice.setPTTActive(false);
          }}
          label="启用按键说话"
          description="按住快捷键发言"
        />
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
          <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">当前按键</span>
          <Kbd>{prettyKey(pttKey)}</Kbd>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => setListeningKey((listening) => !listening)}
            icon={listeningKey ? <Check className="h-3.5 w-3.5" /> : <Keyboard className="h-3.5 w-3.5" />}
          >
            {listeningKey ? "按下快捷键…" : "更改按键"}
          </Button>
        </div>
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>说话检测灵敏度</SectionTitle>
        <Slider
          label="VAD 阈值"
          value={vadThreshold}
          min={0.02}
          max={0.4}
          step={0.01}
          onChange={(value) => useSettingsStore.getState().update({ vadThreshold: value })}
          formatValue={(value) => Math.round(value * 100) + "%"}
        />
      </section>
    </div>
  );
}

function MicTestPanel({ deviceId }: { deviceId: string | null }) {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let timer: number | null = null;

    const start = async () => {
      try {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
          throw new Error("当前环境不支持麦克风采集");
        }
        const constraints: MediaStreamConstraints = {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false,
        };
        stream = await mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stopTracks(stream);
          return;
        }
        const contextCtor = window.AudioContext;
        context = new contextCtor();
        await context.resume().catch(() => undefined);
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        const silent = context.createGain();
        silent.gain.value = 0;
        source.connect(analyser);
        analyser.connect(silent);
        silent.connect(context.destination);
        const data = new Float32Array(analyser.fftSize);
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (let index = 0; index < data.length; index += 1) {
            const value = data[index];
            sum += value * value;
          }
          const rms = Math.sqrt(sum / data.length);
          setLevel(Math.min(1, rms * 3.5));
        }, 100);
      } catch (failure) {
        if (cancelled) return;
        setError(describeMicrophoneError(failure).message);
        setActive(false);
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      if (stream) stopTracks(stream);
      if (context) void context.close().catch(() => undefined);
    };
  }, [active, deviceId]);

  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-muted/30 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
            )}
          >
            <Mic className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">麦克风测试</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {active ? "正在采集，对着麦克风说话试试" : "开始测试后可实时查看输入电平"}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={active ? "danger" : "secondary"}
          onClick={() => {
            setError(null);
            setActive((value) => !value);
          }}
        >
          {active ? "停止测试" : "开始测试"}
        </Button>
      </div>
      <LevelMeter level={level} active={active} barCount={24} className="h-3" />
      {error && <p className="text-xs leading-relaxed text-destructive">{error}</p>}
    </div>
  );
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

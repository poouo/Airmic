import { useState } from "react";
import { Headphones, Play, RefreshCw } from "lucide-react";
import { Button, Divider, SectionTitle, Select, Slider } from "@/components/ui";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { MASTER_VOLUME_KEY, voice } from "@/voice/engine";
import { deviceLabel, useAudioDevices } from "./useAudioDevices";

/** 扬声器设置：输出设备、全体音量与测试音 */
export function SpeakerTab() {
  const { outputs, refresh } = useAudioDevices();
  const outputDeviceId = useSettingsStore((state) => state.outputDeviceId);
  const master = useSettingsStore((state) => state.perUserVolume?.[MASTER_VOLUME_KEY] ?? 100);
  const [testing, setTesting] = useState(false);
  const outputSupported = voice.isOutputDeviceSupported();

  const handleSelectDevice = (value: string) => {
    useSettingsStore.getState().update({ outputDeviceId: value ? value : null });
    voice.setOutputDevice(value);
  };

  const handleMasterVolume = (value: number) => {
    const store = useSettingsStore.getState();
    store.update({ perUserVolume: { ...store.perUserVolume, [MASTER_VOLUME_KEY]: value } });
    voice.setMasterVolume(value);
  };

  const playTest = async () => {
    setTesting(true);
    try {
      const played = await voice.playTestSound();
      if (!played) {
        useUiStore.getState().toast("无法播放测试音，请确认浏览器允许播放声音后重试", "warning");
      }
    } finally {
      setTesting(false);
    }
  };

  const outputOptions = [
    { value: "", label: outputSupported ? "系统默认输出" : "系统默认输出（浏览器不支持切换）" },
    ...outputs.map((device, index) => ({
      value: device.deviceId,
      label: deviceLabel(device, "扬声器 " + (index + 1)),
      disabled: !outputSupported,
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
          输出设备
        </SectionTitle>
        <Select
          label="扬声器 / 耳机"
          hint={outputSupported ? undefined : "请在系统设置中选择输出设备"}
          options={outputOptions}
          value={outputDeviceId ?? ""}
          disabled={!outputSupported}
          onChange={(event) => handleSelectDevice(event.target.value)}
        />
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>音量</SectionTitle>
        <div className="rounded-xl border border-border bg-card px-3.5 py-3">
          <Slider
            label="主音量"
            value={master}
            min={0}
            max={200}
            step={5}
            onChange={handleMasterVolume}
            formatValue={(value) => value + "%"}
          />
        </div>
        {master === 0 && <p className="text-xs text-warning">主音量为 0</p>}
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>测试</SectionTitle>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Headphones className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">播放测试音</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" loading={testing} onClick={() => void playTest()} icon={<Play className="h-3.5 w-3.5" />}>
            播放
          </Button>
        </div>
      </section>
    </div>
  );
}

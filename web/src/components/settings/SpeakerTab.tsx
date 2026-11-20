import { useState } from "react";
import { Headphones, Play, RefreshCw, Volume2 } from "lucide-react";
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
            <button
              type="button"
              onClick={() => void refresh()}
              className="flex items-center gap-1 text-[11px] text-mist-400 transition-colors hover:text-mist-200"
            >
              <RefreshCw className="h-3 w-3" /> 刷新设备
            </button>
          }
        >
          输出设备
        </SectionTitle>
        <Select
          label="扬声器 / 耳机"
          hint={
            outputSupported
              ? "切换后立即生效，对所有队友的声音生效"
              : "当前浏览器不支持选择输出设备（Chrome 110+ 支持），可在系统设置中切换默认设备"
          }
          options={outputOptions}
          value={outputDeviceId ?? ""}
          disabled={!outputSupported}
          onChange={(event) => handleSelectDevice(event.target.value)}
        />
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>音量</SectionTitle>
        <Slider
          label="全体音量"
          value={master}
          min={0}
          max={200}
          step={5}
          onChange={handleMasterVolume}
          formatValue={(value) => value + "%"}
        />
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-mist-500">
          <Volume2 className="mt-0.5 h-3 w-3 shrink-0" />
          全体音量会叠加在每个成员独立的本地音量之上；在房间成员卡片上可以为单个队友单独调节或本地静音。
          {master === 0 && <span className="text-warn-400">（当前全体音量为 0，你将听不到任何声音）</span>}
        </p>
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>测试</SectionTitle>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-900/60 px-3 py-3 ring-1 ring-white/5">
          <div className="flex items-center gap-2">
            <Headphones className="h-4 w-4 text-mist-400" />
            <div>
              <p className="text-xs text-mist-200">播放测试音</p>
              <p className="text-[11px] text-mist-500">会通过当前选择的输出设备播放一声短促提示音</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" loading={testing} onClick={() => void playTest()} icon={<Play className="h-3.5 w-3.5" />}>
            播放
          </Button>
        </div>
        <p className="text-[11px] text-mist-500">
          如果听不到声音：请检查系统音量、浏览器标签页是否静音，以及是否开启了"耳聋"（耳聋会静音所有成员声音）。
        </p>
      </section>
    </div>
  );
}

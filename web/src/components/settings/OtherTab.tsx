import { Bell, Info, RotateCcw } from "lucide-react";
import { APP_VERSION } from "@airmic/shared";
import { Button, Divider, SectionTitle, Switch } from "@/components/ui";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { voice } from "@/voice/engine";

/** 其他设置：提示音、清除本地设置、关于 */
export function OtherTab() {
  const soundsEnabled = useSettingsStore((state) => state.soundsEnabled);

  const resetSettings = async () => {
    const confirmed = await useUiStore.getState().confirm({
      title: "清除本地设置",
      message: "将清除设备选择、PTT 按键、音量、音质覆盖等本机偏好，不会影响服务器或房间设置。",
      confirmText: "清除设置",
      danger: true,
    });
    if (!confirmed) return;
    useSettingsStore.getState().reset();
    await voice.refreshFromPreferences();
    useUiStore.getState().toast("本地设置已恢复默认", "success");
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionTitle>提示音</SectionTitle>
        <Switch
          checked={soundsEnabled}
          onChange={(checked) => useSettingsStore.getState().update({ soundsEnabled: checked })}
          label="启用界面提示音"
          description="有人加入/离开房间时播放轻柔提示音（关闭后不影响语音通话）"
        />
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-mist-500">
          <Bell className="mt-0.5 h-3 w-3 shrink-0" />
          提示音只在本机播放，不会传给房间里的其他成员。
        </p>
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>本地数据</SectionTitle>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-900/60 px-3 py-3 ring-1 ring-white/5">
          <div>
            <p className="text-xs text-mist-200">清除本地设置</p>
            <p className="text-[11px] text-mist-500">恢复设备、音量、音质覆盖等本机偏好为默认值</p>
          </div>
          <Button size="sm" variant="danger" onClick={() => void resetSettings()} icon={<RotateCcw className="h-3.5 w-3.5" />}>
            清除
          </Button>
        </div>
      </section>

      <Divider />

      <section className="space-y-2">
        <SectionTitle>关于</SectionTitle>
        <div className="space-y-1 rounded-xl bg-ink-900/60 px-3 py-3 text-[11px] leading-relaxed text-mist-500 ring-1 ring-white/5">
          <p className="flex items-center gap-1.5 text-mist-300">
            <Info className="h-3 w-3" /> AirMic v{APP_VERSION}
          </p>
          <p>网页版语音开黑平台：WebRTC Mesh 点对点通话，服务端只负责信令与状态同步。</p>
          <p>隐私提示：语音数据只在浏览器之间传输，不经过服务器（除非启用 TURN 中继）。</p>
        </div>
      </section>
    </div>
  );
}

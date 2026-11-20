import { Bell, Info, RotateCcw } from "lucide-react";
import { APP_VERSION } from "@airmic/shared";
import { Button, Divider, SectionTitle, Switch } from "@/components/ui";
import ThemeToggle from "@/components/layout/ThemeToggle";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { useUiStore } from "@/stores/ui";
import { voice } from "@/voice/engine";

/** 其他设置：提示音、清除本地设置、关于 */
export function OtherTab() {
  const soundsEnabled = useSettingsStore((state) => state.soundsEnabled);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

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
        <SectionTitle action={<ThemeToggle />}>外观</SectionTitle>
        <Switch
          checked={theme === "dark"}
          onChange={(dark) => setTheme(dark ? "dark" : "light")}
          label="夜间模式"
          description="关闭时使用默认的白天模式，偏好保存在本机浏览器，可随时切换"
        />
        <p className="text-xs text-muted-foreground">当前：{theme === "dark" ? "夜间模式" : "白天模式"}</p>
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>提示音</SectionTitle>
        <Switch
          checked={soundsEnabled}
          onChange={(checked) => useSettingsStore.getState().update({ soundsEnabled: checked })}
          label="启用界面提示音"
          description="有人加入/离开房间时播放轻柔提示音（关闭后不影响语音通话）"
        />
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          提示音只在本机播放，不会传给房间里的其他成员。
        </p>
      </section>

      <Divider />

      <section className="space-y-3">
        <SectionTitle>本地数据</SectionTitle>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">清除本地设置</p>
            <p className="text-xs leading-relaxed text-muted-foreground">恢复设备、音量、音质覆盖等本机偏好为默认值</p>
          </div>
          <Button size="sm" variant="danger" onClick={() => void resetSettings()} icon={<RotateCcw className="h-3.5 w-3.5" />}>
            清除
          </Button>
        </div>
      </section>

      <Divider />

      <section className="space-y-2">
        <SectionTitle>关于</SectionTitle>
        <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground/85">
            <Info className="h-3.5 w-3.5" /> AirMic v{APP_VERSION}
          </p>
          <p>网页版语音开黑平台：语音经自建 LiveKit SFU 服务器中转，客户端之间不建立 P2P 连接。</p>
          <p>隐私提示：语音数据经服务器转发（SFU），不做浏览器点对点传输。</p>
        </div>
      </section>
    </div>
  );
}

import { RotateCcw } from "lucide-react";
import { APP_VERSION } from "@airmic/shared";
import { Button, Switch } from "@/components/ui";
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
      title: "重置本机设置？",
      message: "设备、音量和快捷键将恢复默认。",
      confirmText: "重置",
      danger: true,
    });
    if (!confirmed) return;
    useSettingsStore.getState().reset();
    await voice.refreshFromPreferences();
    useUiStore.getState().toast("已恢复默认设置", "success");
  };

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-xl border border-border px-3 [&>label]:min-h-12 [&>label]:py-2">
        <Switch
          checked={theme === "dark"}
          onChange={(dark) => setTheme(dark ? "dark" : "light")}
          label="夜间模式"
        />
        <Switch
          checked={soundsEnabled}
          onChange={(checked) => useSettingsStore.getState().update({ soundsEnabled: checked })}
          label="进出房间提示音"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">AirMic v{APP_VERSION}</span>
        <Button variant="outline" onClick={() => void resetSettings()} icon={<RotateCcw className="h-4 w-4" />}>重置本机设置</Button>
      </div>
    </div>
  );
}

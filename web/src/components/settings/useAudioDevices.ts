import { useCallback, useEffect, useState } from "react";

export interface AudioDeviceLists {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

/** 枚举本机音频输入/输出设备，并在设备插拔时自动刷新 */
export function useAudioDevices(): AudioDeviceLists & { refresh: () => Promise<void> } {
  const [lists, setLists] = useState<AudioDeviceLists>({ inputs: [], outputs: [] });

  const refresh = useCallback(async () => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.enumerateDevices !== "function") return;
    try {
      const devices = await mediaDevices.enumerateDevices();
      setLists({
        inputs: devices.filter((device) => device.kind === "audioinput"),
        outputs: devices.filter((device) => device.kind === "audiooutput"),
      });
    } catch {
      /* 权限或环境不支持时忽略 */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    const handleChange = () => void refresh();
    mediaDevices.addEventListener("devicechange", handleChange);
    return () => mediaDevices.removeEventListener("devicechange", handleChange);
  }, [refresh]);

  return { ...lists, refresh };
}

export function deviceLabel(device: MediaDeviceInfo, fallback: string): string {
  const label = device.label.trim();
  return label.length > 0 ? label : fallback;
}

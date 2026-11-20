import { useMemo } from "react";
import { DEFAULT_AUDIO_SETTINGS, mergeAudioSettings } from "@airmic/shared";
import type { AudioOverride, AudioSettings } from "@airmic/shared";
import { useAppStore } from "@/stores/app";
import { useRoomStore } from "@/stores/room";
import { useSettingsStore } from "@/stores/settings";
import { voice } from "@/voice/engine";

/** 房间生效音质（不含本机覆盖）；不在房间时使用服务器默认音质 */
export function useBaseAudioSettings(): AudioSettings {
  const roomAudio = useRoomStore((state) => state.snapshot?.room.audioSettings ?? null);
  const serverDefault = useAppStore((state) => state.server?.defaultAudioSettings ?? DEFAULT_AUDIO_SETTINGS);
  return useMemo(() => mergeAudioSettings(roomAudio ?? serverDefault, null), [roomAudio, serverDefault]);
}

/** 当前生效音质：房间音质（不在房间时为服务器默认）叠加本机覆盖 */
export function useEffectiveAudioSettings(): AudioSettings {
  const base = useBaseAudioSettings();
  const override = useSettingsStore((state) => state.localAudioOverride);
  return useMemo(() => mergeAudioSettings(base, override), [base, override]);
}

/** 更新本机音质覆盖并让语音引擎立即生效；patch 为 null 时恢复跟随房间 */
export function updateLocalAudioOverride(patch: Partial<AudioSettings> | null): void {
  const store = useSettingsStore.getState();
  if (patch === null) {
    store.update({ localAudioOverride: null });
  } else {
    const current: AudioOverride = store.localAudioOverride ?? {};
    store.update({ localAudioOverride: { ...current, ...patch } });
  }
  void voice.refreshFromPreferences();
}

/** 整体替换本机音质覆盖（用于省流模式等互斥选项） */
export function replaceLocalAudioOverride(override: AudioOverride | null): void {
  useSettingsStore.getState().update({ localAudioOverride: override });
  void voice.refreshFromPreferences();
}

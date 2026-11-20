import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AudioOverride } from "@airmic/shared";

export interface UserPreferences {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  pttEnabled: boolean;
  pttKey: string;
  soundsEnabled: boolean;
  vadThreshold: number;
  perUserVolume: Record<string, number>;
  localAudioOverride: AudioOverride | null;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  inputDeviceId: null,
  outputDeviceId: null,
  pttEnabled: false,
  pttKey: "KeyV",
  soundsEnabled: true,
  vadThreshold: 0.08,
  perUserVolume: {},
  localAudioOverride: null,
};

interface SettingsState extends UserPreferences {
  update: (patch: Partial<UserPreferences>) => void;
  setUserVolume: (userId: number, volume: number) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_PREFERENCES,
      update(patch) {
        set(patch);
      },
      setUserVolume(userId, volume) {
        set({ perUserVolume: { ...get().perUserVolume, [String(userId)]: Math.round(volume) } });
      },
      reset() {
        set({ ...DEFAULT_PREFERENCES });
      },
    }),
    {
      name: "airmic.prefs",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function volumeFor(userId: number): number {
  const value = useSettingsStore.getState().perUserVolume[String(userId)];
  return typeof value === "number" ? value : 100;
}

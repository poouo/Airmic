/** 房间成员进出提示音（本机播放，不影响语音通话） */
let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  try {
    if (!context || context.state === "closed") {
      context = new AudioContext();
    }
    return context;
  } catch {
    return null;
  }
}

async function playSequence(frequencies: number[], spacing: number): Promise<void> {
  const audioContext = ensureContext();
  if (!audioContext) return;
  if (audioContext.state === "suspended") {
    try {
      await Promise.race([
        audioContext.resume().catch(() => undefined),
        new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
      ]);
    } catch {
      return;
    }
  }
  if (audioContext.state !== "running") return;
  const start = audioContext.currentTime;
  frequencies.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const at = start + index * spacing;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.045, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + spacing * 0.9);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(at);
    oscillator.stop(at + spacing);
    oscillator.addEventListener("ended", () => {
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
    });
  });
}

/** 有人加入房间 */
export function playJoinSound(): void {
  void playSequence([520, 700], 0.075).catch(() => undefined);
}

/** 有人离开房间 */
export function playLeaveSound(): void {
  void playSequence([500, 340], 0.085).catch(() => undefined);
}

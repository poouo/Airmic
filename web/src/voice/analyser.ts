/**
 * 本地麦克风电平分析（自建 AnalyserNode，时域 RMS 与旧版 VAD 阈值语义保持一致）。
 * 只在麦克风发布期间存在，静音/离开时销毁，避免额外占用音频设备。
 */
export class LocalLevelAnalyser {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sink: GainNode | null = null;
  private data: Float32Array<ArrayBuffer> | null = null;
  private closed = false;

  /** 从麦克风轨道建立分析链路；传 null 时等价于 cleanup */
  start(track: MediaStreamTrack | null): void {
    this.cleanup();
    if (!track) return;
    const AudioContextCtor = window.AudioContext;
    if (typeof AudioContextCtor !== "function") return;
    let context: AudioContext;
    try {
      context = new AudioContextCtor({ latencyHint: "interactive" });
    } catch {
      return;
    }
    try {
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      // 用 0 增益接到输出，保证音频图被驱动、但不产生回放
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(analyser);
      analyser.connect(sink);
      sink.connect(context.destination);
      this.context = context;
      this.source = source;
      this.analyser = analyser;
      this.sink = sink;
      this.data = new Float32Array(analyser.fftSize);
      this.closed = false;
      void context.resume().catch(() => undefined);
    } catch {
      void context.close().catch(() => undefined);
    }
  }

  /** 当前 RMS（0-1） */
  sampleRaw(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getFloatTimeDomainData(this.data);
    let sum = 0;
    for (let index = 0; index < this.data.length; index += 1) {
      const value = this.data[index];
      sum += value * value;
    }
    return Math.sqrt(sum / this.data.length);
  }

  /** 用户手势后尝试恢复音频上下文（自动播放策略可能挂起分析） */
  async resume(): Promise<void> {
    const context = this.context;
    if (!context || context.state === "running" || context.state === "closed") return;
    try {
      await Promise.race([
        context.resume().catch(() => undefined),
        new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
      ]);
    } catch {
      /* ignore */
    }
  }

  /** 释放资源（幂等） */
  cleanup(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.source?.disconnect();
      this.analyser?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* ignore */
    }
    const context = this.context;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.sink = null;
    this.data = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }
}

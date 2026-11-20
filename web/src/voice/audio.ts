/**
 * 语音播放/分析音频图。
 *
 * - 每个远端成员一条 源 -> 分析器 -> 每用户 GainNode -> 主音量 -> 输出 的链路；
 * - 本地麦克风只接分析器（经过 0 增益）用于说话检测，不会回放；
 * - 远端的每用户音量与全局音量都由 GainNode 控制，耳聋时主音量为 0；
 * - 浏览器自动播放策略拦截时 context.state === "suspended"，由引擎提示"点击启用声音"。
 */

interface RemoteAudioNode {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  gain: GainNode;
  data: Float32Array<ArrayBuffer>;
}

interface SinkCapableAudioContext extends AudioContext {
  setSinkId?: (sinkId: string) => Promise<void>;
}

const LOCAL_ANALYSER_FFT = 512;
const REMOTE_ANALYSER_FFT = 256;
const LEVEL_CURVE = 3.5;

export class VoiceAudioGraph {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localSink: GainNode | null = null;
  private localData: Float32Array<ArrayBuffer> | null = null;
  private remoteNodes = new Map<number, RemoteAudioNode>();
  private deafened = false;
  private masterPercent = 100;
  private outputDeviceId: string | null = null;
  private checkedBlocked = false;
  private blocked = false;
  private closed = false;

  /** 上下文从 suspended 恢复/再次被挂起时回调（用于更新 audioBlocked 状态） */
  onBlockedChange: ((blocked: boolean) => void) | null = null;

  /** 创建（或复用）AudioContext；浏览器不支持时返回 null */
  private ensureContext(): AudioContext | null {
    if (this.closed) return null;
    if (this.context) return this.context;
    const AudioContextCtor = window.AudioContext;
    if (typeof AudioContextCtor !== "function") return null;
    let context: AudioContext;
    try {
      context = new AudioContextCtor({ latencyHint: "interactive" });
    } catch {
      return null;
    }
    this.context = context;
    const master = context.createGain();
    master.gain.value = this.deafened ? 0 : this.masterPercent / 100;
    master.connect(context.destination);
    this.master = master;
    context.onstatechange = () => this.publishBlockedState();
    void this.applyOutputDevice();
    return context;
  }

  /** 尝试恢复音频输出；返回是否处于 running 状态 */
  async unlock(): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;
    if (context.state === "closed") return false;
    this.checkedBlocked = true;
    if (context.state !== "running") {
      try {
        const resume = context.resume().catch(() => undefined);
        await Promise.race([resume, delay(600)]);
      } catch {
        /* 自动播放策略会拒绝在用户手势外恢复 */
      }
    }
    this.blocked = context.state !== "running";
    this.onBlockedChange?.(this.blocked);
    return !this.blocked;
  }

  get isBlocked(): boolean {
    return this.blocked;
  }

  supportsOutputSelection(): boolean {
    const context = this.ensureContext();
    return context !== null && typeof (context as SinkCapableAudioContext).setSinkId === "function";
  }

  /** 设置输出设备（浏览器支持 AudioContext.setSinkId 时生效） */
  setOutputDevice(deviceId: string | null): void {
    this.outputDeviceId = deviceId;
    void this.applyOutputDevice();
  }

  async applyOutputDevice(): Promise<void> {
    const context: SinkCapableAudioContext | null = this.context as SinkCapableAudioContext | null;
    if (!context || typeof context.setSinkId !== "function") return;
    try {
      await context.setSinkId(this.outputDeviceId ?? "");
    } catch {
      /* 浏览器/系统不支持指定输出设备时忽略，继续使用默认设备 */
    }
  }

  setMasterVolume(percent: number): void {
    const clamped = Math.min(200, Math.max(0, percent));
    this.masterPercent = clamped;
    if (this.master) this.master.gain.value = this.deafened ? 0 : clamped / 100;
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    if (this.master) this.master.gain.value = deafened ? 0 : this.masterPercent / 100;
  }

  /** 挂载本地麦克风流用于电平分析（不播放） */
  setLocalStream(stream: MediaStream | null): void {
    this.detachLocal();
    if (!stream || stream.getAudioTracks().length === 0) return;
    const context = this.ensureContext();
    if (!context) return;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = LOCAL_ANALYSER_FFT;
    analyser.smoothingTimeConstant = 0.4;
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(analyser);
    analyser.connect(sink);
    sink.connect(this.master ?? context.destination);
    this.localSource = source;
    this.localAnalyser = analyser;
    this.localSink = sink;
    this.localData = new Float32Array(analyser.fftSize);
  }

  /** 返回本地麦克风的 RMS 原始值（0-1，未做 UI 放大） */
  sampleLocalRaw(): number {
    if (!this.localAnalyser || !this.localData) return 0;
    this.localAnalyser.getFloatTimeDomainData(this.localData);
    return rms(this.localData);
  }

  /** 挂载远端成员音频（通过 GainNode 播放） */
  attachRemote(userId: number, stream: MediaStream): void {
    if (this.closed) return;
    this.detachRemote(userId);
    if (stream.getAudioTracks().length === 0) return;
    const context = this.ensureContext();
    if (!context) return;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = REMOTE_ANALYSER_FFT;
    analyser.smoothingTimeConstant = 0.5;
    const gain = context.createGain();
    gain.gain.value = 1;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(this.master ?? context.destination);
    this.remoteNodes.set(userId, { source, analyser, gain, data: new Float32Array(analyser.fftSize) });
  }

  detachRemote(userId: number): void {
    const node = this.remoteNodes.get(userId);
    if (!node) return;
    this.remoteNodes.delete(userId);
    try {
      node.source.disconnect();
      node.analyser.disconnect();
      node.gain.disconnect();
    } catch {
      /* 已断开 */
    }
  }

  setRemoteVolume(userId: number, percent: number): void {
    const node = this.remoteNodes.get(userId);
    if (!node) return;
    const clamped = Math.min(200, Math.max(0, percent));
    node.gain.gain.value = clamped / 100;
  }

  sampleRemoteRaw(userId: number): number {
    const node = this.remoteNodes.get(userId);
    if (!node) return 0;
    node.analyser.getFloatTimeDomainData(node.data);
    return rms(node.data);
  }

  /** 播放一声短促的测试音（不经过耳聋/主音量，确保设置页能听到） */
  async playTestTone(): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;
    if (context.state !== "running") {
      const unlocked = await this.unlock();
      if (!unlocked) return false;
    }
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.55);
    oscillator.addEventListener("ended", () => {
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
    });
    return true;
  }

  /** 把 RMS 转成 0-1 的 UI 电平 */
  static toUiLevel(raw: number): number {
    return Math.min(1, Math.max(0, raw * LEVEL_CURVE));
  }

  async close(): Promise<void> {
    if (this.closed && !this.context) return;
    this.closed = true;
    this.detachLocal();
    for (const userId of [...this.remoteNodes.keys()]) this.detachRemote(userId);
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        /* ignore */
      }
    }
  }

  private detachLocal(): void {
    try {
      this.localSource?.disconnect();
      this.localAnalyser?.disconnect();
      this.localSink?.disconnect();
    } catch {
      /* ignore */
    }
    this.localSource = null;
    this.localAnalyser = null;
    this.localSink = null;
    this.localData = null;
  }

  private publishBlockedState(): void {
    const context = this.context;
    if (!context || !this.checkedBlocked) return;
    const blocked = context.state !== "running";
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    this.onBlockedChange?.(blocked);
  }
}

function rms(data: Float32Array<ArrayBuffer>): number {
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    sum += value * value;
  }
  return Math.sqrt(sum / data.length);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

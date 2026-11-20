import type { AudioSettings, PeerInfo, RoomSnapshot, SignalPayload } from "@airmic/shared";
import { DEFAULT_AUDIO_SETTINGS, mergeAudioSettings } from "@airmic/shared";
import { socket } from "../lib/ws";
import { useAppStore } from "../stores/app";
import { useAuthStore } from "../stores/auth";
import { useSettingsStore, volumeFor } from "../stores/settings";
import { VoiceAudioGraph } from "./audio";
import { PeerLink } from "./peers";
import { buildMicrophoneConstraints, buildRtcConfiguration, describeMicrophoneError } from "./sdp";
import { INITIAL_VOICE_STATE } from "./types";
import type { PeerNetworkStats, VoiceEventMap, VoiceStateSnapshot } from "./types";

export type { PeerNetworkStats, VoiceEventMap, VoiceQuality, VoiceStateSnapshot } from "./types";
export type { VoiceEventHandler } from "./types";

/** perUserVolume 中保存「全体音量」的保留键（0-200，默认 100） */
export const MASTER_VOLUME_KEY = "master";

/** 读取用户偏好中的全体音量（0-200） */
export function readMasterVolumePercent(): number {
  const volumes = useSettingsStore.getState().perUserVolume;
  const raw = volumes && typeof volumes === "object" ? volumes[MASTER_VOLUME_KEY] : undefined;
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : 100;
  return Math.min(200, Math.max(0, Math.round(value)));
}

type Handler<K extends keyof VoiceEventMap> = (payload: VoiceEventMap[K]) => void;

/** 本地电平采样间隔（约 10 次/秒） */
const LEVEL_INTERVAL_MS = 100;
/** 网络统计间隔 */
const STATS_INTERVAL_MS = 2000;

interface LocalLevelState {
  level: number;
  speaking: boolean;
}

/**
 * WebRTC Mesh 语音引擎。
 *
 * 生命周期（由 src/lib/events.ts 驱动，页面不要重复调用）：
 *  - 加入房间成功（room_joined）后调用 enter(snapshot)：获取麦克风并为每个成员建立连接；
 *  - peer_joined / peer_left 对应 addPeer / removePeer；
 *  - signal 事件调用 handleSignal（内部处理 perfect negotiation 与 trickle ICE）；
 *  - room_updated 时 applyAudioSettings；force_muted 时 applyForceMute；
 *  - 离开房间/断线时 leave()。
 *
 * 音频参数：
 *  - getUserMedia 约束来自 audioConstraints（房间生效音质 + 本机覆盖）；
 *  - 本地 offer/answer 的 SDP 使用 applyOpusToSdp 修饰 opus fmtp；
 *  - maxBitrate 通过 RTCRtpSender.setParameters 实时生效；
 *  - 立体声/DTX/FEC/采样率变化通过重新协商尽量生效。
 *
 * 屏幕共享：每对连接预置 video transceiver，共享时 replaceTrack(screenTrack)，无需重新协商。
 */
class VoiceEngine {
  private handlers = new Map<keyof VoiceEventMap, Set<(payload: never) => void>>();
  private state: VoiceStateSnapshot = { ...INITIAL_VOICE_STATE };

  private entered = false;
  private destroyed = false;
  private generation = 0;
  private myUserId: number | null = null;
  private roomId: number | null = null;
  private roomAudioSettings: AudioSettings | null = null;
  private audioSettings: AudioSettings | null = null;
  private peers = new Map<number, PeerLink>();
  private peerNames = new Map<number, string>();
  private latestStats = new Map<number, PeerNetworkStats>();
  private lastPeerLevels = new Map<number, LocalLevelState>();
  private lastLocalLevel = 0;
  private lastLocalSpeaking = false;

  private audio: VoiceAudioGraph | null = null;
  private micStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private screenStream: MediaStream | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private screenPending = false;

  private levelTimer: number | null = null;
  private statsTimer: number | null = null;
  private statsInFlight = false;
  private unlockHandler: ((event: Event) => void) | null = null;

  on<K extends keyof VoiceEventMap>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (payload: never) => void);
    return () => {
      set?.delete(handler as (payload: never) => void);
    };
  }

  protected emit<K extends keyof VoiceEventMap>(type: K, payload: VoiceEventMap[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as Handler<K>)(payload);
      } catch (error) {
        console.error("[voice] 事件处理器异常", error);
      }
    }
  }

  protected setState(patch: Partial<VoiceStateSnapshot>): void {
    const keys = Object.keys(patch) as (keyof VoiceStateSnapshot)[];
    let changed = false;
    for (const key of keys) {
      if (patch[key] !== this.state[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.emit("state", this.state);
  }

  getState(): VoiceStateSnapshot {
    return this.state;
  }

  // ============ 生命周期 ============

  async enter(snapshot: RoomSnapshot): Promise<void> {
    const generation = this.bumpGeneration();
    this.closeSession();

    this.entered = true;
    this.roomId = snapshot.room.id;
    this.myUserId = useAuthStore.getState().user?.id ?? null;
    this.peerNames.clear();
    this.latestStats.clear();
    this.lastPeerLevels.clear();
    this.lastLocalLevel = 0;
    this.lastLocalSpeaking = false;

    const preferences = useSettingsStore.getState();
    this.roomAudioSettings = snapshot.room.audioSettings;
    this.audioSettings = mergeAudioSettings(snapshot.room.audioSettings, preferences.localAudioOverride);

    const graph = new VoiceAudioGraph();
    this.audio = graph;
    graph.onBlockedChange = (blocked) => {
      if (!this.entered) return;
      this.setState({ audioBlocked: blocked });
      if (!blocked) this.removeUnlockListeners();
    };
    graph.setMasterVolume(readMasterVolumePercent());
    graph.setDeafened(this.state.deafened);
    graph.setOutputDevice(preferences.outputDeviceId);

    const self = snapshot.peers.find((peer) => peer.userId === this.myUserId);
    this.setState({
      audioSettings: this.audioSettings,
      hasMicrophone: false,
      pttActive: false,
      screenSharing: false,
      audioBlocked: false,
      forceMuted: self?.forceMuted ?? false,
    });

    this.installUnlockListeners();
    for (const peer of snapshot.peers) {
      if (peer.userId === this.myUserId) continue;
      this.peerNames.set(peer.userId, peer.displayName);
      this.createPeerLink(peer.userId, peer.displayName, true);
    }
    this.startLoops();

    void graph.unlock().then((running) => {
      if (generation !== this.generation || !this.entered) return;
      this.setState({ audioBlocked: !running });
      if (running) this.removeUnlockListeners();
    });

    await this.acquireMicrophone(generation);
  }

  async addPeer(peer: PeerInfo): Promise<void> {
    if (!this.entered || this.destroyed) return;
    if (peer.userId === this.myUserId) return;
    this.peerNames.set(peer.userId, peer.displayName);
    if (this.peers.has(peer.userId)) return;
    // 已有成员作为应答方等待新成员发来 offer
    this.createPeerLink(peer.userId, peer.displayName, false);
  }

  removePeer(userId: number): void {
    const link = this.peers.get(userId);
    this.peers.delete(userId);
    this.peerNames.delete(userId);
    this.latestStats.delete(userId);
    this.lastPeerLevels.delete(userId);
    if (link) link.close();
  }

  async handleSignal(from: number, payload: SignalPayload): Promise<void> {
    if (!this.entered || this.destroyed) return;
    let link = this.peers.get(from);
    if (!link) {
      // 收到了尚未登记成员的信号：按应答方建立连接（服务端会把 peer_joined 补齐）
      link = this.createPeerLink(from, this.peerNames.get(from) ?? "房间成员", false);
    }
    await link.handleSignal(payload);
  }

  leave(): void {
    if (this.destroyed && !this.entered) return;
    this.bumpGeneration();
    this.closeSession();
    this.roomId = null;
    this.myUserId = null;
    this.roomAudioSettings = null;
    this.audioSettings = null;
    this.peerNames.clear();
    this.latestStats.clear();
    this.lastPeerLevels.clear();
    this.emit("screen-stream", { userId: null, stream: null });
    this.setState({
      micEnabled: true,
      deafened: false,
      screenSharing: false,
      pttActive: false,
      forceMuted: false,
      hasMicrophone: false,
      audioBlocked: false,
      audioSettings: null,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.leave();
    this.destroyed = true;
    this.handlers.clear();
  }

  // ============ 麦克风/播放状态 ============

  setMicEnabled(enabled: boolean): void {
    if (this.state.micEnabled !== enabled) this.setState({ micEnabled: enabled });
    this.applyTrackEnabled();
    // 允许通过"开启麦克风"重新申请权限/重试被拒绝的设备
    if (enabled && !this.micTrack && this.entered) void this.acquireMicrophone(this.generation);
  }

  setDeafened(deafened: boolean): void {
    if (this.state.deafened === deafened) return;
    this.setState({ deafened });
    this.audio?.setDeafened(deafened);
  }

  setPTTActive(active: boolean): void {
    if (this.state.pttActive === active) return;
    this.setState({ pttActive: active });
    this.applyTrackEnabled();
  }

  applyForceMute(muted: boolean): void {
    if (this.state.forceMuted === muted) {
      this.applyTrackEnabled();
      return;
    }
    this.setState({ forceMuted: muted });
    this.applyTrackEnabled();
  }

  /** 重新读取本机偏好（音质覆盖、PTT、全体音量、输出设备）并应用 */
  async refreshFromPreferences(): Promise<void> {
    if (this.roomAudioSettings) await this.applyAudioSettings(this.roomAudioSettings);
    const preferences = useSettingsStore.getState();
    this.audio?.setMasterVolume(readMasterVolumePercent());
    this.audio?.setOutputDevice(preferences.outputDeviceId);
    this.applyTrackEnabled();
    if (!preferences.pttEnabled) this.setPTTActive(false);
  }

  async applyAudioSettings(settings: AudioSettings): Promise<void> {
    this.roomAudioSettings = settings;
    const next = mergeAudioSettings(settings, useSettingsStore.getState().localAudioOverride);
    const previous = this.audioSettings;
    this.audioSettings = next;
    this.setState({ audioSettings: next });
    if (!previous || !this.entered) return;

    const microphoneChanged =
      previous.echoCancellation !== next.echoCancellation ||
      previous.noiseSuppression !== next.noiseSuppression ||
      previous.autoGainControl !== next.autoGainControl ||
      previous.sampleRate !== next.sampleRate ||
      previous.channels !== next.channels;
    const fmtpChanged =
      previous.channels !== next.channels ||
      previous.dtx !== next.dtx ||
      previous.fec !== next.fec ||
      previous.sampleRate !== next.sampleRate;

    if (microphoneChanged) void this.acquireMicrophone(this.generation);
    for (const link of this.peers.values()) await link.applyAudioParameters();
    if (fmtpChanged) {
      for (const link of this.peers.values()) link.requestRenegotiation(0);
    }
  }

  async switchInputDevice(deviceId: string): Promise<void> {
    const desired = deviceId ? deviceId : null;
    const preferences = useSettingsStore.getState();
    if (preferences.inputDeviceId !== desired) preferences.update({ inputDeviceId: desired });
    if (!this.entered || !this.audioSettings) return;
    await this.acquireMicrophone(this.generation);
  }

  setOutputDevice(deviceId: string): void {
    this.audio?.setOutputDevice(deviceId ? deviceId : null);
  }

  setMasterVolume(percent: number): void {
    this.audio?.setMasterVolume(percent);
  }

  setPeerVolume(userId: number, volumePercent: number): void {
    this.audio?.setRemoteVolume(userId, volumePercent);
  }

  isOutputDeviceSupported(): boolean {
    if (this.audio) return this.audio.supportsOutputSelection();
    const contextCtor = window.AudioContext;
    if (typeof contextCtor !== "function") return false;
    const prototype = contextCtor.prototype as AudioContext & { setSinkId?: unknown };
    return typeof prototype.setSinkId === "function";
  }

  async playTestSound(): Promise<boolean> {
    const graph = this.audio;
    if (graph) return graph.playTestTone();
    const temporary = new VoiceAudioGraph();
    temporary.setOutputDevice(useSettingsStore.getState().outputDeviceId);
    try {
      const played = await temporary.playTestTone();
      window.setTimeout(() => void temporary.close(), 1200);
      return played;
    } catch {
      void temporary.close();
      return false;
    }
  }

  /** 在用户手势中恢复音频输出；返回是否已可播放 */
  async resumeAudio(): Promise<boolean> {
    const graph = this.audio;
    if (!graph) return false;
    const running = await graph.unlock();
    if (this.entered) this.setState({ audioBlocked: !running });
    if (running) this.removeUnlockListeners();
    return running;
  }

  getRemoteStream(userId: number): MediaStream | null {
    return this.peers.get(userId)?.getRemoteAudioStream() ?? null;
  }

  getLocalScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  getPeerStats(): PeerNetworkStats[] {
    return [...this.latestStats.values()];
  }

  // ============ 屏幕共享 ============

  async setScreenSharing(active: boolean): Promise<boolean> {
    if (active) return this.startScreenSharing();
    await this.stopScreenSharing();
    return true;
  }

  private async startScreenSharing(): Promise<boolean> {
    if (this.state.screenSharing) return true;
    if (this.screenPending) return false;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== "function") {
      this.emit("error", { code: "screen_share_unsupported", message: "当前浏览器不支持屏幕共享。" });
      return false;
    }
    this.screenPending = true;
    const generation = this.generation;
    try {
      const stream = await mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (generation !== this.generation || !this.entered) {
        stopStream(stream);
        return false;
      }
      const track = stream.getVideoTracks()[0] ?? null;
      if (!track) {
        stopStream(stream);
        this.emit("error", { code: "screen_share_failed", message: "没有获取到屏幕画面，请重试。" });
        return false;
      }
      this.screenStream = stream;
      this.screenTrack = track;
      track.addEventListener("ended", () => {
        void this.stopScreenSharing();
      });
      this.setState({ screenSharing: true });
      for (const link of [...this.peers.values()]) {
        await link.setVideoTrack(track);
      }
      return true;
    } catch (error) {
      this.cleanupScreenStream();
      this.setState({ screenSharing: false });
      const name = readErrorName(error);
      if (name === "NotAllowedError" || name === "AbortError") {
        this.emit("error", { code: "screen_share_cancelled", message: "已取消屏幕共享。" });
        return false;
      }
      this.emit("error", {
        code: "screen_share_failed",
        message: "无法共享屏幕" + (readErrorMessage(error) ? "：" + readErrorMessage(error) : "。"),
      });
      return false;
    } finally {
      this.screenPending = false;
    }
  }

  private async stopScreenSharing(): Promise<void> {
    if (!this.screenStream && !this.screenTrack && !this.state.screenSharing) return;
    this.cleanupScreenStream();
    this.setState({ screenSharing: false });
    for (const link of [...this.peers.values()]) {
      await link.setVideoTrack(null);
    }
  }

  private cleanupScreenStream(): void {
    const stream = this.screenStream;
    this.screenStream = null;
    this.screenTrack = null;
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  }

  // ============ 内部：音频图/连接 ============

  private createPeerLink(userId: number, displayName: string, initiator: boolean): PeerLink {
    const existing = this.peers.get(userId);
    if (existing) return existing;
    const link = new PeerLink({
      userId,
      displayName,
      initiator,
      getRtcConfiguration: () => buildRtcConfiguration(useAppStore.getState().server),
      getAudioSettings: () => this.audioSettings ?? DEFAULT_AUDIO_SETTINGS,
      getMicrophoneTrack: () => this.micTrack,
      getScreenTrack: () => this.screenTrack,
      sendSignal: (to, payload) => {
        socket.send({ t: "signal", to, payload });
      },
      onRemoteAudio: (id, stream) => this.handleRemoteAudio(id, stream),
      onRemoteScreen: (id, stream) => this.handleRemoteScreen(id, stream),
      onConnectionFailed: (id) => this.handleConnectionFailure(id),
    });
    this.peers.set(userId, link);
    link.start();
    return link;
  }

  private handleRemoteAudio(userId: number, stream: MediaStream | null): void {
    const graph = this.audio;
    if (!stream) {
      graph?.detachRemote(userId);
      this.emit("peer-stream", { userId, stream: null });
      return;
    }
    graph?.attachRemote(userId, stream);
    graph?.setRemoteVolume(userId, volumeFor(userId));
    this.emit("peer-stream", { userId, stream });
  }

  private handleRemoteScreen(userId: number, stream: MediaStream | null): void {
    this.emit("screen-stream", { userId, stream });
  }

  private handleConnectionFailure(userId: number): void {
    const name = this.peerNames.get(userId) ?? "对方";
    this.emit("error", {
      code: "peer_connection_failed",
      message: "与 " + name + " 的语音连接失败，请检查网络、NAT 或 TURN 中继配置。",
    });
  }

  private async acquireMicrophone(generation: number): Promise<void> {
    const preferences = useSettingsStore.getState();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
      this.setState({ hasMicrophone: false });
      this.emit("error", {
        code: "mic_unsupported",
        message: "当前环境无法采集麦克风（需要通过 HTTPS 或 localhost 访问）。你仍可以收听房间语音。",
      });
      return;
    }
    try {
      await this.startMicrophone(preferences.inputDeviceId, generation);
      return;
    } catch (error) {
      if (generation !== this.generation || !this.entered) return;
      const name = readErrorName(error);
      const retryable =
        preferences.inputDeviceId !== null && (name === "OverconstrainedError" || name === "NotFoundError");
      if (!retryable) {
        this.reportMicrophoneFailure(error);
        return;
      }
      try {
        await this.startMicrophone(null, generation);
        useSettingsStore.getState().update({ inputDeviceId: null });
        this.emit("error", { code: "mic_device_fallback", message: "所选麦克风不可用，已切换为系统默认设备。" });
      } catch (fallbackError) {
        if (generation !== this.generation) return;
        this.reportMicrophoneFailure(fallbackError);
      }
    }
  }

  private async startMicrophone(deviceId: string | null, generation: number): Promise<void> {
    const settings = this.audioSettings;
    const mediaDevices = navigator.mediaDevices;
    if (!settings || !mediaDevices) throw new Error("当前环境不支持麦克风采集");
    const stream = await mediaDevices.getUserMedia(buildMicrophoneConstraints(settings, deviceId));
    if (generation !== this.generation || !this.entered) {
      stopStream(stream);
      return;
    }
    const track = stream.getAudioTracks()[0] ?? null;
    if (!track) {
      stopStream(stream);
      throw new Error("未获取到音频轨道");
    }
    this.replaceLocalMicrophone(stream, track);
    this.setState({ hasMicrophone: true });
    this.applyTrackEnabled();
    for (const link of [...this.peers.values()]) {
      await link.setAudioTrack(track);
      if (generation !== this.generation || !this.entered) return;
    }
  }

  private replaceLocalMicrophone(stream: MediaStream, track: MediaStreamTrack): void {
    const previous = this.micStream;
    this.micStream = stream;
    this.micTrack = track;
    this.audio?.setLocalStream(stream);
    if (previous) stopStream(previous);
  }

  private reportMicrophoneFailure(error: unknown): void {
    if (this.micTrack && this.micTrack.readyState === "live") {
      this.emit("error", { code: "mic_update_failed", message: "无法应用新的麦克风设置，继续使用当前设备。" });
      return;
    }
    this.setState({ hasMicrophone: false });
    this.emit("error", describeMicrophoneError(error));
  }

  private applyTrackEnabled(): void {
    const track = this.micTrack;
    if (!track) return;
    const preferences = useSettingsStore.getState();
    const pttAllows = preferences.pttEnabled ? this.state.pttActive : true;
    const enabled =
      this.state.hasMicrophone && this.state.micEnabled && !this.state.forceMuted && pttAllows;
    if (track.enabled !== enabled) track.enabled = enabled;
  }

  // ============ 内部：循环任务 ============

  private startLoops(): void {
    this.stopLoops();
    this.levelTimer = window.setInterval(() => this.tickLevels(), LEVEL_INTERVAL_MS);
    this.statsTimer = window.setInterval(() => void this.tickStats(), STATS_INTERVAL_MS);
  }

  private stopLoops(): void {
    if (this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    if (this.statsTimer !== null) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private tickLevels(): void {
    if (!this.entered) return;
    const graph = this.audio;
    if (!graph) return;
    const preferences = useSettingsStore.getState();

    const rawLocal = graph.sampleLocalRaw();
    const level = VoiceAudioGraph.toUiLevel(rawLocal);
    const micActive =
      this.state.hasMicrophone &&
      this.state.micEnabled &&
      !this.state.forceMuted &&
      (!preferences.pttEnabled || this.state.pttActive);
    const speaking = micActive && rawLocal >= preferences.vadThreshold;
    if (speaking !== this.lastLocalSpeaking || Math.abs(level - this.lastLocalLevel) >= 0.015) {
      this.lastLocalSpeaking = speaking;
      this.lastLocalLevel = level;
      this.emit("local-level", { level, speaking });
    }

    for (const userId of [...this.peers.keys()]) {
      const raw = graph.sampleRemoteRaw(userId);
      const peerLevel = VoiceAudioGraph.toUiLevel(raw);
      const peerSpeaking = raw >= preferences.vadThreshold;
      const previous = this.lastPeerLevels.get(userId);
      if (!previous || previous.speaking !== peerSpeaking || Math.abs(previous.level - peerLevel) >= 0.03) {
        this.lastPeerLevels.set(userId, { level: peerLevel, speaking: peerSpeaking });
        this.emit("peer-level", { userId, level: peerLevel, speaking: peerSpeaking });
      }
    }
  }

  private async tickStats(): Promise<void> {
    if (!this.entered || this.statsInFlight) return;
    this.statsInFlight = true;
    try {
      for (const link of [...this.peers.values()]) {
        if (!this.entered) return;
        if (link.isClosed) continue;
        const stats = await link.getStats();
        if (!this.entered) return;
        this.latestStats.set(stats.userId, stats);
        this.emit("peer-stats", stats);
      }
    } catch (error) {
      console.warn("[voice] 获取网络统计失败", error);
    } finally {
      this.statsInFlight = false;
    }
  }

  // ============ 内部：清理与浏览器自动播放 ============

  private closeSession(): void {
    this.entered = false;
    this.stopLoops();
    const links = [...this.peers.values()];
    this.peers.clear();
    for (const link of links) link.close();
    this.latestStats.clear();
    this.lastPeerLevels.clear();
    this.stopLocalMicrophone();
    this.cleanupScreenStream();
    this.screenPending = false;
    const graph = this.audio;
    this.audio = null;
    if (graph) {
      graph.onBlockedChange = null;
      void graph.close();
    }
    this.removeUnlockListeners();
    if (this.lastLocalLevel > 0 || this.lastLocalSpeaking) {
      this.lastLocalLevel = 0;
      this.lastLocalSpeaking = false;
      this.emit("local-level", { level: 0, speaking: false });
    }
  }

  private stopLocalMicrophone(): void {
    const stream = this.micStream;
    this.micStream = null;
    this.micTrack = null;
    if (stream) stopStream(stream);
  }

  private installUnlockListeners(): void {
    if (this.unlockHandler) return;
    const handler = (): void => {
      void this.resumeAudio();
    };
    this.unlockHandler = handler;
    document.addEventListener("pointerdown", handler, true);
    document.addEventListener("keydown", handler, true);
  }

  private removeUnlockListeners(): void {
    const handler = this.unlockHandler;
    if (!handler) return;
    document.removeEventListener("pointerdown", handler, true);
    document.removeEventListener("keydown", handler, true);
    this.unlockHandler = null;
  }

  private bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

function readErrorName(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

function readErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

export const voice = new VoiceEngine();
export type VoiceEngineType = VoiceEngine;

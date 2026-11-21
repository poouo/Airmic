import type { AudioSettings, LivekitTokenResponse, PeerInfo, RoomSnapshot, SignalPayload } from "@airmic/shared";
import { DEFAULT_AUDIO_SETTINGS, audioSettingsEqual, capAudioBitrate, mergeAudioSettings, roomAudioBitrateCap } from "@airmic/shared";
import {
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  isRemoteParticipant,
  supportsAudioOutputSelection,
} from "livekit-client";
import type {
  AudioCaptureOptions,
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  TrackPublication,
} from "livekit-client";
import { useAppStore } from "../stores/app";
import { useAuthStore } from "../stores/auth";
import { useRoomStore } from "../stores/room";
import { useSettingsStore, volumeFor } from "../stores/settings";
import { LocalLevelAnalyser } from "./analyser";
import {
  buildAudioCaptureOptions,
  buildRoomOptions,
  buildTrackPublishOptions,
  describeMicrophoneError,
  describeTokenError,
  fetchLivekitToken,
  mapConnectionQuality,
  parseIdentityUserId,
  parseMetadataUserId,
  readErrorMessage,
  readErrorName,
} from "./livekit";
import { INITIAL_VOICE_STATE } from "./types";
import type { PeerNetworkStats, VoiceEventMap, VoiceStateSnapshot, VoiceQuality } from "./types";

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
/** 连接质量汇总间隔 */
const STATS_INTERVAL_MS = 2000;
/** 电平 UI 放大系数（时域 RMS -> 0-1） */
const LEVEL_GAIN = 3.5;

interface PeerNameHint {
  displayName: string;
  username: string;
}

interface RemoteScreenEntry {
  userId: number;
  stream: MediaStream;
}

/**
 * LiveKit SFU 语音引擎（媒体只经服务器中转，不使用任何客户端 P2P）。
 *
 * 生命周期（由 src/lib/events.ts 驱动，页面不要重复调用）：
 *  - room_joined → enter(snapshot)：换 token、连接 LiveKit、发布麦克风；
 *  - addPeer / removePeer / handleSignal 在 SFU 模式下无需建立连接（成员由 LiveKit 管理），
 *    这里只维护身份映射兜底，不做任何 P2P；
 *  - room_updated → applyAudioSettings；force_muted → applyForceMute；
 *  - leave → 断开 LiveKit 并清理全部资源。
 *
 * 兼容旧 API：VoiceEventMap / VoiceStateSnapshot / PeerNetworkStats 与页面、设置组件保持一致。
 */
class VoiceEngine {
  private handlers = new Map<keyof VoiceEventMap, Set<(payload: never) => void>>();
  private state: VoiceStateSnapshot = { ...INITIAL_VOICE_STATE };

  private entered = false;
  private destroyed = false;
  private leaving = false;
  private generation = 0;

  private room: Room | null = null;
  private roomId: number | null = null;
  private myUserId: number | null = null;
  private localIdentity: string | null = null;
  private roomAudioSettings: AudioSettings | null = null;
  private activeRoomBitrateCap: number | null = null;
  private stageAllowed = true;
  /** 发布时协商的音质，人数变化只调整 sender 的码率上限。 */
  private audioSettings: AudioSettings | null = null;

  private nameDirectory = new Map<number, PeerNameHint>();
  private participantIds = new Map<string, number>();
  private qualityByParticipant = new Map<string, VoiceQuality>();
  private latestStats = new Map<number, PeerNetworkStats>();
  private rememberedVolumes = new Map<number, number>();
  private remoteAudioStreams = new Map<number, MediaStream>();
  private remoteScreenStreams = new Map<string, RemoteScreenEntry>();
  private audioElements = new Map<string, HTMLMediaElement>();
  private audioContainer: HTMLDivElement | null = null;

  private localScreenStream: MediaStream | null = null;
  private readonly analyser = new LocalLevelAnalyser();
  private micChain: Promise<void> = Promise.resolve();
  private micActive = false;
  private micOptionsDirty = false;
  /** 同一次麦克风故障会被 LiveKit 事件与本地 catch 重复上报，短窗口内去重 */
  private lastMicError: { code: string; at: number } | null = null;

  private levelTimer: number | null = null;
  private statsTimer: number | null = null;
  private lastLocalLevel = 0;
  private lastLocalSpeaking = false;

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

  private emit<K extends keyof VoiceEventMap>(type: K, payload: VoiceEventMap[K]): void {
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

  private setState(patch: Partial<VoiceStateSnapshot>): void {
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
    try {
      await this.enterInternal(snapshot, generation);
    } catch (error) {
      console.error("[voice] 进入房间语音失败", error);
      if (generation === this.generation && this.entered) {
        this.emit("error", { code: "voice_unavailable", message: "语音初始化失败，请刷新页面后重试。" });
      }
    }
  }

  private async enterInternal(snapshot: RoomSnapshot, generation: number): Promise<void> {
    await this.shutdownRoom();
    if (generation !== this.generation) return;

    this.entered = true;
    this.leaving = false;
    this.roomId = snapshot.room.id;
    this.myUserId = useAuthStore.getState().user?.id ?? null;
    this.nameDirectory.clear();
    for (const peer of snapshot.peers) {
      if (peer.userId === this.myUserId) continue;
      this.nameDirectory.set(peer.userId, { displayName: peer.displayName, username: peer.username });
    }

    const preferences = useSettingsStore.getState();
    this.roomAudioSettings = snapshot.room.audioSettings;
    this.activeRoomBitrateCap = this.readRoomBitrateCap() ?? null;
    this.stageAllowed = snapshot.room.voiceMode !== "stage" || snapshot.selfOnStage;
    this.audioSettings = mergeAudioSettings(snapshot.room.audioSettings, preferences.localAudioOverride);
    this.setState({
      audioSettings: capAudioBitrate(this.audioSettings, this.activeRoomBitrateCap),
      hasMicrophone: false,
      pttActive: false,
      screenSharing: false,
      audioBlocked: false,
      forceMuted: false,
    });

    const server = useAppStore.getState().server;
    if (!server || !server.voiceAvailable) {
      this.emit("error", {
        code: "voice_unavailable",
        message: "语音中转服务未配置，请联系服务器管理员。",
      });
      return;
    }

    let tokenInfo: LivekitTokenResponse;
    try {
      tokenInfo = await fetchLivekitToken(snapshot.room.id);
    } catch (error) {
      if (generation !== this.generation || !this.entered) return;
      this.emit("error", describeTokenError(error));
      return;
    }
    if (generation !== this.generation || !this.entered) return;

    this.audioContainer = createAudioContainer();
    const room = new Room(
      buildRoomOptions(this.audioSettings, preferences.inputDeviceId, preferences.outputDeviceId),
    );
    this.room = room;
    this.localIdentity = tokenInfo.identity;
    if (this.myUserId !== null && tokenInfo.identity) this.participantIds.set(tokenInfo.identity, this.myUserId);
    this.registerRoomListeners(room);

    try {
      await room.connect(tokenInfo.url, tokenInfo.token, { autoSubscribe: true });
    } catch (error) {
      console.warn("[voice] 连接 LiveKit 失败", error);
      if (generation !== this.generation || this.room !== room) {
        await this.disposeRoom(room);
        return;
      }
      const detail = readErrorMessage(error);
      this.emit("error", {
        code: "voice_connect_failed",
        message: "无法连接语音中转服务器" + (detail ? "：" + detail : "") + "。请检查网络或联系管理员。",
      });
      this.room = null;
      this.entered = false;
      this.stopLoops();
      this.analyser.cleanup();
      this.detachAllRemoteAudio();
      this.removeAudioContainer();
      await this.disposeRoom(room);
      return;
    }
    if (generation !== this.generation || this.room !== room) return;

    // 自动播放策略：房间连接完成后尝试启用音频输出
    try {
      await room.startAudio();
    } catch {
      /* 被浏览器拦截时通过 canPlaybackAudio 判定，页面会提示“点击启用声音” */
    }
    if (generation !== this.generation || this.room !== room) return;
    this.handleAudioPlaybackStatus(room.canPlaybackAudio);

    this.syncExistingTracks();
    this.handleConnectionQualityChanged(room.localParticipant.connectionQuality, room.localParticipant);
    this.startLoops();
    await this.queueMicUpdate();
  }

  /** SFU 模式下成员由 LiveKit 管理，这里只补充身份映射兜底 */
  async addPeer(peer: PeerInfo): Promise<void> {
    if (peer.userId === this.myUserId) return;
    this.nameDirectory.set(peer.userId, { displayName: peer.displayName, username: peer.username });
  }

  /** SFU 模式下无需拆除任何 P2P 连接 */
  removePeer(userId: number): void {
    this.nameDirectory.delete(userId);
    this.latestStats.delete(userId);
    this.participantIds.forEach((value, identity) => {
      if (value === userId) this.participantIds.delete(identity);
    });
  }

  /** SFU 模式不使用 WebSocket 信令 */
  async handleSignal(_from: number, _payload: SignalPayload): Promise<void> {
    /* no-op：媒体由 LiveKit SFU 转发，客户端之间没有 PeerConnection */
  }

  leave(): void {
    if (this.destroyed && !this.entered && !this.room) return;
    this.entered = false;
    this.leaving = true;
    this.bumpGeneration();
    void this.shutdownRoom();
    this.roomId = null;
    this.myUserId = null;
    this.localIdentity = null;
    this.nameDirectory.clear();
    this.roomAudioSettings = null;
    this.activeRoomBitrateCap = null;
    this.audioSettings = null;
    this.stageAllowed = true;
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
    this.queueMicUpdate();
  }

  /** 上麦席位变化时动态允许/停止发布本地麦克风，保持 LiveKit 连接不变。 */
  applyStageAccess(allowed: boolean): void {
    if (this.stageAllowed === allowed) return;
    this.stageAllowed = allowed;
    this.queueMicUpdate();
  }

  setDeafened(deafened: boolean): void {
    if (this.state.deafened === deafened) return;
    this.setState({ deafened });
    this.applyAllVolumes();
    this.syncRemoteAudioTracks();
  }

  setPTTActive(active: boolean): void {
    if (this.state.pttActive === active) return;
    this.setState({ pttActive: active });
    this.queueMicUpdate();
  }

  applyForceMute(muted: boolean): void {
    if (this.state.forceMuted !== muted) this.setState({ forceMuted: muted });
    this.queueMicUpdate();
  }

  applyAudioSettings(settings: AudioSettings): void {
    this.roomAudioSettings = settings;
    const preferred = mergeAudioSettings(settings, useSettingsStore.getState().localAudioOverride);
    const effective = capAudioBitrate(preferred, this.activeRoomBitrateCap);
    const previous = this.audioSettings;
    const previousEffective = this.state.audioSettings;
    this.audioSettings = preferred;
    this.setState({ audioSettings: effective });
    if (!previous || !this.room) return;
    const restart = !audioSettingsEqual(previous, preferred);
    if (restart || previousEffective?.bitrate !== effective.bitrate) this.queueMicUpdate(restart);
  }

  /** 仅在房间上限变化时返回新上限，null 表示恢复。 */
  refreshRoomBitrateCap(): number | null | undefined {
    if (!this.roomAudioSettings) return undefined;
    const cap = this.readRoomBitrateCap();
    if (cap === undefined || this.activeRoomBitrateCap === cap) return undefined;
    this.activeRoomBitrateCap = cap;
    this.applyAudioSettings(this.roomAudioSettings);
    return cap;
  }

  private readRoomBitrateCap(): number | null | undefined {
    const { snapshot, peers } = useRoomStore.getState();
    if (!snapshot || snapshot.room.id !== this.roomId) return undefined;
    return roomAudioBitrateCap(useAppStore.getState().server?.roomAudioBitrateLimit, peers.length + 1);
  }

  async switchInputDevice(deviceId: string): Promise<void> {
    const desired = deviceId ? deviceId : null;
    const preferences = useSettingsStore.getState();
    if (preferences.inputDeviceId !== desired) preferences.update({ inputDeviceId: desired });
    const room = this.room;
    if (!room) return;
    const target = desired ?? "default";
    try {
      // 选择“系统默认”时不做 exact 约束，避免部分浏览器没有名为 default 的物理设备
      const switched = await room.switchActiveDevice("audioinput", target, desired !== null);
      if (!switched && this.micActive) {
        this.emit("error", { code: "mic_device_switch_failed", message: "无法切换到所选麦克风，请确认设备可用后重试。" });
        return;
      }
      this.attachMicAnalyser();
    } catch (error) {
      console.warn("[voice] 切换输入设备失败", error);
      if (this.micActive) {
        this.emit("error", { code: "mic_device_switch_failed", message: "无法切换麦克风设备，请检查设备是否可用。" });
      }
    }
  }

  setOutputDevice(deviceId: string): void {
    const room = this.room;
    if (!room || !supportsAudioOutputSelection()) return;
    void room
      .switchActiveDevice("audiooutput", deviceId ? deviceId : "default", Boolean(deviceId))
      .catch((error: unknown) => {
        console.warn("[voice] 切换输出设备失败", error);
        this.emit("error", { code: "output_device_switch_failed", message: "无法切换扬声器设备，请重试。" });
      });
  }

  setMasterVolume(_percent: number): void {
    // 主音量通过重新计算每个参与者的实际音量实现（settingsStore 已由调用方写入）
    this.applyAllVolumes();
  }

  setPeerVolume(userId: number, volumePercent: number): void {
    const room = this.room;
    if (!room) return;
    const effective = clamp01((volumePercent / 100) * (readMasterVolumePercent() / 100));
    this.rememberedVolumes.set(userId, effective);
    for (const participant of room.remoteParticipants.values()) {
      if (this.resolveUserId(participant) === userId) this.applyParticipantVolume(participant, userId);
    }
  }

  /** 重新读取本机偏好（音质覆盖、PTT、全体音量、输出设备）并应用 */
  async refreshFromPreferences(): Promise<void> {
    if (this.roomAudioSettings) this.applyAudioSettings(this.roomAudioSettings);
    this.applyAllVolumes();
    this.setOutputDevice(useSettingsStore.getState().outputDeviceId ?? "");
    if (!useSettingsStore.getState().pttEnabled) this.setPTTActive(false);
    this.queueMicUpdate();
  }

  isOutputDeviceSupported(): boolean {
    return supportsAudioOutputSelection();
  }

  async playTestSound(): Promise<boolean> {
    if (this.room && this.state.audioBlocked) await this.resumeAudio();
    return playTestTone();
  }

  /** 在用户手势中恢复音频输出；返回是否已可播放 */
  async resumeAudio(): Promise<boolean> {
    const room = this.room;
    if (!room) return false;
    try {
      await room.startAudio();
    } catch {
      /* 仍被拦截时返回 false，页面可继续提示 */
    }
    const playable = room.canPlaybackAudio;
    this.setState({ audioBlocked: !playable });
    if (playable) this.removeAutoplayUnlock();
    await this.analyser.resume();
    return playable;
  }

  getRemoteStream(userId: number): MediaStream | null {
    return this.remoteAudioStreams.get(userId) ?? null;
  }

  getLocalScreenStream(): MediaStream | null {
    return this.localScreenStream;
  }

  getPeerStats(): PeerNetworkStats[] {
    return [...this.latestStats.values()];
  }

  // ============ 屏幕共享（经 SFU 转发） ============

  async setScreenSharing(active: boolean): Promise<boolean> {
    const room = this.room;
    if (!room) {
      if (active) {
        this.emit("error", { code: "voice_not_connected", message: "语音尚未连接，无法共享屏幕。" });
        return false;
      }
      this.setState({ screenSharing: false });
      return true;
    }
    if (active === this.state.screenSharing) return true;
    try {
      await room.localParticipant.setScreenShareEnabled(active, { audio: false });
      this.refreshLocalScreenStream();
      this.setState({ screenSharing: active });
      return true;
    } catch (error) {
      console.warn("[voice] 屏幕共享失败", error);
      const name = readErrorName(error);
      if (name === "NotAllowedError" || name === "AbortError") {
        this.emit("error", { code: "screen_share_cancelled", message: "已取消屏幕共享。" });
      } else {
        const detail = readErrorMessage(error);
        this.emit("error", {
          code: "screen_share_failed",
          message: "无法共享屏幕" + (detail ? "：" + detail : "。"),
        });
      }
      this.refreshLocalScreenStream();
      this.setState({ screenSharing: Boolean(this.localScreenStream) });
      return false;
    }
  }

  private refreshLocalScreenStream(): void {
    const room = this.room;
    const publication = room?.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    const track = publication?.track;
    if (track) {
      if (!this.localScreenStream || this.localScreenStream.getVideoTracks()[0] !== track.mediaStreamTrack) {
        this.localScreenStream = new MediaStream([track.mediaStreamTrack]);
      }
    } else {
      this.localScreenStream = null;
    }
  }

  // ============ 内部：LiveKit 事件 ============

  private registerRoomListeners(room: Room): void {
    room.on(RoomEvent.ParticipantConnected, this.handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, this.handleParticipantDisconnected);
    room.on(RoomEvent.TrackPublished, (publication) => this.syncRemoteAudioTrack(publication));
    room.on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed);
    room.on(RoomEvent.TrackMuted, this.handleTrackMuted);
    room.on(RoomEvent.TrackUnmuted, this.handleTrackUnmuted);
    room.on(RoomEvent.LocalTrackPublished, this.handleLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, this.handleLocalTrackUnpublished);
    room.on(RoomEvent.AudioPlaybackStatusChanged, this.handleAudioPlaybackStatusChanged);
    room.on(RoomEvent.ConnectionQualityChanged, this.handleConnectionQualityChanged);
    room.on(RoomEvent.Reconnected, () => {
      this.syncRemoteAudioTracks(true);
      this.queueMicUpdate();
    });
    room.on(RoomEvent.Disconnected, this.handleRoomDisconnected);
    room.on(RoomEvent.MediaDevicesError, this.handleMediaDevicesError);
  }

  private handleParticipantConnected = (participant: RemoteParticipant): void => {
    this.qualityByParticipant.set(
      participant.identity,
      mapConnectionQuality(participant.connectionQuality),
    );
    this.resolveUserId(participant);
    this.syncParticipantTracks(participant);
  };

  private handleParticipantDisconnected = (participant: RemoteParticipant): void => {
    const userId = this.resolveUserId(participant);
    for (const publication of participant.trackPublications.values()) {
      if (publication.kind === Track.Kind.Audio) {
        this.detachRemoteAudio(publication, participant);
      } else if (publication.source === Track.Source.ScreenShare) {
        const entry = this.remoteScreenStreams.get(publication.trackSid);
        if (entry) {
          this.remoteScreenStreams.delete(publication.trackSid);
          this.emit("screen-stream", { userId: entry.userId, stream: null });
        }
      }
    }
    if (userId !== null) {
      this.remoteAudioStreams.delete(userId);
      this.latestStats.delete(userId);
      this.emit("peer-stream", { userId, stream: null });
    }
    this.qualityByParticipant.delete(participant.identity);
    this.participantIds.delete(participant.identity);
  };

  private handleTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    if (track.kind === Track.Kind.Audio) {
      this.attachRemoteAudio(track, publication, participant);
      return;
    }
    if (publication.source === Track.Source.ScreenShare) {
      this.attachRemoteScreen(track, publication, participant);
    }
  };

  private handleTrackUnsubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    if (track.kind === Track.Kind.Audio) {
      this.detachRemoteAudio(publication, participant);
      return;
    }
    const entry = this.remoteScreenStreams.get(publication.trackSid);
    if (entry) {
      this.remoteScreenStreams.delete(publication.trackSid);
      this.emit("screen-stream", { userId: entry.userId, stream: null });
    }
  };

  private handleTrackMuted = (publication: TrackPublication, participant: Participant): void => {
    if (publication.kind !== Track.Kind.Video || publication.source !== Track.Source.ScreenShare) return;
    if (!isRemoteParticipant(participant)) return;
    const entry = this.remoteScreenStreams.get(publication.trackSid);
    if (entry) {
      this.remoteScreenStreams.delete(publication.trackSid);
      this.emit("screen-stream", { userId: entry.userId, stream: null });
    }
  };

  private handleTrackUnmuted = (publication: TrackPublication, participant: Participant): void => {
    if (publication.kind !== Track.Kind.Video || publication.source !== Track.Source.ScreenShare) return;
    if (!isRemoteParticipant(participant)) return;
    const track = publication.track;
    if (track) this.attachRemoteScreen(track, publication, participant);
  };

  private handleLocalTrackPublished = (publication: LocalTrackPublication): void => {
    if (publication.source === Track.Source.ScreenShare) {
      this.refreshLocalScreenStream();
      this.setState({ screenSharing: Boolean(this.localScreenStream) });
      return;
    }
    if (publication.source === Track.Source.Microphone) {
      this.micActive = Boolean(publication.track);
      this.setState({ hasMicrophone: true });
      this.attachMicAnalyser();
    }
  };

  private handleLocalTrackUnpublished = (publication: LocalTrackPublication): void => {
    if (publication.source === Track.Source.ScreenShare) {
      this.refreshLocalScreenStream();
      this.setState({ screenSharing: Boolean(this.localScreenStream) });
      return;
    }
    if (publication.source === Track.Source.Microphone) {
      const room = this.room;
      const stillPublished = room?.localParticipant.getTrackPublication(Track.Source.Microphone) !== undefined;
      this.micActive = stillPublished;
      if (!stillPublished) {
        this.analyser.start(null);
        this.emitZeroLevel();
      }
    }
  };

  private handleAudioPlaybackStatusChanged = (playing: boolean): void => {
    this.setState({ audioBlocked: !playing });
    if (playing) this.removeAutoplayUnlock();
    else this.installAutoplayUnlock();
  };

  private handleConnectionQualityChanged = (quality: ConnectionQuality, participant: Participant): void => {
    this.qualityByParticipant.set(participant.identity, mapConnectionQuality(quality));
  };

  private handleRoomDisconnected = (reason?: DisconnectReason): void => {
    if (this.leaving || !this.entered) return;
    const room = this.room;
    this.room = null;
    this.entered = false;
    this.stopLoops();
    this.analyser.cleanup();
    this.detachAllRemoteAudio();
    this.removeAutoplayUnlock();
    this.removeAudioContainer();
    this.localScreenStream = null;
    this.qualityByParticipant.clear();
    this.latestStats.clear();
    this.remoteAudioStreams.clear();
    this.remoteScreenStreams.clear();
    this.emit("screen-stream", { userId: null, stream: null });
    this.emitZeroLevel();
    this.setState({ hasMicrophone: false, screenSharing: false, audioBlocked: false, pttActive: false });
    if (room) {
      try {
        room.removeAllListeners();
      } catch {
        /* ignore */
      }
    }
    this.emit("error", { code: "voice_disconnected", message: describeDisconnectReason(reason) });
  };

  private handleMediaDevicesError = (error: Error): void => {
    this.reportMicrophoneError(error);
  };

  /** 上报麦克风错误：同一次故障可能被多个事件/路径重复触发，短窗口内只提示一次 */
  private reportMicrophoneError(error: unknown): void {
    const payload = describeMicrophoneError(error);
    const now = Date.now();
    const previous = this.lastMicError;
    if (previous && previous.code === payload.code && now - previous.at < 3000) return;
    this.lastMicError = { code: payload.code, at: now };
    this.emit("error", payload);
  }

  // ============ 内部：参与者/轨道 ============

  private syncExistingTracks(): void {
    const room = this.room;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      this.resolveUserId(participant);
      this.qualityByParticipant.set(participant.identity, mapConnectionQuality(participant.connectionQuality));
      this.syncParticipantTracks(participant);
    }
  }

  private syncParticipantTracks(participant: RemoteParticipant): void {
    for (const publication of participant.trackPublications.values()) {
      const track = publication.track;
      if (publication.isSubscribed && track) {
        this.handleTrackSubscribed(track, publication, participant);
      } else {
        this.syncRemoteAudioTrack(publication);
      }
    }
  }

  private attachRemoteAudio(
    track: Track,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    this.syncRemoteAudioTrack(publication);
    const trackSid = publication.trackSid;
    if (!this.audioElements.has(trackSid)) {
      const element = track.attach();
      element.hidden = true;
      this.audioContainer?.append(element);
      this.audioElements.set(trackSid, element);
    }
    const userId = this.resolveUserId(participant);
    if (userId === null) {
      participant.setVolume(this.state.deafened ? 0 : 1);
      return;
    }
    this.rememberedVolumes.set(userId, this.effectiveVolume(userId));
    this.applyParticipantVolume(participant, userId);
    const stream = new MediaStream([track.mediaStreamTrack]);
    this.remoteAudioStreams.set(userId, stream);
    this.emit("peer-stream", { userId, stream });
  }

  private detachRemoteAudio(publication: RemoteTrackPublication, participant: RemoteParticipant): void {
    const element = this.audioElements.get(publication.trackSid);
    if (element) {
      try {
        publication.track?.detach(element);
      } catch {
        /* ignore */
      }
      element.remove();
      this.audioElements.delete(publication.trackSid);
    }
    const userId = this.resolveUserId(participant);
    if (userId === null) return;
    const hasOtherAudio = [...participant.audioTrackPublications.values()].some(
      (publicationItem) =>
        publicationItem.trackSid !== publication.trackSid && publicationItem.isSubscribed && publicationItem.track !== undefined,
    );
    if (!hasOtherAudio) {
      this.remoteAudioStreams.delete(userId);
      this.emit("peer-stream", { userId, stream: null });
    }
  }

  private attachRemoteScreen(
    track: Track,
    publication: TrackPublication,
    participant: RemoteParticipant,
  ): void {
    const userId = this.resolveUserId(participant);
    if (userId === null) return;
    const stream = new MediaStream([track.mediaStreamTrack]);
    this.remoteScreenStreams.set(publication.trackSid, { userId, stream });
    this.emit("screen-stream", { userId, stream });
  }

  private detachAllRemoteAudio(): void {
    for (const element of this.audioElements.values()) {
      try {
        element.remove();
      } catch {
        /* ignore */
      }
    }
    this.audioElements.clear();
  }

  private removeAudioContainer(): void {
    if (this.audioContainer) {
      this.audioContainer.remove();
      this.audioContainer = null;
    }
  }

  /** 参与者 identity -> 数字 userId（identity 为 String(user.id)，另有 metadata/显示名兜底） */
  private resolveUserId(participant: Participant): number | null {
    const identity = participant.identity;
    const cached = this.participantIds.get(identity);
    if (cached !== undefined) return cached;
    const fromIdentity = parseIdentityUserId(identity);
    if (fromIdentity !== null) {
      this.participantIds.set(identity, fromIdentity);
      return fromIdentity;
    }
    const fromMetadata = parseMetadataUserId(participant.metadata);
    if (fromMetadata !== null) {
      this.participantIds.set(identity, fromMetadata);
      return fromMetadata;
    }
    if (participant.isLocal && this.myUserId !== null) {
      this.participantIds.set(identity, this.myUserId);
      return this.myUserId;
    }
    const name = participant.name?.trim();
    if (name) {
      for (const [userId, hint] of this.nameDirectory) {
        if (hint.displayName === name || hint.username === name) {
          this.participantIds.set(identity, userId);
          return userId;
        }
      }
    }
    return null;
  }

  // ============ 内部：收听与音量 ============

  private syncRemoteAudioTrack(publication: RemoteTrackPublication, resend = false): void {
    if (publication.kind !== Track.Kind.Audio) return;
    const enabled = !this.state.deafened;
    if (publication.isEnabled !== enabled) {
      publication.setEnabled(enabled);
    } else if (resend) {
      // LiveKit 恢复连接时只重发视频轨道设置。
      publication.emitTrackUpdate();
    }
  }

  private syncRemoteAudioTracks(resend = false): void {
    if (!this.room) return;
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        this.syncRemoteAudioTrack(publication, resend);
      }
    }
  }

  private effectiveVolume(userId: number): number {
    return clamp01((volumeFor(userId) / 100) * (readMasterVolumePercent() / 100));
  }

  private applyParticipantVolume(participant: RemoteParticipant, userId: number): void {
    const remembered = this.rememberedVolumes.get(userId);
    const effective = remembered ?? this.effectiveVolume(userId);
    const volume = this.state.deafened ? 0 : effective;
    participant.setVolume(volume, Track.Source.Microphone);
    participant.setVolume(volume, Track.Source.ScreenShareAudio);
  }

  private applyAllVolumes(): void {
    const room = this.room;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      const userId = this.resolveUserId(participant);
      if (userId === null) {
        participant.setVolume(this.state.deafened ? 0 : 1);
        continue;
      }
      this.rememberedVolumes.set(userId, this.effectiveVolume(userId));
      this.applyParticipantVolume(participant, userId);
    }
  }

  // ============ 内部：麦克风 ============

  private computeMicDesired(): boolean {
    if (!this.entered || !this.room) return false;
    const preferences = useSettingsStore.getState();
    return this.stageAllowed && this.state.micEnabled && !this.state.forceMuted && (!preferences.pttEnabled || this.state.pttActive);
  }

  private queueMicUpdate(restart = false): Promise<void> {
    if (restart) this.micOptionsDirty = true;
    this.micChain = this.micChain
      .then(() => this.performMicUpdate())
      .catch((error: unknown) => {
        console.warn("[voice] 麦克风状态更新失败", error);
      });
    return this.micChain;
  }

  private async performMicUpdate(): Promise<void> {
    const room = this.room;
    if (!room || !this.entered || room.state !== ConnectionState.Connected) return;
    const desired = this.computeMicDesired();

    // 采集/编码参数变化时必须先取消发布再重新发布：mute/unmute 不会应用新的 options
    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone) as
      | LocalTrackPublication
      | undefined;
    if (this.micOptionsDirty && publication?.track) {
      this.micOptionsDirty = false;
      try {
        await room.localParticipant.unpublishTrack(publication.track, true);
      } catch (error) {
        console.warn("[voice] 重新发布麦克风前取消发布失败", error);
      }
      if (this.room !== room) return;
      this.micActive = false;
      this.analyser.start(null);
      this.emitZeroLevel();
    } else if (!desired && this.micActive) {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch (error) {
        console.warn("[voice] 关闭麦克风失败", error);
      }
      if (this.room !== room) return;
      this.micActive = false;
      this.analyser.start(null);
      this.emitZeroLevel();
    }

    if (!this.computeMicDesired() || this.micActive) {
      await this.syncMicrophoneBitrate(room);
      return;
    }
    this.micOptionsDirty = false;
    const settings = this.audioSettings ?? DEFAULT_AUDIO_SETTINGS;
    const preferences = useSettingsStore.getState();
    try {
      const publication = await room.localParticipant.setMicrophoneEnabled(
        true,
        buildAudioCaptureOptions(settings, preferences.inputDeviceId),
        buildTrackPublishOptions(settings),
      );
      if (this.room !== room) return;
      if (!publication) throw new Error("麦克风轨道发布失败");
      this.micActive = true;
      this.setState({ hasMicrophone: true });
      this.attachMicAnalyser();
    } catch (error) {
      if (this.room !== room) return;
      const recovered = await this.retryMicrophoneWithDefaults(room, settings, error);
      if (!recovered && this.room === room) {
        this.micActive = false;
        this.setState({ hasMicrophone: false });
        this.reportMicrophoneError(error);
        return;
      }
    }
    await this.syncMicrophoneBitrate(room);
  }

  private async syncMicrophoneBitrate(room: Room): Promise<void> {
    if (this.room !== room) return;
    const sender = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack?.sender;
    const bitrate = this.state.audioSettings?.bitrate;
    if (!sender || !bitrate) return;
    const parameters = sender.getParameters();
    const encoding = parameters.encodings[0];
    if (!encoding || encoding.maxBitrate === bitrate) return;
    encoding.maxBitrate = bitrate;
    await sender.setParameters(parameters);
  }

  /** 设备被拔出/参数不支持时，退回默认设备与基础处理参数重试一次 */
  private async retryMicrophoneWithDefaults(
    room: Room,
    settings: AudioSettings,
    error: unknown,
  ): Promise<boolean> {
    const name = readErrorName(error);
    if (name !== "OverconstrainedError" && name !== "NotFoundError") return false;
    const preferences = useSettingsStore.getState();
    if (preferences.inputDeviceId !== null) preferences.update({ inputDeviceId: null });
    const capture: AudioCaptureOptions = {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
    };
    try {
      const publication = await room.localParticipant.setMicrophoneEnabled(
        true,
        capture,
        buildTrackPublishOptions(settings),
      );
      if (this.room !== room || !publication) return false;
      this.micActive = true;
      this.setState({ hasMicrophone: true });
      this.attachMicAnalyser();
      this.emit("error", { code: "mic_device_fallback", message: "所选麦克风不可用，已切换为系统默认设备。" });
      return true;
    } catch {
      return false;
    }
  }

  private attachMicAnalyser(): void {
    const room = this.room;
    if (!room || !this.micActive) {
      this.analyser.start(null);
      return;
    }
    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    this.analyser.start(publication?.track?.mediaStreamTrack ?? null);
  }

  // ============ 内部：循环任务（电平/质量） ============

  private startLoops(): void {
    this.stopLoops();
    this.levelTimer = window.setInterval(() => this.tickLevels(), LEVEL_INTERVAL_MS);
    this.statsTimer = window.setInterval(() => this.tickStats(), STATS_INTERVAL_MS);
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
    if (!this.entered || !this.room) return;
    const preferences = useSettingsStore.getState();
    const raw = this.analyser.sampleRaw();
    const level = Math.min(1, raw * LEVEL_GAIN);
    const speaking = this.computeMicDesired() && raw >= preferences.vadThreshold;
    if (speaking !== this.lastLocalSpeaking || Math.abs(level - this.lastLocalLevel) >= 0.015) {
      this.lastLocalSpeaking = speaking;
      this.lastLocalLevel = level;
      this.emit("local-level", { level, speaking });
    }
  }

  private emitZeroLevel(): void {
    if (this.lastLocalLevel === 0 && !this.lastLocalSpeaking) return;
    this.lastLocalLevel = 0;
    this.lastLocalSpeaking = false;
    this.emit("local-level", { level: 0, speaking: false });
  }

  private tickStats(): void {
    const room = this.room;
    if (!room || !this.entered) return;
    const present = new Set<number>();
    if (this.myUserId !== null) {
      present.add(this.myUserId);
      this.emitPeerStats(this.myUserId, this.qualityOf(room.localParticipant.identity));
    }
    for (const participant of room.remoteParticipants.values()) {
      const userId = this.resolveUserId(participant);
      if (userId === null) continue;
      present.add(userId);
      this.emitPeerStats(userId, this.qualityOf(participant.identity));
    }
    for (const userId of [...this.latestStats.keys()]) {
      if (!present.has(userId)) this.latestStats.delete(userId);
    }
  }

  private qualityOf(identity: string): VoiceQuality {
    return this.qualityByParticipant.get(identity) ?? "unknown";
  }

  private emitPeerStats(userId: number, quality: VoiceQuality): void {
    const stats: PeerNetworkStats = {
      userId,
      rttMs: null,
      packetLossPct: null,
      jitterMs: null,
      inboundKbps: 0,
      outboundKbps: 0,
      quality,
    };
    this.latestStats.set(userId, stats);
    this.emit("peer-stats", stats);
  }

  // ============ 内部：自动播放解锁 ============

  private installAutoplayUnlock(): void {
    if (this.unlockHandler) return;
    const handler = (): void => {
      void this.resumeAudio();
    };
    this.unlockHandler = handler;
    document.addEventListener("pointerdown", handler, true);
    document.addEventListener("keydown", handler, true);
  }

  private removeAutoplayUnlock(): void {
    const handler = this.unlockHandler;
    if (!handler) return;
    document.removeEventListener("pointerdown", handler, true);
    document.removeEventListener("keydown", handler, true);
    this.unlockHandler = null;
  }

  private handleAudioPlaybackStatus(playable: boolean): void {
    this.setState({ audioBlocked: !playable });
    if (playable) this.removeAutoplayUnlock();
    else this.installAutoplayUnlock();
  }

  // ============ 内部：清理 ============

  private async shutdownRoom(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.localIdentity = null;
    this.stopLoops();
    this.analyser.cleanup();
    this.detachAllRemoteAudio();
    this.removeAutoplayUnlock();
    this.localScreenStream = null;
    this.qualityByParticipant.clear();
    this.participantIds.clear();
    this.latestStats.clear();
    this.rememberedVolumes.clear();
    this.remoteAudioStreams.clear();
    this.remoteScreenStreams.clear();
    this.micActive = false;
    this.micOptionsDirty = false;
    this.emit("screen-stream", { userId: null, stream: null });
    this.emitZeroLevel();
    this.removeAudioContainer();
    if (room) await this.disposeRoom(room);
  }

  private async disposeRoom(room: Room): Promise<void> {
    try {
      room.removeAllListeners();
    } catch {
      /* ignore */
    }
    try {
      await room.disconnect();
    } catch {
      /* ignore */
    }
  }

  private bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function createAudioContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.setAttribute("data-airmic-remote-audio", "true");
  container.style.cssText = "position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;opacity:0;";
  document.body.append(container);
  return container;
}

function describeDisconnectReason(reason?: DisconnectReason): string {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "你的账号在另一个页面加入了语音，当前语音已断开。";
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "你已被移出语音房间。";
    case DisconnectReason.ROOM_DELETED:
      return "语音房间已结束。";
    case DisconnectReason.SERVER_SHUTDOWN:
      return "语音服务器已关闭，请稍后重试。";
    case DisconnectReason.CLIENT_INITIATED:
      return "语音连接已断开。";
    default:
      return "语音连接已断开，请刷新页面后重试。";
  }
}

/** 播放一声短促测试音（设置页使用） */
async function playTestTone(): Promise<boolean> {
  const AudioContextCtor = window.AudioContext;
  if (typeof AudioContextCtor !== "function") return false;
  let context: AudioContext;
  try {
    context = new AudioContextCtor();
  } catch {
    return false;
  }
  try {
    if (context.state !== "running") {
      const resume = context.resume().catch(() => undefined);
      await Promise.race([
        resume,
        new Promise<void>((resolve) => window.setTimeout(resolve, 500)),
      ]);
    }
    if (context.state !== "running") {
      void context.close().catch(() => undefined);
      return false;
    }
    const outputDeviceId = useSettingsStore.getState().outputDeviceId;
    if (outputDeviceId) {
      const sinkContext = context as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
      if (typeof sinkContext.setSinkId === "function") {
        await sinkContext.setSinkId(outputDeviceId).catch(() => undefined);
      }
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
      void context.close().catch(() => undefined);
    });
    return true;
  } catch {
    void context.close().catch(() => undefined);
    return false;
  }
}

export const voice = new VoiceEngine();
export type VoiceEngineType = VoiceEngine;

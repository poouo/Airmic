import type { AudioSettings, IceCandidatePayload, SignalPayload } from "@airmic/shared";
import { tuneAudioSdp } from "./sdp";
import { PeerStatsCollector } from "./stats";
import type { PeerNetworkStats } from "./types";

/** 引擎提供给 PeerLink 的上下文 */
export interface PeerLinkOptions {
  userId: number;
  displayName: string;
  /** true = 本次加入房间的新成员，负责发起首个 offer；false = 已有成员，作为应答方 */
  initiator: boolean;
  getRtcConfiguration: () => RTCConfiguration;
  getAudioSettings: () => AudioSettings;
  getMicrophoneTrack: () => MediaStreamTrack | null;
  getScreenTrack: () => MediaStreamTrack | null;
  sendSignal: (to: number, payload: SignalPayload) => void;
  onRemoteAudio: (userId: number, stream: MediaStream | null) => void;
  onRemoteScreen: (userId: number, stream: MediaStream | null) => void;
  onConnectionFailed: (userId: number) => void;
}

/** 屏幕共享视频发送上限（2.5 Mbps） */
const VIDEO_MAX_BITRATE = 2_500_000;
/** ICE 断开后最多尝试几次重启 */
const ICE_RESTART_LIMIT = 3;
/** disconnected 状态持续多久后尝试 ICE 重启 */
const RECOVER_TIMEOUT_MS = 7000;
/** offer 创建失败时的最大重试次数 */
const NEGOTIATION_RETRY_LIMIT = 5;

/**
 * 一对用户之间的 WebRTC 连接（Mesh 的一条边）。
 *
 * 采用 perfect negotiation：
 *  - 新加入者（initiator=true）是 impolite 一方，主动发起首个 offer；
 *  - 已有成员是 polite 一方，冲突时 rollback 并应答；
 *  - 双方都通过 trickle ICE 逐条发送候选；
 *  - 每个连接预置 audio（本机麦克风）与 video（屏幕共享，平时 replaceTrack(null)）transceiver。
 */
export class PeerLink {
  readonly userId: number;
  readonly displayName: string;
  readonly initiator: boolean;

  private readonly options: PeerLinkOptions;
  private readonly stats: PeerStatsCollector;
  private pc: RTCPeerConnection | null = null;
  private audioTransceiver: RTCRtpTransceiver | null = null;
  private videoTransceiver: RTCRtpTransceiver | null = null;
  private signalChain: Promise<void> = Promise.resolve();
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteAudioStream: MediaStream | null = null;
  private remoteScreenStream: MediaStream | null = null;

  private started = false;
  private closed = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private negotiating = false;
  private negotiationTimer: number | null = null;
  private negotiationFailures = 0;
  private negotiatedOnce = false;
  private renegotiateAfterAnswer = false;
  private pendingRenegotiationRequest = false;
  private iceRestartPending = false;
  private lastOfferHadIceRestart = false;
  private iceRestartAttempts = 0;
  private recoverTimer: number | null = null;
  private failureReported = false;

  constructor(options: PeerLinkOptions) {
    this.options = options;
    this.userId = options.userId;
    this.displayName = options.displayName;
    this.initiator = options.initiator;
    this.stats = new PeerStatsCollector(options.userId);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** 创建 PeerConnection、预置 transceiver 并挂载事件（幂等） */
  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    let connection: RTCPeerConnection;
    try {
      connection = new RTCPeerConnection(this.options.getRtcConfiguration());
    } catch (error) {
      console.warn("[voice] 无法创建 PeerConnection", error);
      this.reportFailure();
      return;
    }
    this.pc = connection;

    const settings = this.options.getAudioSettings();
    const microphone = this.options.getMicrophoneTrack();
    this.audioTransceiver = connection.addTransceiver(microphone ?? "audio", {
      direction: "sendrecv",
      sendEncodings: [{ maxBitrate: settings.bitrate }],
    });
    this.videoTransceiver = connection.addTransceiver("video", { direction: "sendrecv" });
    const screenTrack = this.options.getScreenTrack();
    if (screenTrack) void this.setVideoTrack(screenTrack);

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate: IceCandidatePayload = {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? null,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
        usernameFragment: event.candidate.usernameFragment ?? null,
      };
      this.options.sendSignal(this.userId, { kind: "candidate", candidate });
    };
    connection.ontrack = (event) => this.handleTrack(event);
    connection.onnegotiationneeded = () => this.handleNegotiationNeeded();
    connection.oniceconnectionstatechange = () => this.handleIceConnectionState();
    connection.onconnectionstatechange = () => this.handleConnectionState();

    if (this.initiator) this.scheduleNegotiation(0);
  }

  /** 处理服务端转发来的信令（同一连接内串行处理，避免候选/描述乱序） */
  handleSignal(payload: SignalPayload): Promise<void> {
    this.signalChain = this.signalChain
      .then(() => this.processSignal(payload))
      .catch((error: unknown) => {
        console.warn("[voice] 处理信令失败", this.userId, error);
      });
    return this.signalChain;
  }

  /** 更新本连接发送的麦克风轨道（切换设备时无需重新协商） */
  async setAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    const transceiver = this.audioTransceiver;
    if (!transceiver || this.closed) return;
    try {
      await transceiver.sender.replaceTrack(track);
    } catch (error) {
      console.warn("[voice] 替换麦克风轨道失败", error);
      return;
    }
    await this.applyAudioParameters();
  }

  /** 更新本连接发送的屏幕视频轨道（共享/停止时无需重新协商） */
  async setVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    const transceiver = this.videoTransceiver;
    if (!transceiver || this.closed) return;
    try {
      await transceiver.sender.replaceTrack(track);
    } catch (error) {
      console.warn("[voice] 替换屏幕轨道失败", error);
      return;
    }
    await this.applyVideoParameters();
  }

  /** 码率变化即时生效（setParameters） */
  async applyAudioParameters(): Promise<void> {
    await this.applySenderBitrate(this.audioTransceiver, this.options.getAudioSettings().bitrate);
  }

  /** fmtp 变化（立体声/DTX/FEC/采样率）通过重新协商尝试生效 */
  requestRenegotiation(delayMs = 0): void {
    if (this.closed) return;
    this.scheduleNegotiation(delayMs);
  }

  /** 连接故障时发起 ICE restart */
  restartIce(): void {
    if (this.closed) return;
    this.iceRestartPending = true;
    this.scheduleNegotiation(0);
  }

  async getStats(): Promise<PeerNetworkStats> {
    const connection = this.pc;
    if (!connection || this.closed) {
      return {
        userId: this.userId,
        rttMs: null,
        packetLossPct: null,
        jitterMs: null,
        inboundKbps: 0,
        outboundKbps: 0,
        quality: "unknown",
      };
    }
    return this.stats.collect(connection);
  }

  getRemoteAudioStream(): MediaStream | null {
    return this.remoteAudioStream;
  }

  getRemoteScreenStream(): MediaStream | null {
    return this.remoteScreenStream;
  }

  /** 关闭连接并释放资源（幂等） */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearNegotiationTimer();
    this.clearRecoverTimer();
    const connection = this.pc;
    this.pc = null;
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.onnegotiationneeded = null;
      connection.oniceconnectionstatechange = null;
      connection.onconnectionstatechange = null;
      connection.onsignalingstatechange = null;
      try {
        connection.close();
      } catch {
        /* ignore */
      }
    }
    this.pendingCandidates = [];
    this.audioTransceiver = null;
    this.videoTransceiver = null;
    if (this.remoteAudioStream) {
      this.remoteAudioStream = null;
      this.options.onRemoteAudio(this.userId, null);
    }
    if (this.remoteScreenStream) {
      this.remoteScreenStream = null;
      this.options.onRemoteScreen(this.userId, null);
    }
  }

  // ============ 信令处理 ============

  private async processSignal(payload: SignalPayload): Promise<void> {
    const connection = this.pc;
    if (!connection || this.closed) return;
    if (payload.kind === "candidate") {
      if (this.ignoreOffer) return;
      await this.handleCandidate(payload.candidate);
      return;
    }

    const description: RTCSessionDescriptionInit = { type: payload.kind, sdp: payload.sdp };
    const readyForOffer = !this.makingOffer && connection.signalingState === "stable";
    const offerCollision = description.type === "offer" && !readyForOffer;
    const polite = !this.initiator;
    this.ignoreOffer = !polite && offerCollision;
    if (this.ignoreOffer) {
      // impolite 一方忽略对方并发的 offer，等自己的 offer 被应答后再重新协商一次
      this.renegotiateAfterAnswer = true;
      this.scheduleNegotiation(400);
      return;
    }

    if (offerCollision) {
      // polite 一方 rollback 自己的 offer，接受对方 offer
      await Promise.all([
        connection.setLocalDescription({ type: "rollback" }),
        connection.setRemoteDescription(description),
      ]);
      if (this.lastOfferHadIceRestart) this.iceRestartPending = true;
    } else {
      await connection.setRemoteDescription(description);
    }

    if (description.type === "offer") {
      const answer = await connection.createAnswer();
      const sdp = tuneAudioSdp(answer.sdp ?? "", this.options.getAudioSettings());
      if (!sdp) throw new Error("answer SDP 为空");
      await connection.setLocalDescription({ type: "answer", sdp });
      this.options.sendSignal(this.userId, { kind: "answer", sdp });
      this.negotiatedOnce = true;
      this.negotiationFailures = 0;
      this.iceRestartAttempts = 0;
      this.failureReported = false;
      await this.flushCandidates();
      await this.applyAudioParameters();
      this.refreshRemoteStreams();
      if (offerCollision) this.scheduleNegotiation(250);
      if (this.pendingRenegotiationRequest) {
        this.pendingRenegotiationRequest = false;
        this.scheduleNegotiation(250);
      }
      return;
    }

    // 收到 answer：本方的 offer 已被接受
    this.negotiatedOnce = true;
    this.ignoreOffer = false;
    this.negotiationFailures = 0;
    this.iceRestartAttempts = 0;
    this.failureReported = false;
    await this.flushCandidates();
    await this.applyAudioParameters();
    this.refreshRemoteStreams();
    if (this.renegotiateAfterAnswer) {
      this.renegotiateAfterAnswer = false;
      this.scheduleNegotiation(200);
    }
    if (this.pendingRenegotiationRequest) {
      this.pendingRenegotiationRequest = false;
      this.scheduleNegotiation(250);
    }
  }

  private async handleCandidate(candidate: IceCandidatePayload): Promise<void> {
    const connection = this.pc;
    if (!connection || this.closed) return;
    if (!candidate.candidate) return;
    const init: RTCIceCandidateInit = {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      usernameFragment: candidate.usernameFragment ?? null,
    };
    if (!connection.remoteDescription) {
      this.pendingCandidates.push(init);
      return;
    }
    try {
      await connection.addIceCandidate(init);
    } catch (error) {
      if (!this.ignoreOffer) console.warn("[voice] 添加 ICE 候选失败", this.userId, error);
    }
  }

  private async flushCandidates(): Promise<void> {
    const connection = this.pc;
    if (!connection) return;
    const candidates = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of candidates) {
      try {
        await connection.addIceCandidate(candidate);
      } catch (error) {
        if (!this.ignoreOffer) console.warn("[voice] 添加缓存的 ICE 候选失败", this.userId, error);
      }
    }
  }

  private handleTrack(event: RTCTrackEvent): void {
    const track = event.track;
    track.addEventListener("ended", () => {
      if (this.closed) return;
      if (track.kind === "video") this.setRemoteScreenStream(null);
      else if (track.kind === "audio") this.setRemoteAudioStream(null);
    });
    this.refreshRemoteStreams();
  }

  /** 从接收器中提取远端音视频流并通过回调交给引擎 */
  private refreshRemoteStreams(): void {
    const connection = this.pc;
    if (!connection || this.closed) return;
    let audioTrack: MediaStreamTrack | null = null;
    let videoTrack: MediaStreamTrack | null = null;
    for (const receiver of connection.getReceivers()) {
      const track = receiver.track;
      if (!track) continue;
      if (track.kind === "audio" && audioTrack === null) audioTrack = track;
      if (track.kind === "video" && videoTrack === null) videoTrack = track;
    }
    if (audioTrack) this.setRemoteAudioStream(new MediaStream([audioTrack]));
    if (videoTrack) this.setRemoteScreenStream(new MediaStream([videoTrack]));
  }

  private setRemoteAudioStream(stream: MediaStream | null): void {
    if (this.closed) return;
    const current = this.remoteAudioStream?.getAudioTracks()[0] ?? null;
    const next = stream?.getAudioTracks()[0] ?? null;
    if (current === next) return;
    this.remoteAudioStream = stream;
    this.options.onRemoteAudio(this.userId, stream);
  }

  private setRemoteScreenStream(stream: MediaStream | null): void {
    if (this.closed) return;
    const current = this.remoteScreenStream?.getVideoTracks()[0] ?? null;
    const next = stream?.getVideoTracks()[0] ?? null;
    if (current === next) return;
    this.remoteScreenStream = stream;
    this.options.onRemoteScreen(this.userId, stream);
  }

  // ============ 协商 ============

  private handleNegotiationNeeded(): void {
    if (this.closed) return;
    // 应答方等待首个 offer，避免双方同时 offer 造成无谓的 glare
    if (!this.negotiatedOnce && !this.initiator) return;
    this.scheduleNegotiation(0);
  }

  private scheduleNegotiation(delayMs: number): void {
    if (this.closed || this.negotiationTimer !== null) return;
    this.negotiationTimer = window.setTimeout(() => {
      this.negotiationTimer = null;
      void this.negotiate();
    }, Math.max(0, delayMs));
  }

  private async negotiate(): Promise<void> {
    const connection = this.pc;
    if (!connection || this.closed) return;
    if (!this.negotiatedOnce && !this.initiator) return;
    if (this.negotiating) {
      this.pendingRenegotiationRequest = true;
      this.scheduleNegotiation(120);
      return;
    }
    if (connection.signalingState !== "stable") {
      // 协商进行中：等 offer/answer 处理完成后重新安排一次
      this.pendingRenegotiationRequest = true;
      return;
    }
    this.negotiating = true;
    this.makingOffer = true;
    try {
      const restart = this.iceRestartPending;
      const offer = await connection.createOffer(restart ? { iceRestart: true } : undefined);
      this.lastOfferHadIceRestart = restart;
      this.iceRestartPending = false;
      const sdp = tuneAudioSdp(offer.sdp ?? "", this.options.getAudioSettings());
      if (!sdp) throw new Error("offer SDP 为空");
      await connection.setLocalDescription({ type: "offer", sdp });
      this.options.sendSignal(this.userId, { kind: "offer", sdp });
      this.negotiationFailures = 0;
      await this.applyAudioParameters();
    } catch (error) {
      this.negotiationFailures += 1;
      console.warn("[voice] 创建 offer 失败", this.userId, error);
      if (this.negotiationFailures >= NEGOTIATION_RETRY_LIMIT) {
        this.reportFailure();
      } else {
        this.scheduleNegotiation(400 * this.negotiationFailures);
      }
    } finally {
      this.makingOffer = false;
      this.negotiating = false;
    }
  }

  // ============ 连接状态与恢复 ============

  private handleIceConnectionState(): void {
    const connection = this.pc;
    if (!connection || this.closed) return;
    const state = connection.iceConnectionState;
    if (state === "failed") {
      this.attemptIceRestart();
      return;
    }
    if (state === "disconnected") {
      this.scheduleRecover();
      return;
    }
    if (state === "connected" || state === "completed") {
      this.clearRecoverTimer();
      this.iceRestartAttempts = 0;
      this.failureReported = false;
    }
  }

  private handleConnectionState(): void {
    const connection = this.pc;
    if (!connection || this.closed) return;
    const state = connection.connectionState;
    if (state === "failed") {
      this.attemptIceRestart();
    } else if (state === "connected") {
      this.clearRecoverTimer();
      this.iceRestartAttempts = 0;
      this.failureReported = false;
    }
  }

  private scheduleRecover(): void {
    if (this.closed || this.recoverTimer !== null) return;
    this.recoverTimer = window.setTimeout(() => {
      this.recoverTimer = null;
      const connection = this.pc;
      if (!connection || this.closed) return;
      const state = connection.iceConnectionState;
      if (state === "disconnected" || state === "failed") this.attemptIceRestart();
    }, RECOVER_TIMEOUT_MS);
  }

  private attemptIceRestart(): void {
    if (this.closed) return;
    this.clearRecoverTimer();
    if (this.iceRestartAttempts >= ICE_RESTART_LIMIT) {
      this.reportFailure();
      return;
    }
    this.iceRestartAttempts += 1;
    this.info("第 " + this.iceRestartAttempts + " 次尝试恢复语音连接");
    this.iceRestartPending = true;
    this.scheduleNegotiation(0);
  }

  private reportFailure(): void {
    if (this.closed || this.failureReported) return;
    this.failureReported = true;
    this.options.onConnectionFailed(this.userId);
  }

  private clearRecoverTimer(): void {
    if (this.recoverTimer !== null) {
      window.clearTimeout(this.recoverTimer);
      this.recoverTimer = null;
    }
  }

  private clearNegotiationTimer(): void {
    if (this.negotiationTimer !== null) {
      window.clearTimeout(this.negotiationTimer);
      this.negotiationTimer = null;
    }
  }

  // ============ SDP / 发送参数 ============

  private async applySenderBitrate(transceiver: RTCRtpTransceiver | null, bitrate: number): Promise<void> {
    const sender = transceiver?.sender;
    if (!sender || this.closed) return;
    try {
      const parameters = sender.getParameters();
      if (parameters.encodings.length === 0) parameters.encodings = [{}];
      const encoding = parameters.encodings[0];
      if (!encoding) return;
      encoding.maxBitrate = bitrate;
      encoding.networkPriority = "high";
      await sender.setParameters(parameters);
    } catch {
      /* 协商完成前设置参数会失败，忽略即可（应答/offer 完成后会再次调用） */
    }
  }

  private async applyVideoParameters(): Promise<void> {
    const sender = this.videoTransceiver?.sender;
    if (!sender || !sender.track || this.closed) return;
    try {
      const parameters = sender.getParameters();
      parameters.degradationPreference = "maintain-framerate";
      if (parameters.encodings.length === 0) parameters.encodings = [{}];
      const encoding = parameters.encodings[0];
      if (!encoding) return;
      encoding.maxBitrate = VIDEO_MAX_BITRATE;
      await sender.setParameters(parameters);
    } catch {
      /* ignore */
    }
  }

  private info(message: string): void {
    console.info("[voice] " + this.displayName + "：" + message);
  }
}

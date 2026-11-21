import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Mic2, MicOff, Volume2, WifiOff, X } from "lucide-react";
import type { PeerInfo, PeerStatePatch, Role, UserSelf } from "@airmic/shared";
import { canManageRoomScope } from "@airmic/shared";
import ChatPanel from "@/components/chat/ChatPanel";
import { canEditRoom } from "@/components/lobby/access";
import RoomEditor from "@/components/lobby/RoomEditor";
import { JoinGate } from "@/components/room/JoinGate";
import { RoomControls } from "@/components/room/RoomControls";
import { RoomHeader } from "@/components/room/RoomHeader";
import RoomMembersModal from "@/components/room/RoomMembersModal";
import RoomCodeShareModal from "@/components/room/RoomCodeShareModal";
import { RoomStage } from "@/components/room/RoomStage";
import { Avatar, Button } from "@/components/ui";
import type { RoomMember } from "@/components/room/types";
import { playJoinSound, playLeaveSound } from "@/components/room/sounds";
import { useLocalSpeaking, usePeerStats, useScreenStreams, useVoiceState } from "@/components/room/useVoice";
import { socket } from "@/lib/ws";
import { cn } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useRoomStore } from "@/stores/room";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { voice } from "@/voice/engine";
import type { VoiceStateSnapshot } from "@/voice/engine";

const ROLE_RANK: Record<Role, number> = { admin: 0, moderator: 1, user: 2, guest: 3 };
/** 状态上报节流：最多约 5 次/秒 */
const STATE_THROTTLE_MS = 200;

/** 房间语音页 */
export default function RoomPage() {
  const navigate = useNavigate();
  const params = useParams();
  const roomId = Number(params.roomId);
  const roomIdValid = Number.isInteger(roomId) && roomId > 0;

  const snapshot = useRoomStore((state) => state.snapshot);
  const peers = useRoomStore((state) => state.peers);
  const joining = useRoomStore((state) => state.joining);
  const joinError = useRoomStore((state) => state.joinError);
  const screenSharerId = useRoomStore((state) => state.screenSharerId);
  const codeRevealRoomId = useRoomStore((state) => state.codeRevealRoomId);
  const stageUsers = useRoomStore((state) => state.stageUsers);
  const stageRequests = useRoomStore((state) => state.stageRequests);
  const me = useAuthStore((state) => state.user);
  const server = useAppStore((state) => state.server);
  const connection = useAppStore((state) => state.connection);
  const rooms = useAppStore((state) => state.rooms);
  const directory = useAppStore((state) => state.directory);
  const selfState = useVoiceState();
  const localSpeaking = useLocalSpeaking();
  const peerStats = usePeerStats();
  const screenStreams = useScreenStreams();
  const perUserVolume = useSettingsStore((state) => state.perUserVolume ?? {});
  const pttEnabled = useSettingsStore((state) => state.pttEnabled);
  const pttKey = useSettingsStore((state) => state.pttKey);

  const [chatOpen, setChatOpen] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [shareBusy, setShareBusy] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [managingMembersIn, setManagingMembersIn] = useState<number | null>(null);
  const [viewingCodeIn, setViewingCodeIn] = useState<number | null>(null);

  const room = snapshot !== null && snapshot.room.id === roomId ? snapshot.room : null;
  const inRoom = room !== null;
  const stageMode = room?.voiceMode === "stage";
  const selfStage = me ? stageUsers[me.id] ?? {
    onStage: snapshot?.selfOnStage ?? false,
    pending: snapshot?.selfStageRequested ?? false,
  } : { onStage: false, pending: false };
  const roomName = room?.name ?? rooms.find((item) => item.id === roomId)?.name ?? null;
  const inviteCode = inRoom ? snapshot?.inviteCode : undefined;

  useEffect(() => {
    if (codeRevealRoomId !== roomId || !inviteCode) return;
    setViewingCodeIn(roomId);
    useRoomStore.setState({ codeRevealRoomId: null });
  }, [codeRevealRoomId, inviteCode, roomId]);

  // ============ 加入房间 ============
  useEffect(() => {
    if (!roomIdValid) {
      navigate("/", { replace: true });
      return;
    }
    const state = useRoomStore.getState();
    if (state.snapshot?.room.id === roomId) return;
    // 已经发起过同一房间的加入请求（例如大厅带密码加入后立即跳转），等待 room_joined 即可
    if (state.lastJoin?.roomId === roomId) return;
    state.joinRoom(roomId);
  }, [navigate, roomId, roomIdValid]);

  // ============ 被踢/房间被删除：快照变空后返回大厅 ============
  const joinedRoomRef = useRef<number | null>(null);
  useEffect(() => {
    if (inRoom) {
      joinedRoomRef.current = roomId;
      return;
    }
    if (joinedRoomRef.current !== roomId || joining || snapshot?.room.codeOnly) return;
    joinedRoomRef.current = null;
    navigate("/", { replace: true });
  }, [inRoom, joining, navigate, roomId, snapshot?.room.codeOnly]);

  // ============ 状态上报（节流 ≤5 次/秒） ============
  const stateQueueRef = useRef<PeerStatePatch>({});
  const stateTimerRef = useRef<number | null>(null);
  const lastStateSendRef = useRef(0);

  const sendState = useCallback((patch: PeerStatePatch) => {
    stateQueueRef.current = { ...stateQueueRef.current, ...patch };
    const flush = () => {
      stateTimerRef.current = null;
      const merged = stateQueueRef.current;
      stateQueueRef.current = {};
      if (Object.keys(merged).length === 0) return;
      lastStateSendRef.current = Date.now();
      socket.send({ t: "state", state: merged });
    };
    const elapsed = Date.now() - lastStateSendRef.current;
    if (elapsed >= STATE_THROTTLE_MS) {
      flush();
    } else if (stateTimerRef.current === null) {
      stateTimerRef.current = window.setTimeout(flush, STATE_THROTTLE_MS - elapsed);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (stateTimerRef.current !== null) {
        window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = null;
      }
    };
  }, []);

  const effectiveMuted = useMemo(
    () =>
      !selfState.micEnabled ||
      !selfState.hasMicrophone ||
      selfState.forceMuted ||
      (stageMode && !selfStage.onStage) ||
      (pttEnabled && !selfState.pttActive),
    [selfState.micEnabled, selfState.hasMicrophone, selfState.forceMuted, selfState.pttActive, pttEnabled, stageMode, selfStage.onStage],
  );

  const reportedMuteRef = useRef<{ roomId: number; muted: boolean; deafened: boolean } | null>(null);
  const reportedSpeakingRef = useRef<{ roomId: number; speaking: boolean } | null>(null);
  const reportedScreenRef = useRef<{ roomId: number; sharing: boolean } | null>(null);

  // 重连/重新加入房间后，新的服务端连接是默认状态，需要重新上报一次
  const [syncToken, setSyncToken] = useState(0);
  const lastSnapshotRef = useRef(snapshot);
  useEffect(() => {
    if (lastSnapshotRef.current === snapshot) return;
    lastSnapshotRef.current = snapshot;
    if (snapshot === null) return;
    reportedMuteRef.current = null;
    reportedSpeakingRef.current = null;
    reportedScreenRef.current = null;
    setSyncToken((value) => value + 1);
  }, [snapshot]);

  // 麦克风与收听状态上报（首次进入时上报一次）
  useEffect(() => {
    if (!inRoom) {
      reportedMuteRef.current = null;
      return;
    }
    const previous = reportedMuteRef.current;
    if (previous !== null && previous.roomId === roomId && previous.muted === effectiveMuted && previous.deafened === selfState.deafened) {
      return;
    }
    const patch: PeerStatePatch = {};
    if (previous === null || previous.roomId !== roomId || previous.muted !== effectiveMuted) patch.muted = effectiveMuted;
    if (previous === null || previous.roomId !== roomId || previous.deafened !== selfState.deafened) {
      patch.deafened = selfState.deafened;
    }
    reportedMuteRef.current = { roomId, muted: effectiveMuted, deafened: selfState.deafened };
    sendState(patch);
  }, [inRoom, roomId, effectiveMuted, selfState.deafened, sendState, syncToken]);

  // 说话状态上报
  useEffect(() => {
    if (!inRoom) {
      reportedSpeakingRef.current = null;
      return;
    }
    const previous = reportedSpeakingRef.current;
    if (previous !== null && previous.roomId === roomId && previous.speaking === localSpeaking) return;
    reportedSpeakingRef.current = { roomId, speaking: localSpeaking };
    sendState({ speaking: localSpeaking });
  }, [inRoom, roomId, localSpeaking, sendState, syncToken]);

  // 屏幕共享状态与服务器同步（浏览器自带"停止共享"时也能通知服务端）
  useEffect(() => {
    if (!inRoom) {
      reportedScreenRef.current = null;
      return;
    }
    const previous = reportedScreenRef.current;
    if (previous === null || previous.roomId !== roomId) {
      reportedScreenRef.current = { roomId, sharing: selfState.screenSharing };
      return;
    }
    if (previous.sharing === selfState.screenSharing) return;
    reportedScreenRef.current = { roomId, sharing: selfState.screenSharing };
    socket.send({ t: "screen_share", active: selfState.screenSharing });
  }, [inRoom, roomId, selfState.screenSharing, syncToken]);

  // 成员进出的界面提示音
  const previousPeerCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!inRoom) {
      previousPeerCountRef.current = null;
      return;
    }
    const count = peers.length;
    const previous = previousPeerCountRef.current;
    previousPeerCountRef.current = count;
    if (previous === null || previous === count) return;
    if (!useSettingsStore.getState().soundsEnabled) return;
    if (count > previous) playJoinSound();
    else playLeaveSound();
  }, [inRoom, peers.length]);

  // 语音引擎错误提示
  useEffect(
    () =>
      voice.on("error", (payload) => {
        if (payload.code === "screen_share_cancelled") return;
        if (payload.code === "voice_unavailable" && useAppStore.getState().server?.voiceAvailable === false) return;
        const type =
          payload.code.startsWith("screen_share") || payload.code === "mic_device_fallback" ? "warning" : "error";
        useUiStore.getState().toast(payload.message, type);
      }),
    [],
  );

  // 服务端拒绝屏幕共享（被占用/被禁用）时回滚本地共享
  useEffect(
    () =>
      socket.on("error", (message) => {
        if (message.request !== "screen_share") return;
        setShareBusy(false);
        if (voice.getState().screenSharing) {
          reportedScreenRef.current = null;
          void voice.setScreenSharing(false);
        }
      }),
    [],
  );

  // ============ PTT 按键 ============
  useEffect(() => {
    if (!pttEnabled || !inRoom) {
      voice.setPTTActive(false);
      return;
    }
    const isEditable = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const press = (event: KeyboardEvent) => {
      if (event.code !== pttKey || event.repeat) return;
      if (event.isComposing || isEditable(event.target)) return;
      const current = voice.getState();
      if (current.forceMuted || (stageMode && !selfStage.onStage) || !current.micEnabled || !current.hasMicrophone) return;
      event.preventDefault();
      voice.setPTTActive(true);
      sendState({ muted: false });
    };
    const release = (event: KeyboardEvent) => {
      if (event.code !== pttKey || !voice.getState().pttActive) return;
      voice.setPTTActive(false);
      sendState({ muted: true });
    };
    const releaseAll = () => {
      if (!voice.getState().pttActive) return;
      voice.setPTTActive(false);
      sendState({ muted: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") releaseAll();
    };
    window.addEventListener("keydown", press);
    window.addEventListener("keyup", release);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", press);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibility);
      voice.setPTTActive(false);
    };
  }, [pttEnabled, pttKey, inRoom, sendState, stageMode, selfStage.onStage]);

  // ============ 操作 ============
  const handleLeave = useCallback(() => {
    useRoomStore.getState().leaveRoom();
    navigate("/");
  }, [navigate]);

  const handleBack = useCallback(() => {
    const state = useRoomStore.getState();
    if (state.snapshot?.room.id === roomId) state.leaveRoom();
    navigate("/");
  }, [navigate, roomId]);

  const handleToggleMic = useCallback(() => {
    if (stageMode && !selfStage.onStage) return;
    if (selfState.forceMuted) {
      useUiStore.getState().toast("已被管理员静音", "warning");
      return;
    }
    // 已关闭或没有可用麦克风时点击 = 开启/重试，否则 = 静音
    voice.setMicEnabled(selfState.micEnabled === false || selfState.hasMicrophone === false);
  }, [selfState.forceMuted, selfState.micEnabled, selfState.hasMicrophone, stageMode, selfStage.onStage]);

  const handleToggleStage = useCallback(() => {
    if (selfStage.onStage) {
      voice.applyStageAccess(false);
      socket.send({ t: "stage_leave" });
    } else if (selfStage.pending) {
      socket.send({ t: "stage_leave" });
    } else if (socket.send({ t: "stage_request" })) {
      useUiStore.getState().toast("已申请上麦", "success", undefined, 2500);
    }
  }, [selfStage.onStage, selfStage.pending]);

  const handleStageApproval = useCallback((userId: number, approved: boolean) => {
    socket.send({ t: "stage_approve", userId, approved });
  }, []);

  const handleToggleDeafen = useCallback(() => {
    voice.setDeafened(!selfState.deafened);
  }, [selfState.deafened]);

  const canShare = room !== null && room.screenShareEnabled !== false && server?.allowScreenShare !== false && (screenSharerId === null || screenSharerId === me?.id);

  const handleToggleScreenShare = useCallback(async () => {
    if (shareBusy) return;
    if (!canShare && !selfState.screenSharing) {
      useUiStore.getState().toast("暂时无法共享屏幕", "warning");
      return;
    }
    setShareBusy(true);
    try {
      if (selfState.screenSharing) {
        await voice.setScreenSharing(false);
        reportedScreenRef.current = { roomId, sharing: false };
        socket.send({ t: "screen_share", active: false });
      } else {
        const started = await voice.setScreenSharing(true);
        if (started) {
          reportedScreenRef.current = { roomId, sharing: true };
          socket.send({ t: "screen_share", active: true });
        }
      }
    } finally {
      setShareBusy(false);
    }
  }, [canShare, roomId, selfState.screenSharing, shareBusy]);

  const handleVolumeChange = useCallback((userId: number, volume: number) => {
    useSettingsStore.getState().setUserVolume(userId, volume);
    voice.setPeerVolume(userId, volume);
  }, []);

  const handleLocalMute = useCallback((userId: number, muted: boolean) => {
    const volume = muted ? 0 : 100;
    useSettingsStore.getState().setUserVolume(userId, volume);
    voice.setPeerVolume(userId, volume);
  }, []);

  const handleToggleChat = useCallback(() => setChatOpen((open) => !open), []);

  const handleOpenSettings = useCallback(() => {
    useUiStore.getState().openModal("settings");
  }, []);

  // ============ 成员列表 ============
  const members = useMemo<RoomMember[]>(() => {
    const selfMember = me ? buildSelfMember(me, selfState, localSpeaking, stageMode, selfStage.onStage, selfStage.pending) : null;
    const others = peers
      .filter((peer) => peer.userId !== me?.id)
      .map(peerToMember)
      .sort(compareMembers);
    return selfMember ? [selfMember, ...others] : others;
  }, [me, peers, selfState, localSpeaking, stageMode, selfStage.onStage, selfStage.pending]);

  // 服务端不会把自己的 screenSharing 广播回来，自己共享时以引擎状态为准
  const activeSharerId = selfState.screenSharing && me ? me.id : screenSharerId;
  const screenSharer = useMemo(() => members.find((member) => member.userId === activeSharerId) ?? null, [members, activeSharerId]);
  const screenStream = screenSharer && !screenSharer.isSelf ? screenStreams[screenSharer.userId] ?? null : null;

  const peerStatsList = useMemo(() => Object.values(peerStats), [peerStats]);
  const capacity = room === null ? 0 : room.maxUsers > 0 ? room.maxUsers : server?.maxUsersPerRoom ?? 0;

  // ============ 渲染 ============
  if (!roomIdValid) return null;

  if (!inRoom) {
    return (
      <JoinGate
        roomName={roomName}
        joining={joining || (!joinError && !inRoom)}
        error={joinError}
        connection={connection}
        onRetry={() => useRoomStore.getState().retryJoin()}
        onBack={() => navigate("/")}
        onPasswordSubmit={(password) => useRoomStore.getState().joinRoom(roomId, password)}
        onCodeSubmit={(code) => useRoomStore.getState().requestCodeRoom({ t: "join_code_room", code, roomId })}
      />
    );
  }

  const canEdit = canEditRoom(me, server, directory, room);
  const canManageMembers = !!me && !!directory && canManageRoomScope(me, room, directory);
  const canManageStage = canManageMembers || room.createdById === me?.id;
  const pendingStageMembers = members.filter((member) => stageRequests.includes(member.userId));

  return (
    <div className="room-workspace flex h-full min-h-0 flex-col overflow-hidden lg:gap-3">
      {connection !== "online" && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-warning/20 bg-warning/10 px-4 py-1.5 text-[11px] text-warning">
          <WifiOff className="h-3.5 w-3.5" />
          {connection === "reconnecting" ? "正在重连…" : connection === "connecting" ? "连接中…" : "连接已断开"}
        </div>
      )}

      {selfState.audioBlocked && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-info/20 bg-info/10 px-4 py-2 text-[11px] text-info">
          <Volume2 className="h-3.5 w-3.5" />
          <button
            type="button"
            onClick={() => void voice.resumeAudio()}
            className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            启用声音
          </button>
        </div>
      )}

      <RoomHeader
        key={room.id}
        room={room}
        onViewCode={inviteCode ? () => setViewingCodeIn(roomId) : undefined}
        memberCount={members.length}
        capacity={capacity}
        stageOnCount={stageMode ? members.filter((member) => member.onStage && !member.stageMuted).length : undefined}
        onBack={handleBack}
        onEdit={canEdit ? () => setEditingRoomId(room.id) : undefined}
        onManageMembers={canManageMembers ? () => setManagingMembersIn(room.id) : undefined}
      />

      {stageMode && <StageSeatsPanel
        members={members}
        seats={room.stageSeats}
        selfUserId={me?.id ?? null}
        canManage={canManageMembers || room.createdById === me?.id}
        selfOnStage={selfStage.onStage}
        selfPending={selfStage.pending}
        onJoin={handleToggleStage}
        onLeave={handleToggleStage}
        onRemove={(userId) => handleStageApproval(userId, false)}
      />}

      {stageMode && canManageStage && pendingStageMembers.length > 0 && <section aria-label="上麦申请" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/20 bg-warning/10 px-3 py-2 sm:px-4">
        <p className="mr-auto text-xs font-medium text-foreground">上麦申请 · {pendingStageMembers.length}</p>
        {pendingStageMembers.map((member) => <div key={member.userId} className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1">
          <span className="max-w-28 truncate text-xs">{member.displayName}</span>
          <Button size="sm" className="h-8 min-h-8 px-2" aria-label={`批准 ${member.displayName} 上麦`} icon={<Check className="h-3.5 w-3.5" />}
            onClick={() => handleStageApproval(member.userId, true)}>批准</Button>
          <Button size="sm" variant="outline" className="h-8 min-h-8 px-2" aria-label={`拒绝 ${member.displayName} 上麦`} icon={<X className="h-3.5 w-3.5" />}
            onClick={() => handleStageApproval(member.userId, false)}>拒绝</Button>
        </div>)}
      </section>}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-hidden lg:rounded-2xl lg:border lg:border-border lg:bg-card/45">
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 sm:p-4">
            <RoomStage
              members={members}
              stageMode={stageMode}
              codeOnly={room.codeOnly}
              screenSharer={screenSharer}
              screenStream={screenStream}
              selfScreenStream={voice.getLocalScreenStream()}
              peerStats={peerStats}
              volumes={perUserVolume}
              onVolumeChange={handleVolumeChange}
              onLocalMute={handleLocalMute}
              onStopScreenShare={() => void handleToggleScreenShare()}
            />
          </div>
          <RoomControls
            selfState={selfState}
            pttEnabled={pttEnabled}
            pttKey={pttKey}
            stageMode={stageMode}
            onStage={selfStage.onStage}
            stagePending={selfStage.pending}
            screenShareAllowed={canShare}
            shareBusy={shareBusy}
            peerStats={peerStatsList}
            chatOpen={chatOpen}
            onToggleMic={handleToggleMic}
            onToggleStage={handleToggleStage}
            onToggleDeafen={handleToggleDeafen}
            onToggleScreenShare={() => void handleToggleScreenShare()}
            onToggleChat={handleToggleChat}
            onOpenSettings={handleOpenSettings}
            onLeave={handleLeave}
          />
        </div>
        <aside aria-label="房间聊天" className={cn(
          "min-h-0 lg:static lg:z-auto lg:h-auto lg:w-80 lg:shrink-0 lg:p-0 xl:w-88",
          chatOpen ? "viewport-overlay z-40 flex justify-end" : "hidden",
        )}>
          <button type="button" aria-label="关闭聊天遮罩" onClick={handleToggleChat} className="absolute inset-0 bg-black/30 lg:hidden" />
          <ChatPanel className="relative w-full overflow-hidden border-border sm:max-w-sm lg:rounded-2xl lg:border lg:shadow-card" open={chatOpen} onClose={handleToggleChat} />
        </aside>
      </div>
      {canEdit && editingRoomId === room.id && <RoomEditor target={{ kind: "edit", roomId: room.id }} onClose={() => setEditingRoomId(null)} />}
      {canManageMembers && managingMembersIn === room.id && <RoomMembersModal roomId={room.id} members={members} user={me} onClose={() => setManagingMembersIn(null)} />}
      {inviteCode && viewingCodeIn === room.id && <RoomCodeShareModal roomName={room.name} code={inviteCode} onClose={() => setViewingCodeIn(null)} />}
    </div>
  );
}

function peerToMember(peer: PeerInfo): RoomMember {
  return {
    userId: peer.userId,
    username: peer.username,
    displayName: peer.displayName,
    role: peer.role,
    isGuest: peer.isGuest,
    avatarColor: peer.avatarColor,
    avatarEmoji: peer.avatarEmoji,
    statusText: peer.statusText,
    muted: peer.muted,
    deafened: peer.deafened,
    speaking: peer.speaking,
    screenSharing: peer.screenSharing,
    forceMuted: peer.forceMuted,
    onStage: peer.onStage,
    stageMuted: peer.stageMuted,
    stageRequested: peer.stageRequested,
    joinedAt: peer.joinedAt,
    isSelf: false,
  };
}

function buildSelfMember(user: UserSelf, state: VoiceStateSnapshot, speaking: boolean, stageMode: boolean, onStage: boolean, stageRequested: boolean): RoomMember {
  const settings = useSettingsStore.getState();
  const muted =
    !state.micEnabled || !state.hasMicrophone || state.forceMuted || (stageMode && !onStage) || (settings.pttEnabled && !state.pttActive);
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isGuest: user.isGuest,
    avatarColor: user.avatarColor,
    avatarEmoji: user.avatarEmoji,
    statusText: user.statusText,
    muted,
    deafened: state.deafened,
    speaking,
    screenSharing: state.screenSharing,
    forceMuted: state.forceMuted,
    onStage,
    stageMuted: stageMode && !onStage,
    stageRequested,
    joinedAt: user.createdAt,
    isSelf: true,
  };
}

function StageSeatsPanel({ members, seats, selfUserId, canManage, selfOnStage, selfPending, onJoin, onLeave, onRemove }: {
  members: RoomMember[];
  seats: number;
  selfUserId: number | null;
  canManage: boolean;
  selfOnStage: boolean;
  selfPending: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onRemove: (userId: number) => void;
}) {
  const active = members.filter((member) => member.onStage && !member.stageMuted);
  const seatCount = Math.max(1, Math.min(50, seats));

  return (
    <section aria-label="上麦席位" className="shrink-0 border-b border-border bg-card/70 px-3 py-2 sm:px-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="mr-auto text-xs font-semibold">上麦席位</h2>
        <span className="tabular text-xs text-muted-foreground">{active.length}/{seatCount}</span>
        {selfOnStage
          ? <Button size="sm" variant="outline" className="min-h-8" icon={<MicOff className="h-3.5 w-3.5" />} onClick={onLeave}>下麦</Button>
          : <Button size="sm" variant={selfPending ? "outline" : "secondary"} className="min-h-8" disabled={selfPending}
            icon={<Mic2 className="h-3.5 w-3.5" />} onClick={onJoin}>{selfPending ? "等待审批" : "申请上麦"}</Button>}
      </div>
      <div className="app-scroll flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1">
        {Array.from({ length: seatCount }, (_, index) => {
          const member = active[index];
          return member ? <div key={index} role="group" aria-label={`麦位 ${index + 1}：${member.displayName}`}
            className="flex min-h-10 w-36 shrink-0 items-center gap-2 rounded-lg border border-brand/20 bg-brand/5 px-2 py-1.5">
              <span className="relative shrink-0"><Avatar name={member.displayName} color={member.avatarColor} emoji={member.avatarEmoji} size="xs" speaking={member.speaking} />
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-card bg-success" /></span>
              <span className="min-w-0 flex-1 truncate text-xs" title={member.displayName}>{member.displayName}</span>
              {canManage && member.userId !== selfUserId && <button type="button" aria-label={`移出麦位 ${member.displayName}`}
                title="移出麦位" onClick={() => onRemove(member.userId)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-3.5 w-3.5" />
              </button>}
            </div> : <button key={index} type="button" aria-label={`申请麦位 ${index + 1}`}
            disabled={selfOnStage || selfPending} onClick={onJoin}
            className={cn("flex min-h-10 w-36 shrink-0 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-2 py-1.5 text-left text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
              !selfOnStage && !selfPending && "cursor-pointer hover:border-brand/40 hover:bg-brand/5 hover:text-brand")}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted"><MicOff className="h-3.5 w-3.5" /></span>
            <span className="text-xs">空位 {index + 1}</span>
          </button>;
        })}
      </div>
    </section>
  );
}

function compareMembers(left: RoomMember, right: RoomMember): number {
  const roleDiff = ROLE_RANK[left.role] - ROLE_RANK[right.role];
  if (roleDiff !== 0) return roleDiff;
  return left.displayName.localeCompare(right.displayName, "zh-CN");
}

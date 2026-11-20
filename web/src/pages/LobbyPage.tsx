import { useEffect, useState } from "react";
import type { RoomDetail, RoomSummary } from "@airmic/shared";
import { DEFAULT_AUDIO_SETTINGS } from "@airmic/shared";
import { ArrowRight, DoorOpen, Plus, RefreshCw, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, IconButton, PageHeader, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useRoomStore } from "@/stores/room";
import { useUiStore } from "@/stores/ui";
import { canCreateRoom, canManageRooms } from "@/components/lobby/access";
import JoinRoomPasswordModal from "@/components/lobby/JoinRoomPasswordModal";
import LobbyRoomGrid from "@/components/lobby/LobbyRoomGrid";
import RoomFormModal from "@/components/lobby/RoomFormModal";
import { createRoomInitial, detailRoomInitial, summaryRoomInitial } from "@/components/lobby/roomForm";

type FormTarget =
  | { kind: "create" }
  | { kind: "edit"; room: RoomSummary; detail: RoomDetail | null }
  | null;

export default function LobbyPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const server = useAppStore((state) => state.server);
  const rooms = useAppStore((state) => state.rooms);
  const onlineUserCount = useAppStore((state) => state.onlineUsers.length);
  const connection = useAppStore((state) => state.connection);
  const refreshRooms = useAppStore((state) => state.refreshRooms);
  const currentRoom = useRoomStore((state) => state.snapshot?.room ?? null);

  const [joinTarget, setJoinTarget] = useState<RoomSummary | null>(null);
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    void refreshRooms();
  }, [refreshRooms]);

  const audioBase = server?.defaultAudioSettings ?? DEFAULT_AUDIO_SETTINGS;
  const categories = server?.roomCategories ?? [];
  const allowCreate = canCreateRoom(user, server);
  const allowEdit = canManageRooms(user);
  const currentRoomId = currentRoom?.id ?? null;

  const handleJoin = (room: RoomSummary) => {
    if (room.id === currentRoomId) {
      navigate("/room/" + room.id);
      return;
    }
    if (room.locked) {
      useUiStore.getState().toast("房间「" + room.name + "」已锁定，暂时无法加入", "warning");
      return;
    }
    if (room.maxUsers > 0 && room.userCount >= room.maxUsers) {
      useUiStore.getState().toast("房间「" + room.name + "」人数已满", "warning");
      return;
    }
    if (room.hasPassword) {
      setJoinTarget(room);
      return;
    }
    if (connection !== "online") {
      useUiStore.getState().toast("实时连接尚未建立，请稍后再试", "warning");
      return;
    }
    useRoomStore.getState().joinRoom(room.id);
    navigate("/room/" + room.id);
  };

  const handleEdit = async (room: RoomSummary) => {
    if (editLoading) return;
    setEditLoading(true);
    let detail: RoomDetail | null = null;
    if (user?.permissions.includes("manage_server")) {
      try {
        const result = await api.admin.rooms();
        detail = result.rooms.find((item) => item.id === room.id) ?? null;
      } catch (error) {
        useUiStore.getState().toast(errorMessage(error), "warning");
      }
    }
    setFormTarget({ kind: "edit", room, detail });
    setEditLoading(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      {connection !== "online" && (
        <Alert tone="warning">
          {connection === "reconnecting" ? "实时连接已断开，正在自动重连…" : "实时连接未建立，房间列表可能不是最新状态"}
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        <PageHeader
          title={server?.name ?? "AirMic 语音服务器"}
          description={
            <>
              <span className="block">欢迎回来，{user?.displayName ?? "朋友"}</span>
              <span className="mt-1 block whitespace-pre-line">{server?.motd || "选择一个房间加入语音，或自己创建一个房间。"}</span>
            </>
          }
          actions={
            <>
              {currentRoom && (
                <Button variant="secondary" size="sm" icon={<ArrowRight className="h-4 w-4" />} onClick={() => navigate("/room/" + currentRoom.id)}>
                  返回「{currentRoom.name}」
                </Button>
              )}
              {allowCreate && (
                <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setFormTarget({ kind: "create" })}>
                  创建房间
                </Button>
              )}
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="good" className="tabular">
            <Users className="h-3 w-3" />
            在线 {onlineUserCount}
          </Badge>
          <Badge className="tabular">
            <DoorOpen className="h-3 w-3" />
            房间 {rooms.length}
          </Badge>
          <Badge>{server?.registrationMode === "open" ? "开放注册" : server?.registrationMode === "invite" ? "邀请码注册" : "暂停注册"}</Badge>
          {server && !server.allowScreenShare && <Badge tone="warn">屏幕共享已全局关闭</Badge>}
        </div>
      </div>

      {currentRoom && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-card">
          <span>你当前在「{currentRoom.name}」房间中，可随时返回继续语音。</span>
          <Button variant="outline" size="sm" onClick={() => navigate("/room/" + currentRoom.id)}>
            返回房间
          </Button>
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">房间列表</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">点击房间卡片即可加入语音，带锁图标的房间需要密码</p>
          </div>
          <div className="flex items-center gap-2">
            {editLoading && <Spinner className="h-4 w-4" />}
            <IconButton label="刷新房间列表" onClick={() => void refreshRooms()}>
              <RefreshCw className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
        <LobbyRoomGrid
          rooms={rooms}
          currentRoomId={currentRoomId}
          canEdit={allowEdit}
          canCreate={allowCreate}
          onJoin={handleJoin}
          onEdit={(room) => void handleEdit(room)}
          onCreate={() => setFormTarget({ kind: "create" })}
        />
      </section>

      {joinTarget && <JoinRoomPasswordModal room={joinTarget} onClose={() => setJoinTarget(null)} />}

      {formTarget && (
        <RoomFormModal
          initial={
            formTarget.kind === "create"
              ? createRoomInitial(audioBase, categories)
              : formTarget.detail
                ? detailRoomInitial(formTarget.detail)
                : summaryRoomInitial(formTarget.room, audioBase)
          }
          audioBase={audioBase}
          canDelete={formTarget.kind === "edit" && allowEdit}
          onClose={() => setFormTarget(null)}
          onSaved={(room) => {
            useAppStore.getState().upsertRoom(room);
            void refreshRooms();
          }}
          onDeleted={(roomId) => {
            useAppStore.getState().removeRoom(roomId);
            void refreshRooms();
          }}
        />
      )}
    </div>
  );
}

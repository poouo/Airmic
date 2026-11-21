import { useState } from "react";
import { canCreateCodeRoom, type RoomSummary } from "@airmic/shared";
import { ArrowRight, KeyRound, Plus, RefreshCw } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, IconButton, Spinner } from "@/components/ui";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useRoomStore } from "@/stores/room";
import { useUiStore } from "@/stores/ui";
import { canEditRoom, needsRoomPassword, roomCreationAreas } from "@/components/lobby/access";
import JoinRoomPasswordModal from "@/components/lobby/JoinRoomPasswordModal";
import CodeRoomModal, { type CodeRoomTarget } from "@/components/lobby/CodeRoomModal";
import LobbyRoomGrid from "@/components/lobby/LobbyRoomGrid";
import RoomEditor, { type RoomEditorTarget } from "@/components/lobby/RoomEditor";
import LobbyEntry from "@/components/auth/LobbyEntry";

export default function LobbyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const server = useAppStore((state) => state.server);
  const rooms = useAppStore((state) => state.rooms);
  const directory = useAppStore((state) => state.directory);
  const directoryError = useAppStore((state) => state.directoryError);
  const connection = useAppStore((state) => state.connection);
  const currentRoom = useRoomStore((state) => state.snapshot?.room ?? null);
  const [joinTarget, setJoinTarget] = useState<RoomSummary | null>(null);
  const [editor, setEditor] = useState<RoomEditorTarget | null>(null);
  const [codeTarget, setCodeTarget] = useState<CodeRoomTarget | null>(null);
  const returnTo: unknown = location.state?.returnTo;

  if (user && typeof returnTo === "string" && /^\/(?:room\/\d+|rooms\/manage|admin)(?:\?|$)/.test(returnTo)) {
    return <Navigate to={returnTo} replace state={null} />;
  }

  const handleJoin = (room: RoomSummary) => {
    if (room.id === currentRoom?.id) return navigate(`/room/${room.id}`);
    if (room.locked || (room.maxUsers > 0 && room.userCount >= room.maxUsers)) {
      useUiStore.getState().toast(room.locked ? "房间已锁定" : "房间已满", "warning");
      return;
    }
    if (connection !== "online") {
      useUiStore.getState().toast("实时连接尚未建立，请稍后再试", "warning");
      return;
    }
    if (room.codeOnly) return setCodeTarget({ mode: "join", room });
    if (needsRoomPassword(user, directory, room)) return setJoinTarget(room);
    useRoomStore.getState().joinRoom(room.id);
    navigate(`/room/${room.id}`);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      {user && connection !== "online" && <Alert tone="warning">{connection === "reconnecting" ? "正在重连…" : "语音未连接"}</Alert>}
      {user ? <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">语音房间</h1>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {currentRoom && <Button variant="outline" size="sm" icon={<ArrowRight className="h-4 w-4" />} onClick={() => navigate(`/room/${currentRoom.id}`)}>返回房间</Button>}
            {server && canCreateCodeRoom(user, server) && <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setCodeTarget({ mode: "create" })}>新建口令房</Button>}
            <Button size="sm" icon={<KeyRound className="h-4 w-4" />} onClick={() => setCodeTarget({ mode: "join" })}>加入口令房</Button>
            <IconButton label="刷新分区和房间" onClick={() => {
              const app = useAppStore.getState();
              void app.refreshDirectory();
              void app.refreshRooms();
            }}><RefreshCw className="h-4 w-4" /></IconButton>
          </div>
        </div>
        {directoryError && <Alert tone="error">{directoryError}</Alert>}
        {directory ? <LobbyRoomGrid areas={directory.areas} rooms={rooms} currentRoomId={currentRoom?.id ?? null}
          createAreas={roomCreationAreas(user, server, directory)} canEdit={(room) => canEditRoom(user, server, directory, room)}
          onJoin={handleJoin} onEdit={(room) => setEditor({ kind: "edit", roomId: room.id })}
          onCreate={(areaId) => setEditor({ kind: "create", areaId })} /> : !directoryError && <Spinner />}
      </section> : <LobbyEntry />}
      {joinTarget && <JoinRoomPasswordModal room={joinTarget} onClose={() => setJoinTarget(null)} />}
      {codeTarget && <CodeRoomModal target={codeTarget} onClose={() => setCodeTarget(null)} />}
      {editor && <RoomEditor target={editor} onClose={() => setEditor(null)} />}
    </div>
  );
}

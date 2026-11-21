import type { RoomSummary } from "@airmic/shared";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useRoomStore } from "@/stores/room";
import { useUiStore } from "@/stores/ui";
import JoinRoomPasswordModal from "@/components/lobby/JoinRoomPasswordModal";
import RoomEditor from "@/components/lobby/RoomEditor";
import { canOpenRoomManagement, roomCreationAreas } from "@/components/lobby/access";
import OnlineUsersList from "./OnlineUsersList";
import RoomNavList from "./RoomNavList";
import SidebarUserCard from "./SidebarUserCard";
import { useState } from "react";

export interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const server = useAppStore((state) => state.server);
  const rooms = useAppStore((state) => state.rooms);
  const directory = useAppStore((state) => state.directory);
  const currentRoomId = useRoomStore((state) => state.snapshot?.room.id ?? null);
  const [joinTarget, setJoinTarget] = useState<RoomSummary | null>(null);
  const [creating, setCreating] = useState(false);

  const defaultCreateArea = roomCreationAreas(user, server, directory)[0];
  const allowManage = canOpenRoomManagement(user, server, directory, rooms);

  const handleSelect = (room: RoomSummary) => {
    if (room.id === currentRoomId) {
      onNavigate?.();
      navigate("/room/" + room.id);
      return;
    }
    if (room.locked) {
      useUiStore.getState().toast("房间已锁定", "warning");
      return;
    }
    if (room.maxUsers > 0 && room.userCount >= room.maxUsers) {
      useUiStore.getState().toast("房间已满", "warning");
      return;
    }
    if (room.hasPassword) {
      // 不关闭移动端抽屉：密码弹窗由 Modal 渲染在抽屉之上
      setJoinTarget(room);
      return;
    }
    onNavigate?.();
    if (useAppStore.getState().connection !== "online") {
      useUiStore.getState().toast("连接未就绪", "warning");
      return;
    }
    useRoomStore.getState().joinRoom(room.id);
    navigate("/room/" + room.id);
  };

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <RoomNavList currentRoomId={currentRoomId} canCreateRooms={!!defaultCreateArea} canManage={allowManage && location.pathname !== "/rooms/manage"} onSelect={handleSelect} onCreate={() => setCreating(true)} />
      <OnlineUsersList />
      <SidebarUserCard />

      {joinTarget && <JoinRoomPasswordModal room={joinTarget} onClose={() => setJoinTarget(null)} />}
      {creating && defaultCreateArea && <RoomEditor target={{ kind: "create", areaId: defaultCreateArea.id }} onClose={() => setCreating(false)} />}
    </div>
  );
}

import { useState } from "react";
import type { RoomSummary } from "@airmic/shared";
import { DEFAULT_AUDIO_SETTINGS } from "@airmic/shared";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useRoomStore } from "@/stores/room";
import { useUiStore } from "@/stores/ui";
import JoinRoomPasswordModal from "@/components/lobby/JoinRoomPasswordModal";
import RoomFormModal from "@/components/lobby/RoomFormModal";
import { createRoomInitial } from "@/components/lobby/roomForm";
import { canCreateRoom } from "@/components/lobby/access";
import OnlineUsersList from "./OnlineUsersList";
import RoomNavList from "./RoomNavList";
import SidebarUserCard from "./SidebarUserCard";

export interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const server = useAppStore((state) => state.server);
  const currentRoomId = useRoomStore((state) => state.snapshot?.room.id ?? null);
  const [joinTarget, setJoinTarget] = useState<RoomSummary | null>(null);
  const [creating, setCreating] = useState(false);

  const allowCreate = canCreateRoom(user, server);

  const handleSelect = (room: RoomSummary) => {
    if (room.id === currentRoomId) {
      onNavigate?.();
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
      // 不关闭移动端抽屉：密码弹窗由 Modal 渲染在抽屉之上
      setJoinTarget(room);
      return;
    }
    onNavigate?.();
    if (useAppStore.getState().connection !== "online") {
      useUiStore.getState().toast("实时连接尚未建立，请稍后再试", "warning");
      return;
    }
    useRoomStore.getState().joinRoom(room.id);
    navigate("/room/" + room.id);
  };

  const audioBase = server?.defaultAudioSettings ?? DEFAULT_AUDIO_SETTINGS;
  const categories = server?.roomCategories ?? [];

  return (
    <div className="flex h-full w-full min-h-0 flex-col bg-ink-900/30">
      <RoomNavList currentRoomId={currentRoomId} canCreateRooms={allowCreate} onSelect={handleSelect} onCreate={() => setCreating(true)} />
      <OnlineUsersList />
      <SidebarUserCard />

      {joinTarget && <JoinRoomPasswordModal room={joinTarget} onClose={() => setJoinTarget(null)} />}
      {creating && (
        <RoomFormModal
          initial={createRoomInitial(audioBase, categories)}
          audioBase={audioBase}
          onClose={() => setCreating(false)}
          onSaved={(room) => {
            useAppStore.getState().upsertRoom(room);
            void useAppStore.getState().refreshRooms();
          }}
        />
      )}
    </div>
  );
}

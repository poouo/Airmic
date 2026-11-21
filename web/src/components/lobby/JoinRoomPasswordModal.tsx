import { useState } from "react";
import type { RoomSummary } from "@airmic/shared";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { useRoomStore } from "@/stores/room";
import { useUiStore } from "@/stores/ui";

export interface JoinRoomPasswordModalProps {
  room: RoomSummary;
  onClose: () => void;
}

export default function JoinRoomPasswordModal({ room, onClose }: JoinRoomPasswordModalProps) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleJoin = async () => {
    if (!password) {
      setError("请输入房间密码");
      return;
    }
    if (useAppStore.getState().connection !== "online") {
      setError("实时连接尚未建立，请稍后再试");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.rooms.checkPassword(room.id, password);
      if (!result.ok) {
        setError("密码不正确");
        return;
      }
      useRoomStore.getState().joinRoom(room.id, password);
      onClose();
      navigate("/room/" + room.id);
    } catch (caught) {
      const text = errorMessage(caught);
      setError(text);
      useUiStore.getState().toast(text, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={submitting ? () => undefined : onClose}
      title="输入房间密码"
      subtitle={room.name}
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button size="sm" loading={submitting} onClick={() => void handleJoin()}>
            进入房间
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="房间密码"
          type={visible ? "text" : "password"}
          autoFocus
          value={password}
          maxLength={64}
          error={error}
          placeholder="请输入房间密码"
          rightSlot={
            <button
              type="button"
              onClick={() => setVisible((value) => !value)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={visible ? "隐藏密码" : "显示密码"}
            >
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleJoin();
          }}
        />
      </div>
    </Modal>
  );
}

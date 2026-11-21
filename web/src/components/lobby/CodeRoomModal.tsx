import { useEffect, useId, useRef, useState } from "react";
import type { CodeRoomRequest, RoomSummary } from "@airmic/shared";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Input, Modal } from "@/components/ui";
import { socket } from "@/lib/ws";
import { useAppStore } from "@/stores/app";
import { useRoomStore } from "@/stores/room";

export type CodeRoomTarget = { mode: "create" } | { mode: "join"; room?: RoomSummary };

export default function CodeRoomModal({ target, onClose, onJoined }: {
  target: CodeRoomTarget;
  onClose: () => void;
  onJoined?: () => void;
}) {
  const navigate = useNavigate();
  const formId = useId();
  const [value, setValue] = useState("");
  const [attempted, setAttempted] = useState(false);
  const requestRef = useRef<CodeRoomRequest | null>(null);
  const pending = useRoomStore((state) => state.pendingCode);
  const error = useRoomStore((state) => state.joinError);
  const online = useAppStore((state) => state.connection === "online");
  const creating = target.mode === "create";
  const busy = pending !== null && pending === requestRef.current;
  const valid = creating ? value.trim().length > 0 : /^\d{4}$/.test(value);

  useEffect(() => socket.on("room_joined", (message) => {
    if (!requestRef.current || message.request !== requestRef.current.t) return;
    requestRef.current = null;
    onClose();
    onJoined?.();
    navigate(`/room/${message.snapshot.room.id}`);
  }), [navigate, onClose, onJoined]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => {
      if (useRoomStore.getState().pendingCode === requestRef.current) {
        useRoomStore.getState().setJoinError({ code: "timeout", message: "等待响应超时，请重试" });
      }
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    if (!pending && error) requestRef.current = null;
  }, [pending, error]);

  const submit = () => {
    if (!online || !valid || pending) return;
    const request: CodeRoomRequest = target.mode === "create"
      ? { t: "create_code_room", name: value.trim() }
      : { t: "join_code_room", code: value, roomId: target.room?.id };
    requestRef.current = request;
    setAttempted(true);
    useRoomStore.getState().requestCodeRoom(request);
  };

  return (
    <Modal open title={creating ? "新建口令房" : "加入口令房"}
      subtitle={target.mode === "join" ? target.room?.name : undefined}
      onClose={busy ? () => undefined : onClose} size="sm"
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>取消</Button>
        <Button type="submit" form={formId} size="sm" loading={busy} disabled={!online || !valid || pending !== null}>
          {creating ? "创建并进入" : "加入"}
        </Button>
      </>}>
      <form id={formId} className="space-y-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {error && attempted && <Alert tone="error">{error.message}</Alert>}
        {creating ? (
          <Input label="房间名称" required placeholder="输入口令房名称" value={value} maxLength={40} autoFocus
            onChange={(event) => setValue(event.target.value)} hint="自动生成四位口令，空房后自动关闭。" />
        ) : (
          <Input label="四位口令" value={value} inputMode="numeric" autoComplete="off" autoFocus
            placeholder="输入四位数字" onChange={(event) => setValue(event.target.value.replace(/\D/g, "").slice(0, 4))} />
        )}
        {!online && <Alert tone="warning">等待服务器连接</Alert>}
      </form>
    </Modal>
  );
}

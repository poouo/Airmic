import { useEffect, useState } from "react";
import { DEFAULT_AUDIO_SETTINGS } from "@airmic/shared";
import type { RoomDetail } from "@airmic/shared";
import { Alert, Modal, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import RoomFormModal from "./RoomFormModal";
import { createRoomInitial, detailRoomInitial } from "./roomForm";

export type RoomEditorTarget = { kind: "create"; areaId: number } | { kind: "edit"; roomId: number };

export default function RoomEditor({ target, onClose }: { target: RoomEditorTarget; onClose: () => void }) {
  const audioBase = useAppStore((state) => state.server?.defaultAudioSettings) ?? DEFAULT_AUDIO_SETTINGS;
  const roomId = target.kind === "edit" ? target.roomId : null;
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (roomId === null) return;
    const controller = new AbortController();
    void api.rooms.settings(roomId, controller.signal).then(({ room }) => {
      if (!controller.signal.aborted) setDetail(room);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(error));
    });
    return () => controller.abort();
  }, [roomId]);

  const initial = target.kind === "create" ? createRoomInitial(audioBase, target.areaId) : detail ? detailRoomInitial(detail) : null;
  if (!initial) {
    return <Modal open title="编辑房间" onClose={onClose}>
      {error ? <Alert tone="error">{error}</Alert> : <Spinner />}
    </Modal>;
  }

  return <RoomFormModal
    initial={initial}
    audioBase={audioBase}
    canDelete={target.kind === "edit"}
    onClose={onClose}
    onSaved={(room) => useAppStore.getState().upsertRoom(room)}
    onDeleted={(id) => {
      const app = useAppStore.getState();
      app.removeRoom(id);
      void app.refreshDirectory();
    }}
  />;
}

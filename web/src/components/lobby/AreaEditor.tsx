import { useId, useState } from "react";
import type { RoomArea } from "@airmic/shared";
import { Alert, Button, Input, Modal } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import AreaIconPicker from "./AreaIconPicker";

export type AreaEditorTarget = { area: RoomArea } | { parent: RoomArea | null };

export default function AreaEditor({ target, onClose }: { target: AreaEditorTarget; onClose: () => void }) {
  const area = "area" in target ? target.area : null;
  const formId = useId();
  const parent = "parent" in target ? target.parent : null;
  const [name, setName] = useState(area?.name ?? "");
  const [sortOrder, setSortOrder] = useState(String(area?.sortOrder ?? 0));
  const [icon, setIcon] = useState<RoomArea["icon"]>(area?.icon ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (area) await api.roomDirectory.update(area.id, name.trim(), Number(sortOrder), icon === (area.icon ?? null) ? undefined : icon);
      else await api.roomDirectory.create(parent?.id ?? null, name.trim(), icon);
      const app = useAppStore.getState();
      await app.refreshDirectory();
      if (area && name.trim() !== area.name) void app.refreshRooms();
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const title = area ? (area.parentId === null ? "编辑一级分区" : "编辑子区") : (parent ? "添加子区" : "添加一级分区");
  const isRoot = area ? area.parentId === null : !parent;
  return (
    <Modal open title={title} subtitle={parent?.name} size="lg" onClose={busy ? () => undefined : onClose}
      footer={<>
        <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
        <Button type="submit" form={formId} loading={busy} disabled={!name.trim()}>{area ? "保存" : "添加"}</Button>
      </>}>
      <form id={formId} className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {error && <Alert tone="error">{error}</Alert>}
        <Input required label="名称" autoFocus value={name} maxLength={20} placeholder={parent ? "例如：三角洲行动" : "例如：游戏区"} onChange={(event) => setName(event.target.value)} />
        {area && <Input label="排序值" type="number" min={-100000} max={100000} value={sortOrder} hint="数字越小越靠前" onChange={(event) => setSortOrder(event.target.value)} />}
        <AreaIconPicker value={icon} isRoot={isRoot} onChange={setIcon} />
      </form>
    </Modal>
  );
}

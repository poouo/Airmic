import { useEffect, useState } from "react";
import type { RoomManagementScope, RoomManager } from "@airmic/shared";
import { Alert, Button, Input, Modal, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export interface ManagersTarget {
  scope: RoomManagementScope;
  path: string;
  inheritance?: string;
}

export default function RoomManagersModal({ target, onClose }: { target: ManagersTarget; onClose: () => void }) {
  const { scope, path, inheritance } = target;
  const [managers, setManagers] = useState<RoomManager[] | null>(null);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void api.roomDirectory.managers(scope, controller.signal).then(({ managers }) => {
      if (!controller.signal.aborted) setManagers(managers);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(error));
    });
    return () => controller.abort();
  }, [scope]);

  const change = async (userId?: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (userId === undefined) {
        const result = await api.roomDirectory.grant(scope, username.trim());
        setManagers(result.managers);
        setUsername("");
      } else {
        const result = await api.roomDirectory.revoke(scope, userId);
        setManagers(result.managers);
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title="管理权限" subtitle={path} onClose={busy ? () => undefined : onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{inheritance ?? "授权用户可以编辑、删除此房间并将成员移出房间。"}</p>
        {error && <Alert tone="error">{error}</Alert>}
        <form onSubmit={(event) => { event.preventDefault(); void change(); }} className="flex items-end gap-2">
          <div className="min-w-0 flex-1"><Input required label="用户名" value={username} maxLength={60} placeholder="注册时使用的账号" onChange={(event) => setUsername(event.target.value)} /></div>
          <Button type="submit" disabled={busy || !username.trim()}>授权</Button>
        </form>
        <div className="border-t border-border pt-3">
          <h3 className="mb-2 text-sm font-semibold">直接授权</h3>
          {managers === null ? !error && <Spinner /> : managers.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有直接授权的用户</p>
          ) : <ul className="divide-y divide-border">
            {managers.map((manager) => <li key={manager.userId} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm">{manager.displayName} <span className="text-muted-foreground">@{manager.username}</span></span>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void change(manager.userId)}>撤销授权</Button>
            </li>)}
          </ul>}
        </div>
      </div>
    </Modal>
  );
}

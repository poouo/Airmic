import { useState } from "react";
import { ROLE_ORDER } from "@airmic/shared";
import type { UserSelf } from "@airmic/shared";
import { Alert, Avatar, Button, Modal } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import type { RoomMember } from "./types";

export default function RoomMembersModal({ roomId, members, user, onClose }: { roomId: number; members: RoomMember[]; user: UserSelf; onClose: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targets = members.filter((member) => !member.isSelf && member.role !== "admin" && ROLE_ORDER[member.role] >= ROLE_ORDER[user.role]);

  const kick = async (member: RoomMember) => {
    if (busy !== null) return;
    setBusy(member.userId);
    setError(null);
    try {
      const ui = useUiStore.getState();
      if (!await ui.confirm({ title: "移出房间", message: `将「${member.displayName}」移出当前房间？`, confirmText: "移出房间", danger: true })) return;
      await api.rooms.kick(roomId, member.userId);
      ui.toast(`已将「${member.displayName}」移出房间`, "success");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open title="管理房间成员" onClose={busy === null ? onClose : () => undefined}>
      {error && <Alert tone="error">{error}</Alert>}
      {targets.length === 0 ? <p className="text-sm text-muted-foreground">当前没有可管理的成员。</p> : (
        <ul className="divide-y divide-border">
          {targets.map((member) => <li key={member.userId} className="flex items-center gap-2 py-2">
            <Avatar name={member.displayName} color={member.avatarColor} emoji={member.avatarEmoji} size="sm" />
            <span className="mr-auto min-w-0 truncate text-sm">{member.displayName}</span>
            <Button size="sm" variant="outline" loading={busy === member.userId} disabled={busy !== null} onClick={() => void kick(member)}>移出房间</Button>
          </li>)}
        </ul>
      )}
    </Modal>
  );
}

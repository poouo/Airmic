import { useState } from "react";
import type { RoomDetail, RoomSummary } from "@airmic/shared";
import { DEFAULT_AUDIO_SETTINGS, audioSummary } from "@airmic/shared";
import { DoorOpen, KeyRound, LockKeyhole, MonitorUp, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, IconButton, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import RoomFormModal from "@/components/lobby/RoomFormModal";
import { createRoomInitial, detailRoomInitial, summaryRoomInitial } from "@/components/lobby/roomForm";
import { useAsyncData } from "./useAsyncData";
import { AdminErrorPanel, AdminLoading, SectionCard, TableShell, Td, Th } from "./shared";

type FormState = { kind: "create" } | { kind: "edit"; room: RoomDetail | RoomSummary } | null;

function isRoomDetail(room: RoomDetail | RoomSummary): room is RoomDetail {
  return "audioSettings" in room;
}

export default function RoomsTab() {
  const self = useAuthStore((state) => state.user);
  const server = useAppStore((state) => state.server);
  const appRooms = useAppStore((state) => state.rooms);
  const canFull = self?.permissions.includes("manage_server") ?? false;
  const canManage = self?.permissions.includes("manage_rooms") ?? false;

  const detailQuery = useAsyncData<RoomDetail[]>(
    () => (canFull ? api.admin.rooms().then((result) => result.rooms) : Promise.resolve([])),
    [canFull],
  );
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const audioBase = server?.defaultAudioSettings ?? DEFAULT_AUDIO_SETTINGS;
  const categories = server?.roomCategories ?? [];
  const rooms: (RoomDetail | RoomSummary)[] = canFull ? (detailQuery.data ?? []) : appRooms;
  // WS 广播的实时房间摘要用于覆盖人数/锁定等实时字段
  const liveMap = new Map(appRooms.map((room) => [room.id, room]));
  const keyword = search.trim().toLowerCase();
  const filtered = keyword
    ? rooms.filter((room) => room.name.toLowerCase().includes(keyword) || room.category.toLowerCase().includes(keyword))
    : rooms;

  const refreshAll = () => {
    detailQuery.reload();
    void useAppStore.getState().refreshRooms();
  };

  const handleDelete = async (room: RoomDetail | RoomSummary) => {
    const confirmed = await useUiStore.getState().confirm({
      title: "删除房间",
      message: "确定删除房间「" + room.name + "」吗？房间内用户会被移出，此操作不可撤销。",
      confirmText: "删除房间",
      danger: true,
    });
    if (!confirmed) return;
    setDeletingId(room.id);
    try {
      await api.rooms.remove(room.id);
      useUiStore.getState().toast("房间「" + room.name + "」已删除", "success");
      useAppStore.getState().removeRoom(room.id);
      refreshAll();
    } catch (caught) {
      useUiStore.getState().toast(errorMessage(caught), "error");
    } finally {
      setDeletingId(null);
    }
  };

  const loading = canFull && detailQuery.loading && !detailQuery.data;
  const error = canFull ? detailQuery.error : null;

  return (
    <div className="space-y-4">
      <SectionCard
        title="房间管理"
        description={(canFull ? "服务器全部房间，可编辑完整音质参数" : "房间列表（音质参数需要服务器管理权限查看）")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <Input label="搜索房间" value={search} leftIcon={<Search className="h-4 w-4" />} placeholder="房间名 / 分类" onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={loading} onClick={refreshAll}>
              刷新
            </Button>
            {(canManage || canFull) && (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setForm({ kind: "create" })}>
                创建房间
              </Button>
            )}
          </div>
        }
        bodyClassName="p-0"
      >
        {error ? (
          <div className="p-4">
            <AdminErrorPanel message={error} onRetry={refreshAll} />
          </div>
        ) : loading ? (
          <AdminLoading text="正在加载房间列表…" />
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<DoorOpen className="h-5 w-5" />}
              title={keyword ? "没有匹配的房间" : "还没有房间"}
              description={keyword ? "尝试更换搜索关键字" : "创建第一个房间开始语音"}
              action={
                (canManage || canFull) && !keyword ? (
                  <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setForm({ kind: "create" })}>
                    创建房间
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>房间</Th>
                <Th>分类</Th>
                <Th>人数</Th>
                <Th>状态</Th>
                <Th>生效音质</Th>
                <Th>创建者</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((room) => {
                const detail = isRoomDetail(room) ? room : null;
                const live = liveMap.get(room.id);
                const locked = live?.locked ?? room.locked;
                const hasPassword = live?.hasPassword ?? room.hasPassword;
                const userCount = live?.userCount ?? room.userCount;
                const maxUsers = live?.maxUsers ?? room.maxUsers;
                return (
                  <tr key={room.id} className="transition-colors hover:bg-ink-750">
                    <Td>
                      <p className="flex items-center gap-1.5 text-xs font-medium text-mist-100">
                        {room.name}
                        {locked && <LockKeyhole className="h-3 w-3 text-mist-400" />}
                      </p>
                      <p className="max-w-[16rem] truncate text-[10px] text-mist-500">{room.description || "暂无简介"}</p>
                    </Td>
                    <Td><Badge>{room.category}</Badge></Td>
                    <Td>
                      <span className={maxUsers > 0 && userCount >= maxUsers ? "font-mono text-[11px] text-bad-400" : "font-mono text-[11px] text-mist-300"}>
                        {userCount}/{maxUsers > 0 ? maxUsers : "∞"}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {hasPassword && <Badge tone="warn"><KeyRound className="h-3 w-3" />密码</Badge>}
                        {locked && <Badge tone="bad">锁定</Badge>}
                        {room.screenShareEnabled ? <Badge tone="good"><MonitorUp className="h-3 w-3" />共享</Badge> : <Badge>禁共享</Badge>}
                      </div>
                    </Td>
                    <Td className="max-w-[12rem]">
                      <p className="truncate font-mono text-[10px] text-mist-400" title={detail ? audioSummary(detail.audioSettings) : ""}>
                        {detail ? audioSummary(detail.audioSettings) : "仅服务器管理员可见"}
                      </p>
                    </Td>
                    <Td className="text-[11px] text-mist-500">{detail?.createdBy?.displayName ?? "-"}</Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton label="编辑房间" size="sm" variant="solid" onClick={() => setForm({ kind: "edit", room })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        {(canManage || canFull) && (
                          <IconButton label="删除房间" size="sm" variant="danger" onClick={() => void handleDelete(room)} disabled={deletingId === room.id}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
      </SectionCard>

      {form && (
        <RoomFormModal
          initial={
            form.kind === "create"
              ? createRoomInitial(audioBase, categories)
              : isRoomDetail(form.room)
                ? detailRoomInitial(form.room)
                : summaryRoomInitial(form.room, audioBase)
          }
          audioBase={audioBase}
          canDelete={canManage || canFull}
          onClose={() => setForm(null)}
          onSaved={(room) => {
            useAppStore.getState().upsertRoom(room);
            refreshAll();
          }}
          onDeleted={(roomId) => {
            useAppStore.getState().removeRoom(roomId);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

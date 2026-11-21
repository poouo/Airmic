import { useState } from "react";
import { canManageArea } from "@airmic/shared";
import type { RoomArea, RoomManagementScope } from "@airmic/shared";
import { Folder, KeyRound, Layers, Lock, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, IconButton, Input, PageHeader, Spinner } from "@/components/ui";
import { RoomIcon } from "@/components/room/roomIcons";
import { api, errorMessage } from "@/lib/api";
import { groupRoomDirectory, useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { canEditRoom } from "./access";
import AreaEditor, { type AreaEditorTarget } from "./AreaEditor";
import RoomEditor, { type RoomEditorTarget } from "./RoomEditor";
import RoomManagersModal, { type ManagersTarget } from "./RoomManagersModal";

export default function RoomDirectoryManager({ inDialog = false }: { inDialog?: boolean }) {
  const user = useAuthStore((state) => state.user);
  const directory = useAppStore((state) => state.directory);
  const directoryError = useAppStore((state) => state.directoryError);
  const rooms = useAppStore((state) => state.rooms);
  const server = useAppStore((state) => state.server);
  const [areaEditor, setAreaEditor] = useState<AreaEditorTarget | null>(null);
  const [roomEditor, setRoomEditor] = useState<RoomEditorTarget | null>(null);
  const [managers, setManagers] = useState<ManagersTarget | null>(null);
  const [search, setSearch] = useState("");

  if (!user) return null;
  if (!directory) return directoryError
    ? <Alert tone="error">{directoryError} <Button variant="outline" size="sm" onClick={() => void useAppStore.getState().refreshDirectory()}>重试</Button></Alert>
    : <Spinner />;

  const isAdmin = user.permissions.includes("manage_server");
  const keyword = search.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(keyword);
  const tree = groupRoomDirectory(directory.areas, rooms).map((root) => ({
    ...root,
    canManage: canManageArea(user, root.area, directory.grants),
    children: root.children.map((child) => ({
      ...child,
      canManage: canManageArea(user, child.area, directory.grants),
      rooms: child.rooms.filter((room) => canEditRoom(user, server, directory, room) &&
        matches(`${root.area.name} / ${child.area.name} / ${room.name}`)),
    })).filter((child) => (child.canManage && matches(`${root.area.name} / ${child.area.name}`)) || child.rooms.length > 0),
  })).filter((root) => (root.canManage && matches(root.area.name)) || root.children.length > 0);

  const openManagers = (scope: RoomManagementScope, path: string, inheritance?: string) => setManagers({ scope, path, inheritance });
  const removeArea = async (area: RoomArea) => {
    const ui = useUiStore.getState();
    const empty = !directory.areas.some((child) => child.parentId === area.id) && !rooms.some((room) => room.areaId === area.id);
    if (!empty) {
      ui.toast(area.parentId === null ? "请先清空并删除这个分区下的子区" : "请先移走或删除这个子区下的房间", "warning");
      return;
    }
    const ok = await ui.confirm({ title: "删除空分区", message: `确定删除「${area.name}」及其直接授权吗？`, confirmText: "删除分区", danger: true });
    if (!ok) return;
    try {
      await api.roomDirectory.remove(area.id);
      await useAppStore.getState().refreshDirectory();
    } catch (error) {
      ui.toast(errorMessage(error), "error");
    }
  };

  const actions = <>
          <IconButton label="刷新分区和房间" onClick={() => {
            const app = useAppStore.getState();
            void app.refreshDirectory();
            void app.refreshRooms();
          }}><RefreshCw className="h-4 w-4" /></IconButton>
          {isAdmin && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAreaEditor({ parent: null })}>添加一级分区</Button>}
  </>;
  const searchInput = <Input aria-label="搜索分区和房间" placeholder="搜索分区、子区或房间" leftIcon={<Search className="h-4 w-4" />} value={search} onChange={(event) => setSearch(event.target.value)} />;

  return (
    <div className="space-y-5">
      {inDialog ? <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">{searchInput}</div>
        <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>
      </div> : <>
        <PageHeader title="分区与房间管理" actions={actions} />
        {searchInput}
      </>}
      {directoryError && <Alert tone="error">{directoryError}</Alert>}
      {tree.length === 0 && <EmptyState icon={<Folder className="h-6 w-6" />} title={keyword ? "没有匹配的分区或房间" : isAdmin ? "还没有分区" : "暂无可管理的分区或房间"} />}
      {tree.map((root) => (
        <Card key={root.area.id} className="overflow-hidden">
          <section aria-label={root.area.name}>
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-3 sm:px-4">
              <Folder className="h-4 w-4 shrink-0 text-brand" />
              <h2 className="mr-auto min-w-0 truncate text-base font-semibold">{root.area.name}</h2>
              <div className="flex items-center gap-1">
                {root.canManage && <>
                  <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAreaEditor({ parent: root.area })}>添加子区</Button>
                  <IconButton label={`编辑一级分区 ${root.area.name}`} onClick={() => setAreaEditor({ area: root.area })}><Pencil className="h-4 w-4" /></IconButton>
                </>}
                {isAdmin && <>
                  <IconButton label={`管理 ${root.area.name} 的授权`} onClick={() => openManagers({ kind: "area", id: root.area.id }, root.area.name, "权限覆盖此分区、下面所有子区和房间，也会应用到以后添加的房间。") }><KeyRound className="h-4 w-4" /></IconButton>
                  <IconButton label={`删除一级分区 ${root.area.name}`} onClick={() => void removeArea(root.area)}><Trash2 className="h-4 w-4 text-destructive" /></IconButton>
                </>}
              </div>
            </div>
            {root.children.length === 0 && <p className="px-4 py-4 text-sm text-muted-foreground">还没有子区</p>}
            <div className="divide-y divide-border">
              {root.children.map((child) => {
                const path = `${root.area.name} / ${child.area.name}`;
                return (
                  <section key={child.area.id} aria-label={path} className="px-3 py-3 sm:px-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <h3 className="mr-auto min-w-0 truncate text-sm font-semibold">{child.area.name}</h3>
                      <div className="flex items-center gap-1">
                        {child.canManage && <>
                          <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRoomEditor({ kind: "create", areaId: child.area.id })}>创建房间</Button>
                          <IconButton label={`编辑子区 ${path}`} onClick={() => setAreaEditor({ area: child.area })}><Pencil className="h-4 w-4" /></IconButton>
                        </>}
                        {isAdmin && <IconButton label={`管理 ${path} 的授权`} onClick={() => openManagers({ kind: "area", id: child.area.id }, path, "权限覆盖此子区及其现有和未来的房间。") }><KeyRound className="h-4 w-4" /></IconButton>}
                        {root.canManage && <IconButton label={`删除子区 ${path}`} onClick={() => void removeArea(child.area)}><Trash2 className="h-4 w-4 text-destructive" /></IconButton>}
                      </div>
                    </div>
                    {child.rooms.length === 0 ? <p className="py-2 pl-6 text-sm text-muted-foreground">还没有房间</p> : (
                      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                        {child.rooms.map((room) => (
                          <li key={room.id} className="flex items-center gap-2 px-2 py-1 sm:px-3">
                            <RoomIcon icon={room.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="mr-auto min-w-0 truncate text-sm">{room.name}</span>
                            {room.locked && <Badge tone="warn">已锁定</Badge>}
                            {room.hasPassword && <span title="加密房" className="text-warning"><Lock className="h-3.5 w-3.5" /></span>}
                            <span className="shrink-0 text-xs text-muted-foreground">{room.userCount}/{room.maxUsers}</span>
                            <IconButton label={`编辑房间 ${room.name}`} onClick={() => setRoomEditor({ kind: "edit", roomId: room.id })}><Pencil className="h-4 w-4" /></IconButton>
                            {isAdmin && <IconButton label={`管理 ${room.name} 的授权`} onClick={() => openManagers({ kind: "room", id: room.id }, `${path} / ${room.name}`)}><KeyRound className="h-4 w-4" /></IconButton>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          </section>
        </Card>
      ))}
      {areaEditor && <AreaEditor target={areaEditor} onClose={() => setAreaEditor(null)} />}
      {roomEditor && <RoomEditor target={roomEditor} onClose={() => setRoomEditor(null)} />}
      {managers && <RoomManagersModal target={managers} onClose={() => setManagers(null)} />}
    </div>
  );
}

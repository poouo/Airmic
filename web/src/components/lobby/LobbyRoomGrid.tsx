import { useSearchParams } from "react-router-dom";
import type { RoomArea, RoomSummary } from "@airmic/shared";
import { DoorOpen, Folder, Plus } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { cn } from "@/lib/format";
import { groupRoomDirectory } from "@/stores/app";
import AreaIcon from "./AreaIcon";
import RoomCard from "./RoomCard";

interface LobbyRoomGridProps {
  areas: RoomArea[];
  rooms: RoomSummary[];
  currentRoomId: number | null;
  createAreas: RoomArea[];
  canEdit: (room: RoomSummary) => boolean;
  onJoin: (room: RoomSummary) => void;
  onEdit: (room: RoomSummary) => void;
  onCreate: (areaId: number) => void;
}

export default function LobbyRoomGrid({ areas, rooms, currentRoomId, createAreas, canEdit, onJoin, onEdit, onCreate }: LobbyRoomGridProps) {
  const tree = groupRoomDirectory(areas, rooms);
  const [searchParams, setSearchParams] = useSearchParams();
  const rootId = Number(searchParams.get("channel"));
  const childId = Number(searchParams.get("section"));
  const root = tree.find((node) => node.area.id === rootId) ?? tree.find((node) => node.children.some((child) => child.rooms.length > 0)) ?? tree[0];
  const child = root?.children.find((node) => node.area.id === childId);
  const visible = child ? [child] : root?.children ?? [];
  const sideBySide = visible.length > 1 && visible.every((section) => section.rooms.length <= 2);

  if (!root) return <EmptyState icon={<Folder className="h-6 w-6" />} title="还没有分区" />;

  return (
    <div className="space-y-5">
      <nav aria-label="一级分区" className="workspace-panel flex flex-wrap gap-1.5 rounded-2xl border border-border p-1.5 shadow-card">
        {tree.map(({ area, children }) => (
          <Button key={area.id} className="h-10" variant={root.area.id === area.id ? "secondary" : "ghost"} aria-pressed={root.area.id === area.id}
            icon={<AreaIcon icon={area.icon} isRoot className="h-5 w-5" />} onClick={() => setSearchParams({ channel: String(area.id) })}>
            {area.name}
            <span className="opacity-75">{children.reduce((total, node) => total + node.rooms.length, 0)}</span>
          </Button>
        ))}
      </nav>
      {root.children.length > 1 && (
        <nav aria-label="子区筛选" className="flex flex-wrap gap-1 border-b border-border pb-3">
          <Button className="min-h-10" size="sm" variant={child ? "ghost" : "secondary"} aria-pressed={!child}
            onClick={() => setSearchParams({ channel: String(root.area.id) })}>全部子区</Button>
          {root.children.map(({ area }) => <Button key={area.id} className="min-h-10" size="sm" variant={child?.area.id === area.id ? "secondary" : "ghost"}
            icon={area.icon ? <AreaIcon icon={area.icon} className="h-4 w-4" /> : undefined}
            aria-pressed={child?.area.id === area.id} onClick={() => setSearchParams({ channel: String(root.area.id), section: String(area.id) })}>{area.name}</Button>)}
        </nav>
      )}
      {visible.length === 0 && <EmptyState icon={<Folder className="h-6 w-6" />} title="这个分区还没有子区" />}
      <div key={root.area.id + ":" + (child?.area.id ?? "all")} className={cn("workspace-enter grid gap-5", sideBySide && "xl:grid-cols-2")}>
        {visible.map(({ area, rooms: children }) => (
          <section key={area.id} className="min-w-0 space-y-3">
            <div className="flex items-center gap-2">
              {area.icon && <AreaIcon icon={area.icon} className="h-5 w-5 shrink-0 text-muted-foreground" />}
              <h3 className="text-sm font-semibold text-foreground">{area.name}</h3>
              <Badge>{children.length}</Badge>
              {createAreas.some((item) => item.id === area.id) && <Button className="ml-auto" size="sm" variant="ghost"
                icon={<Plus className="h-4 w-4" />} onClick={() => onCreate(area.id)}>创建房间</Button>}
            </div>
            {children.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground"><DoorOpen className="mr-2 inline h-4 w-4" />这里还没有房间</p> : (
              <div className={cn("grid gap-4 sm:grid-cols-2", sideBySide && children.length === 1 && "xl:grid-cols-1", !sideBySide && "2xl:grid-cols-3")}>
                {children.map((room) => <RoomCard key={room.id} room={room} isCurrent={room.id === currentRoomId} canEdit={canEdit(room)} onJoin={onJoin} onEdit={onEdit} />)}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

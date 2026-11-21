import { GAME_LOGOS, type AreaIconId } from "@airmic/shared";
import { Folder, FolderOpen, Layers } from "lucide-react";
import { iconLabel, RoomIcon } from "@/components/room/roomIcons";
import { cn } from "@/lib/format";

export function findGameLogo(icon: AreaIconId | null) {
  return GAME_LOGOS.find((game) => game.id === icon);
}

export function areaIconLabel(icon: AreaIconId | null): string {
  if (!icon) return "默认图标";
  return findGameLogo(icon)?.label ?? iconLabel(icon);
}

export default function AreaIcon({
  icon,
  isRoot = false,
  expanded = false,
  className,
}: {
  icon: AreaIconId | null;
  isRoot?: boolean;
  expanded?: boolean;
  className?: string;
}) {
  if (findGameLogo(icon)) {
    return (
      <img src={`/game-logos/${icon}.png`} alt="" width={24} height={24} decoding="async"
        className={cn("rounded-sm bg-[#272a39] object-contain", className)} />
    );
  }
  if (icon) return <RoomIcon icon={icon} className={className} />;

  const DefaultIcon = isRoot ? (expanded ? FolderOpen : Folder) : Layers;
  return <DefaultIcon className={className} aria-hidden="true" />;
}

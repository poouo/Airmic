import {
  Car,
  Flame,
  Gamepad2,
  Headphones,
  Mic,
  Music,
  Shield,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface RoomIconOption {
  key: string;
  label: string;
  Icon: LucideIcon;
}

/** 房间可选图标（管理员创建/编辑房间时挑选）；key 会存入数据库 rooms.icon */
export const ROOM_ICONS: RoomIconOption[] = [
  { key: "gamepad", label: "游戏手柄", Icon: Gamepad2 },
  { key: "headphones", label: "耳机", Icon: Headphones },
  { key: "mic", label: "麦克风", Icon: Mic },
  { key: "flame", label: "火焰", Icon: Flame },
  { key: "star", label: "星星", Icon: Star },
  { key: "trophy", label: "奖杯", Icon: Trophy },
  { key: "music", label: "音乐", Icon: Music },
  { key: "car", label: "赛车", Icon: Car },
  { key: "users", label: "人群", Icon: Users },
  { key: "shield", label: "盾牌", Icon: Shield },
  { key: "target", label: "靶心", Icon: Target },
  { key: "sparkles", label: "闪光", Icon: Sparkles },
];

const FALLBACK_ICON = Gamepad2;
const FALLBACK_LABEL = "游戏手柄";

export interface RoomIconProps {
  /** 图标 key；未知 key 回退为游戏手柄 */
  icon: string;
  className?: string;
}

/** 按 key 渲染房间图标，未知 key 回退 Gamepad2 */
export function RoomIcon({ icon, className }: RoomIconProps) {
  const Icon = ROOM_ICONS.find((item) => item.key === icon)?.Icon ?? FALLBACK_ICON;
  return <Icon className={className} aria-hidden="true" />;
}

/** 图标 key 对应的中文名称，用于 title 提示 */
export function iconLabel(key: string): string {
  return ROOM_ICONS.find((item) => item.key === key)?.label ?? FALLBACK_LABEL;
}

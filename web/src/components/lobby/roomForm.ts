import type { AudioSettings, RoomDetail, RoomSummary } from "@airmic/shared";

/** 房间表单的初始值；audioKnown=false 表示拿不到房间音质覆盖（仅版主按摘要编辑时） */
export interface RoomFormInitial {
  id: number | null;
  name: string;
  description: string;
  category: string;
  /** 一级分组（频道） */
  channel: string;
  /** 房间图标 key（对应 ROOM_ICONS） */
  icon: string;
  hasPassword: boolean;
  /** 0 表示跟随服务器房间人数上限 */
  maxUsers: number;
  locked: boolean;
  screenShareEnabled: boolean;
  /** 房间音质覆盖；null 表示跟随服务器默认 */
  audioOverride: import("@airmic/shared").AudioOverride | null;
  /** 生效音质（用于编辑器初值） */
  audioSettings: AudioSettings;
  audioKnown: boolean;
}

export function createRoomInitial(base: AudioSettings, categories: string[], channels: string[] = []): RoomFormInitial {
  return {
    id: null,
    name: "",
    description: "",
    category: categories[0] ?? "开黑房间",
    channel: channels[0] ?? "默认频道",
    icon: "gamepad",
    hasPassword: false,
    maxUsers: 0,
    locked: false,
    screenShareEnabled: true,
    audioOverride: null,
    audioSettings: base,
    audioKnown: true,
  };
}

export function detailRoomInitial(room: RoomDetail): RoomFormInitial {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    category: room.category,
    channel: room.channel,
    icon: room.icon,
    hasPassword: room.hasPassword,
    maxUsers: room.maxUsers,
    locked: room.locked,
    screenShareEnabled: room.screenShareEnabled,
    audioOverride: room.audioOverride,
    audioSettings: room.audioSettings,
    audioKnown: true,
  };
}

/** 只有 RoomSummary 时使用：拿不到音质覆盖，只能编辑基础字段 */
export function summaryRoomInitial(room: RoomSummary, base: AudioSettings): RoomFormInitial {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    category: room.category,
    channel: room.channel,
    icon: room.icon,
    hasPassword: room.hasPassword,
    maxUsers: room.maxUsers,
    locked: room.locked,
    screenShareEnabled: room.screenShareEnabled,
    audioOverride: null,
    audioSettings: base,
    audioKnown: false,
  };
}

/** 保证当前分类一定出现在下拉选项中 */
export function categoryOptions(categories: string[], current: string): string[] {
  const list = categories.length > 0 ? [...categories] : ["开黑房间"];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

/** 从现有房间中提取频道列表（按出现顺序去重），用于创建房间时选择默认频道 */
export function channelOptions(rooms: RoomSummary[]): string[] {
  const list: string[] = [];
  for (const room of rooms) {
    const channel = room.channel || "默认频道";
    if (!list.includes(channel)) list.push(channel);
  }
  return list;
}

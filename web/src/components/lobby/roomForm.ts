import type { AudioSettings, RoomDetail } from "@airmic/shared";

export interface RoomFormInitial {
  id: number | null;
  name: string;
  description: string;
  areaId: number;
  sortOrder?: number;
  /** 房间图标 key（对应 ROOM_ICONS） */
  icon: string;
  hasPassword: boolean;
  codeOnly: boolean;
  /** 0 表示跟随服务器房间人数上限 */
  maxUsers: number;
  locked: boolean;
  allowGuests: boolean;
  textChatEnabled: boolean;
  chatHistoryDays: number;
  screenShareEnabled: boolean;
  /** 语音模式：open 自由发言，stage 上麦席位 */
  voiceMode: "open" | "stage";
  /** 上麦席位数，仅 stage 模式生效 */
  stageSeats: number;
  /** 房间音质覆盖；null 表示跟随服务器默认 */
  audioOverride: import("@airmic/shared").AudioOverride | null;
  /** 生效音质（用于编辑器初值） */
  audioSettings: AudioSettings;
}

export function createRoomInitial(base: AudioSettings, areaId: number): RoomFormInitial {
  return {
    id: null,
    name: "",
    description: "",
    areaId,
    icon: "gamepad",
    hasPassword: false,
    codeOnly: false,
    maxUsers: 0,
    locked: false,
    allowGuests: true,
    textChatEnabled: true,
    chatHistoryDays: 30,
    screenShareEnabled: true,
    voiceMode: "open",
    stageSeats: 4,
    audioOverride: null,
    audioSettings: base,
  };
}

export function detailRoomInitial(room: RoomDetail): RoomFormInitial {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    areaId: room.areaId,
    sortOrder: room.sortOrder,
    icon: room.icon,
    hasPassword: room.hasPassword,
    codeOnly: room.codeOnly,
    maxUsers: room.maxUsers,
    locked: room.locked,
    allowGuests: room.allowGuests !== false,
    textChatEnabled: room.textChatEnabled !== false,
    chatHistoryDays: room.chatHistoryDays ?? 30,
    screenShareEnabled: room.screenShareEnabled,
    voiceMode: room.voiceMode ?? "open",
    stageSeats: room.stageSeats ?? 4,
    audioOverride: room.audioOverride,
    audioSettings: room.audioSettings,
  };
}

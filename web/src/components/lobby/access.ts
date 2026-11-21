import { canManageArea, canManageRoomScope } from "@airmic/shared";
import type { RoomDirectory, RoomSummary, ServerSettingsPublic, UserSelf } from "@airmic/shared";

/** 与服务端 canCreateRoom 保持一致：有管理房间权限 / 服务器允许创建 / 游客创建开关 */
function allowsPersonalRooms(user: UserSelf, server: ServerSettingsPublic | null): boolean {
  return (user.isGuest ? server?.allowGuestRoomCreation : server?.allowRoomCreation) ?? false;
}

export function roomCreationAreas(user: UserSelf | null, server: ServerSettingsPublic | null, directory: RoomDirectory | null) {
  if (!user || !directory) return [];
  return directory.areas.filter((area) => area.parentId !== null && area.kind !== "code" && (
    allowsPersonalRooms(user, server) || canManageArea(user, area, directory.grants)
  ));
}

export function canEditRoom(user: UserSelf | null, server: ServerSettingsPublic | null, directory: RoomDirectory | null, room: RoomSummary): boolean {
  if (!user) return false;
  return user.permissions.includes("manage_rooms") || (!!directory && canManageRoomScope(user, room, directory)) ||
    (room.createdById === user.id && allowsPersonalRooms(user, server));
}

export function needsRoomPassword(user: UserSelf | null, directory: RoomDirectory | null, room: RoomSummary): boolean {
  if (!room.hasPassword) return false;
  if (!user || user.isGuest) return true;
  return !user.permissions.includes("manage_rooms") && (!directory || !canManageRoomScope(user, room, directory));
}

export function canOpenRoomManagement(user: UserSelf | null, server: ServerSettingsPublic | null, directory: RoomDirectory | null, rooms: RoomSummary[]): boolean {
  return !!user && (user.permissions.includes("manage_rooms") || !!directory?.grants.length ||
    rooms.some((room) => canEditRoom(user, server, directory, room)));
}

/** 是否可以进入管理后台 */
export function canAccessAdmin(user: UserSelf | null): boolean {
  if (!user) return false;
  const permissions = ["manage_server", "manage_rooms", "manage_users", "view_audit", "ban_users"] as const;
  return permissions.some((permission) => user.permissions.includes(permission));
}

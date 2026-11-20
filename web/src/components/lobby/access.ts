import type { ServerSettingsPublic, UserSelf } from "@airmic/shared";

/** 与服务端 canCreateRoom 保持一致：有管理房间权限 / 服务器允许创建 / 游客创建开关 */
export function canCreateRoom(user: UserSelf | null, server: ServerSettingsPublic | null): boolean {
  if (!user || !server) return false;
  if (user.permissions.includes("manage_rooms")) return true;
  if (user.role === "guest") return server.allowGuestRoomCreation;
  return server.allowRoomCreation;
}

/** 是否可以管理房间（编辑/删除任意房间） */
export function canManageRooms(user: UserSelf | null): boolean {
  return user?.permissions.includes("manage_rooms") ?? false;
}

/** 是否可以进入管理后台 */
export function canAccessAdmin(user: UserSelf | null): boolean {
  if (!user) return false;
  const permissions = ["manage_server", "manage_rooms", "manage_users", "view_audit", "ban_users"] as const;
  return permissions.some((permission) => user.permissions.includes(permission));
}

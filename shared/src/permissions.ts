import type { Permission, Role, RoomArea, RoomDirectory, RoomManagementScope, RoomSummary, UserSelf } from "./types.js";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "manage_server",
    "manage_rooms",
    "manage_users",
    "kick_users",
    "ban_users",
    "moderate_voice",
    "view_audit",
    "create_rooms",
  ],
  moderator: ["manage_rooms", "kick_users", "ban_users", "moderate_voice", "create_rooms"],
  user: ["create_rooms"],
  guest: [],
};

export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "管理员",
  moderator: "版主",
  user: "用户",
  guest: "游客",
};

export const ROLE_ORDER: Record<Role, number> = {
  admin: 0,
  moderator: 1,
  user: 2,
  guest: 3,
};

export function canManageArea(user: UserSelf, area: RoomArea, grants: RoomManagementScope[]): boolean {
  return user.permissions.includes("manage_rooms") || grants.some(
    (grant) => grant.kind === "area" && (grant.id === area.id || grant.id === area.parentId),
  );
}

export function canManageRoomScope(user: UserSelf, room: Pick<RoomSummary, "id" | "areaId">, directory: RoomDirectory): boolean {
  if (user.permissions.includes("manage_rooms")) return true;
  if (directory.grants.some((grant) => grant.kind === "room" && grant.id === room.id)) return true;
  const area = directory.areas.find((item) => item.id === room.areaId);
  return !!area && canManageArea(user, area, directory.grants);
}

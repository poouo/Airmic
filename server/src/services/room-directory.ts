import { canManageRoomScope, type RoomArea, type RoomDirectory, type RoomManagementScope, type RoomManager, type UserSelf } from "@airmic/shared";
import type { Database } from "../db.js";

const AREA_COLUMNS = "id, parent_id AS parentId, name, sort_order AS sortOrder, icon, kind";

export class RoomDirectoryService {
  constructor(private readonly db: Database) {}

  list(): RoomArea[] {
    return this.db.all<RoomArea>(`SELECT ${AREA_COLUMNS} FROM room_areas ORDER BY sort_order, id`);
  }

  forUser(userId: number): RoomDirectory {
    const grants = this.db.all<RoomManagementScope>(
      "SELECT CASE WHEN area_id IS NULL THEN 'room' ELSE 'area' END AS kind, COALESCE(area_id, room_id) AS id " +
      "FROM room_management_grants WHERE user_id = ?",
      userId,
    );
    return { areas: this.list(), grants };
  }

  canManageRoom(user: UserSelf, room: { id: number; area_id: number }): boolean {
    return !user.isGuest && (user.permissions.includes("manage_rooms") ||
      canManageRoomScope(user, { id: room.id, areaId: room.area_id }, this.forUser(user.id)));
  }

  find(id: number): RoomArea | undefined {
    return this.db.get<RoomArea>(`SELECT ${AREA_COLUMNS} FROM room_areas WHERE id = ?`, id);
  }

  findByName(parentId: number | null, name: string): RoomArea | undefined {
    return this.db.get<RoomArea>(`SELECT ${AREA_COLUMNS} FROM room_areas WHERE parent_id IS ? AND name = ?`, parentId, name);
  }

  codeArea(): RoomArea | undefined {
    return this.db.get<RoomArea>(`SELECT ${AREA_COLUMNS} FROM room_areas WHERE kind = 'code' AND parent_id IS NOT NULL`);
  }

  create(parentId: number | null, name: string, icon: RoomArea["icon"] = null): RoomArea {
    const { lastInsertRowid } = this.db.run("INSERT INTO room_areas (parent_id, name, icon) VALUES (?, ?, ?)", parentId, name, icon);
    return { id: lastInsertRowid, parentId, name, sortOrder: 0, icon, kind: "standard" };
  }

  update(area: RoomArea, name: string, sortOrder: number, icon: RoomArea["icon"]): RoomArea {
    this.db.run("UPDATE room_areas SET name = ?, sort_order = ?, icon = ? WHERE id = ?", name, sortOrder, icon, area.id);
    return { ...area, name, sortOrder, icon };
  }

  isEmpty(id: number): boolean {
    return !this.db.get("SELECT 1 FROM room_areas WHERE parent_id = ? UNION ALL SELECT 1 FROM rooms WHERE area_id = ? LIMIT 1", id, id);
  }

  remove(id: number): void {
    this.db.run("DELETE FROM room_areas WHERE id = ?", id);
  }

  managers(scope: RoomManagementScope): RoomManager[] {
    const column = scope.kind === "area" ? "area_id" : "room_id";
    return this.db.all<RoomManager>(
      `SELECT u.id AS userId, u.username, u.display_name AS displayName FROM room_management_grants g
       JOIN users u ON u.id = g.user_id WHERE g.${column} = ? ORDER BY u.username`,
      scope.id,
    );
  }

  grant(scope: RoomManagementScope, userId: number): void {
    const column = scope.kind === "area" ? "area_id" : "room_id";
    this.db.run(`INSERT INTO room_management_grants (user_id, ${column}) VALUES (?, ?) ON CONFLICT (${column}, user_id) DO NOTHING`, userId, scope.id);
  }

  revoke(scope: RoomManagementScope, userId: number): void {
    const column = scope.kind === "area" ? "area_id" : "room_id";
    this.db.run(`DELETE FROM room_management_grants WHERE ${column} = ? AND user_id = ?`, scope.id, userId);
  }
}

import type { OnlineUser } from "@airmic/shared";

/**
 * 实时层对 REST 路由暴露的能力。具体实现在 realtime/hub.ts，
 * 通过 realtime/instance.ts 的 setHub/getHub 访问。
 */
export interface HubLike {
  getRoomCounts(): Map<number, number>;
  getRoomIdForUser(userId: number): number | null;
  getOnlineUsers(): OnlineUser[];
  getOnlineCount(): number;
  /** 历史同时在线峰值 */
  getPeakOnline(): number;
  isOnline(userId: number): boolean;
  /** 踢出服务器或当前房间（scope=room 时仅离开房间） */
  kick(userId: number, scope: "server" | "room", reason: string): boolean;
  /** 断开连接但保留会话（例如退出登录/被封禁） */
  disconnectUser(userId: number, reason: string): boolean;
  forceMute(userId: number, muted: boolean, reason?: string): boolean;
  /** 管理员移动用户到指定房间；roomId=null 表示回到大厅 */
  moveToRoom(userId: number, roomId: number | null): boolean;
  /** 用户资料/角色变化后刷新其在房间/在线列表中的展示 */
  refreshUser(userId: number): void;
  broadcastRooms(): void;
  broadcastRoomUpdate(roomId: number): void;
  broadcastRoomDeleted(roomId: number, reason?: string): void;
  broadcastOnlineUsers(): void;
  broadcastServerSettings(): void;
  shutdown(): void;
}
import type { Role } from "@airmic/shared";

/** 房间舞台上的成员视图模型（自己也会被组装进来） */
export interface RoomMember {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  avatarColor: string;
  avatarEmoji: string | null;
  statusText: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  screenSharing: boolean;
  forceMuted: boolean;
  joinedAt: string;
  isSelf: boolean;
}

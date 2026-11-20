import type { Role } from "@airmic/shared";

export type RoleTone = "neutral" | "brand" | "good" | "warn" | "bad";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "管理员",
  moderator: "版主",
  user: "成员",
  guest: "游客",
};

export const ROLE_TONE: Record<Role, RoleTone> = {
  admin: "bad",
  moderator: "brand",
  user: "neutral",
  guest: "warn",
};

/** 普通成员不展示角色徽章，避免界面过于嘈杂 */
export function showRoleBadge(role: Role): boolean {
  return role !== "user";
}

/** 用于聊天气泡/头像的兜底颜色（找不到成员时的稳定配色） */
const FALLBACK_COLORS = ["#6366f1", "#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb7185", "#38bdf8"];

export function colorForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length] ?? FALLBACK_COLORS[0] ?? "#6366f1";
}

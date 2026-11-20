import { randomBytes, randomInt } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString("hex");
}

export function randomCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
}

const AVATAR_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
];

export function pickAvatarColor(): string {
  return AVATAR_COLORS[randomInt(0, AVATAR_COLORS.length)] as string;
}

export const AVATAR_COLOR_OPTIONS = AVATAR_COLORS;

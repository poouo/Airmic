import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

/** scrypt 密码哈希，格式：scrypt:N:r:p:saltHex:hashHex */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] as string, "hex");
  const expected = Buffer.from(parts[5] as string, "hex");
  try {
    const actual = scryptSync(password.normalize("NFKC"), salt, expected.length, { N: n, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 房间密码使用更轻量的哈希（仍带盐，防止明文存储） */
export function hashRoomPassword(password: string): string {
  return hashPassword(password);
}

export function verifyRoomPassword(password: string, stored: string | null | undefined): boolean {
  return verifyPassword(password, stored);
}

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return hours + ":" + minutes;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day + " " + formatClock(iso);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Date.now() - time;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + " 分钟前";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " 小时前";
  if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + " 天前";
  return formatDateTime(iso);
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return days + " 天 " + hours + " 小时";
  if (hours > 0) return hours + " 小时 " + minutes + " 分";
  if (minutes > 0) return minutes + " 分钟";
  return seconds + " 秒";
}

export function initials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const chars = Array.from(trimmed);
  if (/^[a-zA-Z0-9]/.test(trimmed)) {
    return chars.slice(0, 2).join("").toUpperCase();
  }
  return chars.slice(0, 2).join("");
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function formatKbps(kbps: number | null | undefined): string {
  if (kbps === null || kbps === undefined || !Number.isFinite(kbps)) return "-";
  if (kbps < 1) return "<1 kbps";
  return Math.round(kbps) + " kbps";
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
}

export function prettyKey(code: string): string {
  if (!code) return "";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "小键盘 " + code.slice(6);
  const map: Record<string, string> = {
    Space: "空格",
    ShiftLeft: "左 Shift",
    ShiftRight: "右 Shift",
    ControlLeft: "左 Ctrl",
    ControlRight: "右 Ctrl",
    AltLeft: "左 Alt",
    AltRight: "右 Alt",
    Tab: "Tab",
    CapsLock: "CapsLock",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
  };
  return map[code] ?? code;
}

export function usernameFromDisplay(displayName: string): string {
  const base = (displayName ?? "").trim().toLowerCase();
  const cleaned = base.replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 20);
}

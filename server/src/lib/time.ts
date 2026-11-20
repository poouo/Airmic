export function nowIso(): string {
  return new Date().toISOString();
}

export function isoAfterMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function isoAfterMinutes(minutes: number): string {
  return isoAfterMs(minutes * 60_000);
}

export function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return false;
  return time <= Date.now();
}

export function secondsSince(iso: string): number {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 1000));
}

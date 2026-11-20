/** 语义化版本比较（忽略构建元数据；预发布版本按规范视为更低） */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseVersion(input: string | null | undefined): ParsedVersion | null {
  if (!input) return null;
  const cleaned = input.trim().replace(/^v/i, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/** 返回 -1 / 0 / 1；无法解析时按 0 处理 */
export function compareVersions(left: string | null | undefined, right: string | null | undefined): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease > b.prerelease ? 1 : -1;
}

export function normalizeVersion(input: string | null | undefined): string | null {
  const parsed = parseVersion(input);
  if (!parsed) return null;
  return parsed.major + "." + parsed.minor + "." + parsed.patch;
}

import { APP_VERSION } from "@airmic/shared";
import type { UpdateCheckResponse } from "@airmic/shared";
import type { AppConfig } from "../config.js";
import { compareVersions, normalizeVersion } from "../lib/version.js";

interface GithubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
}

interface GithubTag {
  name?: string;
}

interface GithubRepoInfo {
  default_branch?: string;
  html_url?: string;
  pushed_at?: string;
}

interface GithubResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

const RELEASE_TTL_MS = 5 * 60_000;
const ERROR_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 8000;

/**
 * 在线更新检查：根据 GitHub 仓库的 Release / Tag / 默认分支判断是否有新版本。
 * 只做只读检查，真正升级由部署脚本（deploy/airmic）执行。
 */
export class UpdateService {
  private cache: { value: UpdateCheckResponse; at: number } | null = null;
  private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init);
  private readonly repo: string;
  private readonly repoUrl: string;

  constructor(private readonly config: AppConfig) {
    this.repo = config.githubRepo;
    this.repoUrl = "https://github.com/" + this.repo;
  }

  /** 测试/自托管镜像时替换 fetch 实现 */
  setFetcher(fetcher: typeof fetch): void {
    this.fetcher = fetcher;
    this.cache = null;
  }

  resetCache(): void {
    this.cache = null;
  }

  async check(force = false): Promise<UpdateCheckResponse> {
    const now = Date.now();
    if (!force && this.cache) {
      const ttl = this.cache.value.error ? ERROR_TTL_MS : RELEASE_TTL_MS;
      if (now - this.cache.at < ttl) return this.cache.value;
    }
    const value = await this.fetchUpdate();
    this.cache = { value, at: now };
    return value;
  }

  private emptyResponse(checkedAt: string, error: string): UpdateCheckResponse {
    return {
      currentVersion: APP_VERSION,
      latestVersion: null,
      latestRef: null,
      latestSource: "unknown",
      updateAvailable: false,
      repo: this.repo,
      repoUrl: this.repoUrl,
      releaseUrl: null,
      releaseName: null,
      publishedAt: null,
      checkedAt,
      error,
      upgradeHint: this.upgradeHint(),
    };
  }

  private upgradeHint(): string {
    return "在部署服务器上执行：./deploy/airmic.sh upgrade（Docker 部署会重建镜像并重启；也可在管理后台查看更新提示）。";
  }

  private async fetchUpdate(): Promise<UpdateCheckResponse> {
    const checkedAt = new Date().toISOString();
    const release = await this.github<GithubRelease>("/releases/latest");
    if (release.ok && release.data?.tag_name) {
      return this.fromTag(release.data.tag_name, checkedAt, "release", {
        releaseUrl: release.data.html_url ?? null,
        releaseName: release.data.name ?? null,
        publishedAt: release.data.published_at ?? null,
      });
    }

    const tags = await this.github<GithubTag[]>("/tags?per_page=100");
    if (tags.ok && Array.isArray(tags.data) && tags.data.length > 0) {
      const sorted = tags.data
        .map((tag) => ({ name: tag.name ?? "", version: normalizeVersion(tag.name) }))
        .filter((entry) => Boolean(entry.version))
        .sort((a, b) => compareVersions(b.version, a.version));
      const best = sorted[0];
      if (best && best.name) {
        return this.fromTag(best.name, checkedAt, "tag", {
          releaseUrl: this.repoUrl + "/releases/tag/" + encodeURIComponent(best.name),
        });
      }
    }

    const repoInfo = await this.github<GithubRepoInfo>("");
    if (repoInfo.ok && repoInfo.data) {
      const branch = repoInfo.data.default_branch ?? "main";
      return {
        currentVersion: APP_VERSION,
        latestVersion: null,
        latestRef: branch,
        latestSource: "branch",
        updateAvailable: true,
        repo: this.repo,
        repoUrl: this.repoUrl,
        releaseUrl: this.repoUrl + "/commits/" + encodeURIComponent(branch),
        releaseName: "开发分支（" + branch + "）",
        publishedAt: repoInfo.data.pushed_at ?? null,
        checkedAt,
        error: "仓库尚未发布版本 Tag/Release，升级将使用默认分支最新代码。建议在 GitHub 上打标签（如 v1.1.0）以获得版本化更新。",
        upgradeHint: this.upgradeHint(),
      };
    }

    const message = release.error ?? tags.error ?? repoInfo.error ?? "无法获取 GitHub 版本信息";
    return this.emptyResponse(checkedAt, message);
  }

  private fromTag(
    tag: string,
    checkedAt: string,
    source: "release" | "tag",
    extra: { releaseUrl?: string | null; releaseName?: string | null; publishedAt?: string | null },
  ): UpdateCheckResponse {
    const latestVersion = normalizeVersion(tag);
    const updateAvailable = latestVersion ? compareVersions(latestVersion, APP_VERSION) > 0 : false;
    return {
      currentVersion: APP_VERSION,
      latestVersion,
      latestRef: tag,
      latestSource: source,
      updateAvailable,
      repo: this.repo,
      repoUrl: this.repoUrl,
      releaseUrl: extra.releaseUrl ?? this.repoUrl + "/releases/tag/" + encodeURIComponent(tag),
      releaseName: extra.releaseName ?? tag,
      publishedAt: extra.publishedAt ?? null,
      checkedAt,
      error: null,
      upgradeHint: this.upgradeHint(),
    };
  }

  private async github<T>(apiPath: string): Promise<GithubResult<T>> {
    const url = "https://api.github.com/repos/" + this.repo + apiPath;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "AirMic-UpdateChecker/" + APP_VERSION,
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (this.config.githubToken) headers.Authorization = "Bearer " + this.config.githubToken;
      const response = await this.fetcher(url, { headers, signal: controller.signal });
      let data: T | null = null;
      try {
        data = (await response.json()) as T;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const message = response.status === 403 ? "GitHub API 访问受限（可能是速率限制），可配置 GITHUB_TOKEN 后重试" : "GitHub API 返回 " + response.status;
        return { ok: false, status: response.status, data, error: message };
      }
      return { ok: true, status: response.status, data, error: null };
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError" ? "检查更新超时（GitHub 不可达）" : "无法连接 GitHub：";
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, status: 0, data: null, error: message + (message.endsWith("：") ? detail : "") };
    } finally {
      clearTimeout(timer);
    }
  }
}

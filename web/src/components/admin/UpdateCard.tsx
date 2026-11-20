import { useCallback, useEffect, useState } from "react";
import type { UpdateCheckResponse } from "@airmic/shared";
import { ArrowUpRight, Github, RefreshCw, Sparkles } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { SectionCard } from "./shared";

/** 管理后台「系统更新」：读取 GitHub 上最新版本，只做检查；升级由部署脚本执行。 */
export default function UpdateCard() {
  const [info, setInfo] = useState<UpdateCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setInfo(await api.system.update(force));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check(false);
  }, [check]);

  const updateAvailable = info?.updateAvailable ?? false;

  return (
    <SectionCard
      title="系统更新"
      description="根据 GitHub 仓库的 Release / Tag 检查新版本。检查只读，实际升级请在部署服务器运行 airmic 部署脚本。"
      action={
        <Button variant="outline" size="sm" loading={loading} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void check(true)}>
          检查更新
        </Button>
      }
    >
      {error && <p className="mb-3 rounded-xl border border-bad-500/30 bg-bad-500/10 px-3 py-2 text-xs text-bad-400">{error}</p>}
      {!info && !error && <p className="text-xs text-mist-500">正在检查更新…</p>}
      {info && (
        <div className="space-y-3 text-xs">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-ink-900/50 px-3 py-2.5">
              <p className="text-[11px] text-mist-500">当前版本</p>
              <p className="mt-0.5 font-mono text-sm text-mist-100">v{info.currentVersion}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-ink-900/50 px-3 py-2.5">
              <p className="text-[11px] text-mist-500">GitHub 最新版本</p>
              <p className="mt-0.5 flex items-center gap-2 font-mono text-sm text-mist-100">
                {info.latestVersion ? "v" + info.latestVersion : info.latestRef ? info.latestRef : "未知"}
                {updateAvailable ? (
                  <Badge tone="warn">
                    <Sparkles className="h-3 w-3" /> 有新版本
                  </Badge>
                ) : (
                  <Badge tone="good">已是最新</Badge>
                )}
              </p>
            </div>
          </div>

          {info.latestSource === "branch" && (
            <p className="rounded-xl border border-warn-500/30 bg-warn-500/10 px-3 py-2 leading-relaxed text-warn-400">
              仓库尚未发布版本 Tag/Release，升级将使用默认分支（{info.latestRef}）最新代码。建议在 GitHub 打版本标签（如 v1.1.0）后重新检查。
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-mist-400">
            <a href={info.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-300 hover:text-brand-400">
              <Github className="h-3.5 w-3.5" /> {info.repo}
            </a>
            {info.releaseUrl && (
              <a href={info.releaseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-300 hover:text-brand-400">
                <ArrowUpRight className="h-3.5 w-3.5" /> 查看发布内容
              </a>
            )}
            <span>检查时间：{formatDateTime(info.checkedAt)}</span>
          </div>

          {updateAvailable && (
            <div className="rounded-xl border border-brand-400/30 bg-brand-500/10 px-3 py-2.5 leading-relaxed text-mist-300">
              <p className="font-medium text-mist-100">发现新版本，升级方式：</p>
              <p className="mt-1 text-[11px] text-mist-400">
                在服务器部署目录执行 <span className="rounded bg-white/5 px-1 py-0.5 font-mono text-mist-200">./deploy/airmic.sh upgrade</span>
                （Windows 使用 <span className="rounded bg-white/5 px-1 py-0.5 font-mono text-mist-200">.\deploy\airmic.ps1 upgrade</span>）；
                Docker 部署会自动重建镜像并重启。升级前会自动备份数据库，失败自动回滚。
              </p>
              <p className="mt-1 text-[11px] text-mist-500">{info.upgradeHint}</p>
            </div>
          )}

          {info.error && !updateAvailable && (
            <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 leading-relaxed text-mist-500">{info.error}</p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

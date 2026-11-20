import { useCallback, useEffect, useState } from "react";
import type { UpdateCheckResponse } from "@airmic/shared";
import { ArrowUpRight, Github, RefreshCw, Sparkles } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui";
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
      {error && <Alert tone="error">{error}</Alert>}
      {!info && !error && <p className="text-xs text-muted-foreground">正在检查更新…</p>}
      {info && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
              <p className="text-[11px] text-muted-foreground">当前版本</p>
              <p className="mt-0.5 font-mono text-sm font-medium text-foreground">v{info.currentVersion}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
              <p className="text-[11px] text-muted-foreground">GitHub 最新版本</p>
              <p className="mt-0.5 flex items-center gap-2 font-mono text-sm font-medium text-foreground">
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
            <Alert tone="warning">
              仓库尚未发布版本 Tag/Release，升级将使用默认分支（{info.latestRef}）最新代码。建议在 GitHub 打版本标签（如 v1.1.0）后重新检查。
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <a href={info.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
              <Github className="h-3.5 w-3.5" /> {info.repo}
            </a>
            {info.releaseUrl && (
              <a href={info.releaseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                <ArrowUpRight className="h-3.5 w-3.5" /> 查看发布内容
              </a>
            )}
            <span>检查时间：{formatDateTime(info.checkedAt)}</span>
          </div>

          {updateAvailable && (
            <div className="rounded-xl border border-brand/20 bg-brand/5 px-3.5 py-3 leading-relaxed">
              <p className="text-sm font-medium text-foreground">发现新版本，升级方式：</p>
              <p className="mt-1 text-xs text-muted-foreground">
                在服务器部署目录执行{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">./deploy/airmic.sh upgrade</code>
                （Windows 使用 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">.\deploy\airmic.ps1 upgrade</code>
                ）；Docker 部署会自动重建镜像并重启。升级前会自动备份数据库，失败自动回滚。
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{info.upgradeHint}</p>
            </div>
          )}

          {info.error && !updateAvailable && (
            <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-xs leading-relaxed text-muted-foreground">{info.error}</p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

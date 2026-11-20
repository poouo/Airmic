import { Fragment, useEffect, useState } from "react";
import type { AdminLogListResponse, AdminLogQuery, AdminLogRow, LogCategory, LogLevel } from "@airmic/shared";
import { Copy, Download, RefreshCw, Search, ScrollText } from "lucide-react";
import { Alert, Badge, Button, EmptyState, Input, Select, Switch } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { useAsyncData } from "./useAsyncData";
import { AdminErrorPanel, AdminLoading, SectionCard, TableShell, TBody, Td, Th, THead, Tr } from "./shared";

const LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const CATEGORIES: LogCategory[] = ["http", "ws", "auth", "admin", "system", "room", "voice", "error", "security"];
const PAGE_SIZES = [50, 100, 200];

const LEVEL_LABELS: Record<LogLevel, string> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "fatal",
};

const CATEGORY_LABELS: Record<LogCategory, string> = {
  http: "网络请求",
  ws: "实时连接",
  auth: "认证",
  admin: "管理操作",
  system: "系统",
  room: "房间",
  voice: "语音",
  error: "异常",
  security: "安全",
};

const LEVEL_OPTIONS = [{ value: "", label: "全部级别" }, ...LEVELS.map((level) => ({ value: level, label: LEVEL_LABELS[level] }))];
const CATEGORY_OPTIONS = [{ value: "", label: "全部分类" }, ...CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] }))];

const LEVEL_TONES: Record<LogLevel, { tone: "neutral" | "brand" | "warn" | "bad"; label: string }> = {
  trace: { tone: "neutral", label: "TRACE" },
  debug: { tone: "neutral", label: "DEBUG" },
  info: { tone: "brand", label: "INFO" },
  warn: { tone: "warn", label: "WARN" },
  error: { tone: "bad", label: "ERROR" },
  fatal: { tone: "bad", label: "FATAL" },
};

/** 把 meta JSON 字符串格式化为可读文本 */
function formatMeta(meta: string | null): string {
  if (!meta) return "（无附加信息）";
  try {
    const parsed: unknown = JSON.parse(meta);
    return JSON.stringify(parsed, null, 2) ?? meta;
  } catch {
    return meta;
  }
}

/** 从 Content-Disposition 解析下载文件名 */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded && encoded[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return encoded[1];
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain && plain[1] ? plain[1] : null;
}

async function exportErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text) {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        const errorValue = (parsed as { error?: unknown }).error;
        if (errorValue && typeof errorValue === "object" && "message" in errorValue) {
          const messageValue = (errorValue as { message?: unknown }).message;
          if (typeof messageValue === "string" && messageValue) return messageValue;
        }
      }
    }
  } catch {
    /* 忽略解析失败，使用默认提示 */
  }
  return "导出失败（HTTP " + response.status + "）";
}

function LevelBadge({ level }: { level: LogLevel }) {
  const style = LEVEL_TONES[level];
  return <Badge tone={style.tone}>{style.label}</Badge>;
}

/** 管理后台 - 运行日志（排障用，服务端 SQLite 持久化，默认保留数天） */
export default function LogsTab() {
  const [level, setLevel] = useState<LogLevel | "">("");
  const [category, setCategory] = useState<LogCategory | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);

  const { data, loading, error, reload } = useAsyncData<AdminLogListResponse>(
    () =>
      api.admin.logs({
        page,
        pageSize,
        level: level || undefined,
        category: category || undefined,
        search: search || undefined,
      }),
    [page, pageSize, level, category, search],
  );

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const retentionDays = data?.retentionDays ?? 3;

  // 关键字搜索 300ms 防抖；筛选/搜索变化回到第 1 页
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // 自动刷新：每 10 秒拉取当前页（默认关闭）
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => reload(), 10_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, reload]);

  const handleLevelChange = (value: string) => {
    setLevel(value as LogLevel | "");
    setPage(1);
  };

  const handleCategoryChange = (value: string) => {
    setCategory(value as LogCategory | "");
    setPage(1);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async (format: "csv" | "json") => {
    setExporting(format);
    try {
      const query: AdminLogQuery = {
        level: level || undefined,
        category: category || undefined,
        search: search || undefined,
      };
      const response = await fetch(api.admin.logsExportUrl(query, format), { credentials: "same-origin" });
      if (!response.ok) throw new Error(await exportErrorMessage(response));
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get("content-disposition")) ?? "airmic-logs." + format;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      useUiStore.getState().toast("日志已导出：" + filename, "success");
    } catch (caught) {
      useUiStore.getState().toast(errorMessage(caught), "error");
    } finally {
      setExporting(null);
    }
  };

  const handleCopyMeta = async (row: AdminLogRow) => {
    try {
      await navigator.clipboard.writeText(formatMeta(row.meta));
      useUiStore.getState().toast("meta 已复制到剪贴板", "success");
    } catch {
      useUiStore.getState().toast("复制失败，请手动选择文本复制", "error");
    }
  };

  return (
    <div className="space-y-4">
      <Alert tone="info" title={"运行日志仅保留最近 " + retentionDays + " 天，超期自动清理；敏感信息不记录请求体/密码。"}>
        <p className="text-[11px] text-muted-foreground">
          最早记录：{formatDateTime(data?.oldest)} · 最新记录：{formatDateTime(data?.newest)}
        </p>
      </Alert>

      <SectionCard
        title="运行日志"
        description={"共 " + total + " 条记录 · 按时间倒序，点击行可展开 meta 详情"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              loading={exporting === "csv"}
              disabled={exporting !== null}
              onClick={() => void handleExport("csv")}
            >
              导出 CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              loading={exporting === "json"}
              disabled={exporting !== null}
              onClick={() => void handleExport("json")}
            >
              导出 JSON
            </Button>
          </div>
        }
        bodyClassName="p-0"
      >
        <div className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3">
          <div className="w-28">
            <Select label="级别" options={LEVEL_OPTIONS} value={level} onChange={(event) => handleLevelChange(event.target.value)} />
          </div>
          <div className="w-36">
            <Select label="分类" options={CATEGORY_OPTIONS} value={category} onChange={(event) => handleCategoryChange(event.target.value)} />
          </div>
          <div className="min-w-[12rem] flex-1">
            <Input
              label="搜索"
              value={searchInput}
              maxLength={100}
              leftIcon={<Search className="h-4 w-4" />}
              placeholder="搜索消息 / 用户 / IP / meta"
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <Button variant="outline" size="md" icon={<RefreshCw className="h-4 w-4" />} loading={loading} onClick={reload}>
            刷新
          </Button>
          <div className="flex items-center gap-2 rounded-field border border-border bg-card px-2.5 py-1.5">
            <Switch label="自动刷新" checked={autoRefresh} onChange={setAutoRefresh} />
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">每 10 秒</span>
          </div>
        </div>

        {error ? (
          <div className="px-5 py-5">
            <AdminErrorPanel message={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <AdminLoading text="正在加载运行日志…" />
        ) : rows.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              icon={<ScrollText className="h-5 w-5" />}
              title="没有匹配的运行日志"
              description="调整级别 / 分类 / 关键字筛选，或等待服务器产生新的日志记录"
            />
          </div>
        ) : (
          <TableShell>
            <THead>
              <Th className="w-36">时间</Th>
              <Th className="w-20">级别</Th>
              <Th className="w-24">分类</Th>
              <Th>消息</Th>
              <Th className="w-28">用户</Th>
              <Th className="w-32">IP</Th>
            </THead>
            <TBody>
              {rows.map((row) => {
                const expanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <Tr
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                      title={expanded ? "点击收起详情" : "点击展开 meta 详情"}
                      className="cursor-pointer"
                    >
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</Td>
                      <Td>
                        <LevelBadge level={row.level} />
                      </Td>
                      <Td>
                        <span className="text-sm">{CATEGORY_LABELS[row.category]}</span>
                      </Td>
                      <Td className="max-w-[28rem]">
                        <p className="line-clamp-2 break-all text-sm leading-relaxed text-foreground/90">{row.message}</p>
                      </Td>
                      <Td>
                        {row.username ? (
                          <div className="min-w-0">
                            <p className="truncate text-xs text-foreground/90">{row.username}</p>
                            {row.userId !== null && <p className="font-mono text-[11px] text-muted-foreground">#{row.userId}</p>}
                          </div>
                        ) : row.userId !== null ? (
                          <span className="font-mono text-xs text-muted-foreground">#{row.userId}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </Td>
                      <Td className="max-w-[12rem]">
                        <span className="block truncate font-mono text-[11px] text-muted-foreground" title={row.ip ?? ""}>
                          {row.ip ?? "-"}
                        </span>
                      </Td>
                    </Tr>
                    {expanded && (
                      <tr className="bg-muted/40">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                                <ScrollText className="h-3.5 w-3.5" />
                                meta（附加信息）
                              </p>
                              <pre className="max-h-64 overflow-auto app-scroll whitespace-pre-wrap break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90">
                                {formatMeta(row.meta)}
                              </pre>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                                <span>id: {row.id}</span>
                                {row.requestId && <span>requestId: {row.requestId}</span>}
                                {row.ip && <span>ip: {row.ip}</span>}
                              </div>
                            </div>
                            {row.meta && (
                              <Button
                                variant="outline"
                                size="sm"
                                icon={<Copy className="h-3.5 w-3.5" />}
                                onClick={() => void handleCopyMeta(row)}
                              >
                                复制 meta
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </TableShell>
        )}

        <LogsPagination
          page={page}
          pageSize={pageSize}
          total={total}
          loading={loading}
          onPage={setPage}
          onPageSize={handlePageSizeChange}
        />
      </SectionCard>
    </div>
  );
}

function LogsPagination({
  page,
  pageSize,
  total,
  loading,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const [jump, setJump] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const jumpToPage = () => {
    const target = Number(jump);
    if (!Number.isFinite(target) || jump.trim() === "") {
      setJump("");
      return;
    }
    onPage(Math.min(totalPages, Math.max(1, Math.trunc(target))));
    setJump("");
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
      <span className="tabular">
        共 {total} 条 · 第 {Math.min(page, totalPages)}/{totalPages} 页
      </span>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-36">
          <Select
            label="每页条数"
            options={PAGE_SIZES.map((size) => ({ value: String(size), label: "每页 " + size + " 条" }))}
            value={String(pageSize)}
            disabled={loading}
            onChange={(event) => onPageSize(Number(event.target.value))}
          />
        </div>
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
          上一页
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>
          下一页
        </Button>
        <div className="flex items-center gap-1">
          <input
            value={jump}
            inputMode="numeric"
            placeholder="页码"
            aria-label="跳转页码"
            onChange={(event) => setJump(event.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(event) => {
              if (event.key === "Enter") jumpToPage();
            }}
            className="h-8 w-16 rounded-field border border-input bg-card px-2 text-xs text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/15"
          />
          <Button variant="outline" size="sm" disabled={loading} onClick={jumpToPage}>
            跳转
          </Button>
        </div>
      </div>
    </div>
  );
}

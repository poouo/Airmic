import { useState } from "react";
import type { AdminAuditResponse } from "@airmic/shared";
import { FileClock, RefreshCw } from "lucide-react";
import { Badge, Button, EmptyState, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAsyncData } from "./useAsyncData";
import { actionLabel, ACTION_LABELS, AdminErrorPanel, AdminLoading, AdminPagination, SectionCard, TableShell, Td, Th } from "./shared";

const ACTION_OPTIONS = [{ value: "", label: "全部操作类型" }, ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))];

function detailsText(details: string | null): string {
  if (!details) return "-";
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => key + "=" + String(value))
        .join("  ");
    }
    return details;
  } catch {
    return details;
  }
}

export default function AuditTab() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, loading, error, reload } = useAsyncData<AdminAuditResponse>(
    () => api.admin.audit({ page, pageSize, action: action || undefined }),
    [page, pageSize, action],
  );

  const rows = data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="审计日志"
        description={"共 " + (data?.total ?? 0) + " 条操作记录"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <Select
                label="操作类型"
                options={ACTION_OPTIONS}
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={loading} onClick={reload}>
              刷新
            </Button>
          </div>
        }
        bodyClassName="p-0"
      >
        {error ? (
          <div className="p-4">
            <AdminErrorPanel message={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <AdminLoading text="正在加载审计日志…" />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={<FileClock className="h-5 w-5" />} title="暂无审计记录" description="管理员和版主的关键操作会自动记录" />
          </div>
        ) : (
          <>
            <TableShell>
              <thead>
                <tr>
                  <Th>时间</Th>
                  <Th>操作者</Th>
                  <Th>操作</Th>
                  <Th>目标</Th>
                  <Th>IP</Th>
                  <Th>详情</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-white/[0.02]">
                    <Td className="whitespace-nowrap text-[11px] text-mist-500">{formatDateTime(row.createdAt)}</Td>
                    <Td className="whitespace-nowrap text-xs text-mist-200">{row.actorName}</Td>
                    <Td><Badge tone="brand">{actionLabel(row.action)}</Badge></Td>
                    <Td className="max-w-[12rem]">
                      <p className="truncate text-xs" title={row.targetName ?? ""}>
                        {row.targetType ? <span className="mr-1 text-[10px] text-mist-500">[{row.targetType}]</span> : null}
                        {row.targetName ?? "-"}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-[10px] text-mist-500">{row.ip ?? "-"}</Td>
                    <Td className="max-w-[18rem]">
                      <p className="truncate text-[11px] text-mist-400" title={row.details ?? ""}>{detailsText(row.details)}</p>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <AdminPagination
              page={page}
              pageSize={pageSize}
              total={data?.total ?? 0}
              loading={loading}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </SectionCard>
    </div>
  );
}

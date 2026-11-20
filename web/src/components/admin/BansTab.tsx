import { useState } from "react";
import type { AdminBanListResponse } from "@airmic/shared";
import { Ban, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, EmptyState, Tabs } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useAsyncData } from "./useAsyncData";
import BanCreateModal from "./BanCreateModal";
import {
  AdminErrorPanel,
  AdminLoading,
  AdminPagination,
  banStatus,
  banTarget,
  SectionCard,
  TableShell,
  Td,
  Th,
} from "./shared";

type Filter = "active" | "all";

export default function BansTab() {
  const canSearchUsers = useAuthStore((state) => state.user?.permissions.includes("manage_users") ?? false);
  const [filter, setFilter] = useState<Filter>("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const { data, loading, error, reload } = useAsyncData<AdminBanListResponse>(
    () => api.admin.bans({ active: filter === "active" ? true : undefined, page, pageSize }),
    [filter, page, pageSize],
  );

  const rows = data?.items ?? [];

  const handleUnban = async (id: number, target: string) => {
    const confirmed = await useUiStore.getState().confirm({
      title: "解除封禁",
      message: "确定解除对「" + target + "」的封禁吗？解除后该用户/IP 可以重新登录。",
      confirmText: "解除封禁",
    });
    if (!confirmed) return;
    setBusyId(id);
    try {
      await api.admin.updateBan(id, { active: false });
      useUiStore.getState().toast("封禁已解除", "success");
      reload();
    } catch (caught) {
      useUiStore.getState().toast(errorMessage(caught), "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          items={[
            { id: "active", label: "生效中", icon: ShieldCheck },
            { id: "all", label: "全部记录", icon: Ban },
          ]}
          value={filter}
          onChange={(id) => {
            setFilter(id === "all" ? "all" : "active");
            setPage(1);
          }}
          className="w-56"
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={loading} onClick={reload}>
            刷新
          </Button>
          <Button size="sm" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
            新增封禁
          </Button>
        </div>
      </div>

      <SectionCard title="封禁列表" description={"共 " + (data?.total ?? 0) + " 条记录"} bodyClassName="p-0">
        {error ? (
          <div className="p-4">
            <AdminErrorPanel message={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <AdminLoading text="正在加载封禁列表…" />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title={filter === "active" ? "当前没有生效中的封禁" : "暂无封禁记录"} description="封禁账号或 IP 后可在这里管理" />
          </div>
        ) : (
          <>
            <TableShell>
              <thead>
                <tr>
                  <Th>封禁对象</Th>
                  <Th>类型</Th>
                  <Th>原因</Th>
                  <Th>状态</Th>
                  <Th>创建时间</Th>
                  <Th>操作者</Th>
                  <Th className="text-right">操作</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ban) => {
                  const status = banStatus(ban);
                  return (
                    <tr key={ban.id} className="transition-colors hover:bg-white/[0.02]">
                      <Td>
                        <p className="text-xs font-medium text-mist-100">{banTarget(ban)}</p>
                        {ban.username && ban.ip && <p className="font-mono text-[10px] text-mist-500">{ban.ip}</p>}
                      </Td>
                      <Td>{ban.userId !== null ? <Badge tone="brand">账号</Badge> : <Badge tone="warn">IP</Badge>}</Td>
                      <Td className="max-w-[14rem]">
                        <p className="truncate text-xs" title={ban.reason}>{ban.reason}</p>
                      </Td>
                      <Td><Badge tone={status.tone}>{status.label}</Badge></Td>
                      <Td className="text-[11px] text-mist-500">{formatDateTime(ban.createdAt)}</Td>
                      <Td className="text-[11px] text-mist-500">{ban.bannedByName ?? "-"}</Td>
                      <Td className="text-right">
                        {ban.active ? (
                          <Button variant="outline" size="sm" loading={busyId === ban.id} onClick={() => void handleUnban(ban.id, banTarget(ban))}>
                            解除封禁
                          </Button>
                        ) : (
                          <span className="text-[11px] text-mist-500">已解除</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
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

      {creating && (
        <BanCreateModal
          canSearchUsers={canSearchUsers}
          onClose={() => setCreating(false)}
          onCreated={() => {
            reload();
            setFilter("active");
            setPage(1);
          }}
        />
      )}
    </div>
  );
}

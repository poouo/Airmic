import { useEffect, useState } from "react";
import type { AdminUserListResponse } from "@airmic/shared";
import { RefreshCw, Search, UserCog } from "lucide-react";
import { Avatar, Badge, Button, EmptyState, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useAsyncData } from "./useAsyncData";
import UserManageModal from "./UserManageModal";
import {
  AdminErrorPanel,
  AdminLoading,
  AdminPagination,
  managedFromAdminUser,
  OnlineDot,
  RoleBadge,
  SectionCard,
  TableShell,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  userPageRows,
  type ManagedUser,
} from "./shared";

const ROLE_OPTIONS = [
  { value: "", label: "全部角色" },
  { value: "admin", label: "管理员" },
  { value: "moderator", label: "版主" },
  { value: "user", label: "用户" },
  { value: "guest", label: "游客" },
];

export default function UsersTab() {
  const self = useAuthStore((state) => state.user);
  const rooms = useAppStore((state) => state.rooms);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [managed, setManaged] = useState<ManagedUser | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data, loading, error, reload } = useAsyncData<AdminUserListResponse>(
    () => api.admin.users({ search: search || undefined, role: role || undefined, page, pageSize }),
    [search, role, page, pageSize],
  );

  const rows = data ? userPageRows(data) : [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="用户列表"
        description={"共 " + (data?.total ?? 0) + " 个账号 · 当前在线 " + (data?.onlineCount ?? 0) + " 人"}
        action={
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={loading} onClick={reload}>
            刷新
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3">
          <div className="min-w-[12rem] flex-1">
            <Input
              label="搜索用户"
              value={searchInput}
              maxLength={64}
              leftIcon={<Search className="h-4 w-4" />}
              placeholder="用户名或昵称，回车搜索"
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setSearch(searchInput.trim());
                  setPage(1);
                }
              }}
            />
          </div>
          <div className="w-36">
            <Select
              label="角色筛选"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        {error ? (
          <div className="px-5 py-5">
            <AdminErrorPanel message={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <AdminLoading text="正在加载用户列表…" />
        ) : rows.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState icon={<Search className="h-5 w-5" />} title="没有匹配的用户" description="尝试更换搜索关键字或角色筛选条件" />
          </div>
        ) : (
          <>
            <TableShell stickyActions>
              <THead>
                <Th>用户</Th>
                <Th>角色</Th>
                <Th>状态</Th>
                <Th>所在房间</Th>
                <Th>最后活跃</Th>
                <Th className="text-right">操作</Th>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.displayName} color={row.avatarColor} emoji={row.avatarEmoji} size="xs" />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1 truncate text-sm font-medium text-foreground">
                            {row.displayName}
                            {row.id === self?.id && <span className="text-[11px] font-normal text-muted-foreground">（你）</span>}
                            {row.isGuest && <Badge>游客</Badge>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">@{row.username}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <RoleBadge role={row.role} />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <OnlineDot online={row.online} />
                        {row.isBanned && <Badge tone="bad">已封禁</Badge>}
                      </div>
                    </Td>
                    <Td className="text-sm">{row.roomName ?? <span className="text-muted-foreground">大厅</span>}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted-foreground">{row.lastSeenAt ? formatRelative(row.lastSeenAt) : "从未登录"}</Td>
                    <Td className="text-right">
                      <Button variant="outline" size="sm" icon={<UserCog className="h-3.5 w-3.5" />} onClick={() => setManaged(managedFromAdminUser(row))}>
                        管理
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
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

      {managed && <UserManageModal user={managed} rooms={rooms} onClose={() => setManaged(null)} onChanged={reload} />}
    </div>
  );
}

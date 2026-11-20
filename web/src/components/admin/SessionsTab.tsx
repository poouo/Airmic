import { useState } from "react";
import type { AdminSessionsResponse } from "@airmic/shared";
import { KeyRound, RefreshCw, Search } from "lucide-react";
import { EmptyState, Button, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAsyncData } from "./useAsyncData";
import { AdminErrorPanel, AdminLoading, RoleBadge, SectionCard, TableShell, TBody, Td, Th, THead, Tr } from "./shared";

function shortenUserAgent(ua: string | null): string {
  if (!ua) return "-";
  if (ua.length <= 56) return ua;
  return ua.slice(0, 53) + "…";
}

export default function SessionsTab() {
  const [search, setSearch] = useState("");
  const { data, loading, error, reload } = useAsyncData<AdminSessionsResponse>(() => api.admin.sessions(), []);

  const keyword = search.trim().toLowerCase();
  const rows = (data?.sessions ?? []).filter((session) => {
    if (!keyword) return true;
    return (
      session.username.toLowerCase().includes(keyword) ||
      session.displayName.toLowerCase().includes(keyword) ||
      (session.ip ?? "").toLowerCase().includes(keyword)
    );
  });

  return (
    <div className="space-y-4">
      <SectionCard
        title="登录会话"
        description={"共 " + (data?.sessions.length ?? 0) + " 个有效会话 · 仅显示未过期且未注销的登录"}
        action={
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-52">
              <Input
                label="搜索"
                value={search}
                leftIcon={<Search className="h-4 w-4" />}
                placeholder="用户名 / 昵称 / IP"
                onChange={(event) => setSearch(event.target.value)}
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
          <div className="px-5 py-5">
            <AdminErrorPanel message={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <AdminLoading text="正在加载登录会话…" />
        ) : rows.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState icon={<KeyRound className="h-5 w-5" />} title="没有匹配的登录会话" description="用户登录后会在这里显示，可用于排查异常登录" />
          </div>
        ) : (
          <TableShell>
            <THead>
              <Th>用户</Th>
              <Th>角色</Th>
              <Th>IP</Th>
              <Th>客户端</Th>
              <Th>登录时间</Th>
              <Th>最后活跃</Th>
              <Th>过期时间</Th>
            </THead>
            <TBody>
              {rows.map((session) => (
                <Tr key={session.id}>
                  <Td>
                    <p className="text-sm font-medium text-foreground">{session.displayName}</p>
                    <p className="text-xs text-muted-foreground">@{session.username}</p>
                  </Td>
                  <Td>
                    <RoleBadge role={session.role} />
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{session.ip ?? "-"}</Td>
                  <Td className="max-w-[16rem]">
                    <p className="truncate text-xs text-muted-foreground" title={session.userAgent ?? ""}>
                      {shortenUserAgent(session.userAgent)}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(session.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(session.lastSeenAt)}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(session.expiresAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </TableShell>
        )}
      </SectionCard>
    </div>
  );
}

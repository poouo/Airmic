import { useState } from "react";
import type { AdminSessionsResponse } from "@airmic/shared";
import { KeyRound, RefreshCw, Search } from "lucide-react";
import { EmptyState, Button, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAsyncData } from "./useAsyncData";
import { AdminErrorPanel, AdminLoading, RoleBadge, SectionCard, TableShell, Td, Th } from "./shared";

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
          <div className="flex items-center gap-2">
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
          <div className="p-4">
            <AdminErrorPanel message={error} onRetry={reload} />
          </div>
        ) : loading && !data ? (
          <AdminLoading text="正在加载登录会话…" />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={<KeyRound className="h-5 w-5" />} title="没有匹配的登录会话" description="用户登录后会在这里显示，可用于排查异常登录" />
          </div>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>用户</Th>
                <Th>角色</Th>
                <Th>IP</Th>
                <Th>客户端</Th>
                <Th>登录时间</Th>
                <Th>最后活跃</Th>
                <Th>过期时间</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((session) => (
                <tr key={session.id} className="transition-colors hover:bg-white/[0.02]">
                  <Td>
                    <p className="text-xs font-medium text-mist-100">{session.displayName}</p>
                    <p className="text-[10px] text-mist-500">@{session.username}</p>
                  </Td>
                  <Td><RoleBadge role={session.role} /></Td>
                  <Td className="whitespace-nowrap font-mono text-[11px] text-mist-300">{session.ip ?? "-"}</Td>
                  <Td className="max-w-[16rem]">
                    <p className="truncate text-[11px] text-mist-400" title={session.userAgent ?? ""}>{shortenUserAgent(session.userAgent)}</p>
                  </Td>
                  <Td className="whitespace-nowrap text-[11px] text-mist-500">{formatDateTime(session.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-[11px] text-mist-500">{formatRelative(session.lastSeenAt)}</Td>
                  <Td className="whitespace-nowrap text-[11px] text-mist-500">{formatDateTime(session.expiresAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>
    </div>
  );
}

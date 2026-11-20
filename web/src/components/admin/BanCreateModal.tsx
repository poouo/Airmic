import { useState } from "react";
import type { AdminUserRow } from "@airmic/shared";
import { Ban, Search, UserRound } from "lucide-react";
import { Alert, Avatar, Button, Input, Modal, Select, Tabs, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import { RoleBadge, userPageRows } from "./shared";

const BAN_DURATIONS = [
  { value: "60", label: "1 小时" },
  { value: "1440", label: "1 天" },
  { value: "10080", label: "7 天" },
  { value: "43200", label: "30 天" },
  { value: "0", label: "永久" },
];

export interface BanCreateModalProps {
  /** 是否有「用户管理」权限（没有时无法搜索用户，只能按 IP 封禁） */
  canSearchUsers: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function BanCreateModal({ canSearchUsers, onClose, onCreated }: BanCreateModalProps) {
  const [mode, setMode] = useState<"user" | "ip">(canSearchUsers ? "user" : "ip");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AdminUserRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [ip, setIp] = useState("");
  const [duration, setDuration] = useState("1440");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = async () => {
    if (!search.trim()) {
      setError("请输入用户名或昵称");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const page = await api.admin.users({ search: search.trim(), page: 1, pageSize: 10 });
      setResults(userPageRows(page as unknown as { items?: AdminUserRow[]; users?: AdminUserRow[] }));
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      useUiStore.getState().toast(message, "error");
    } finally {
      setSearching(false);
    }
  };

  const effectiveMode = canSearchUsers ? mode : "ip";

  const handleSubmit = async () => {
    if (effectiveMode === "user" && !selected) {
      setError("请先搜索并选择要封禁的用户");
      return;
    }
    if (effectiveMode === "ip" && !ip.trim()) {
      setError("请输入要封禁的 IP 地址");
      return;
    }
    if (!reason.trim()) {
      setError("请填写封禁原因");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.admin.createBan({
        userId: effectiveMode === "user" && selected ? selected.id : undefined,
        ip: effectiveMode === "ip" ? ip.trim() : undefined,
        reason: reason.trim(),
        durationMinutes: Number(duration),
      });
      useUiStore.getState().toast("封禁已创建", "success");
      onCreated();
      onClose();
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      useUiStore.getState().toast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={submitting ? () => undefined : onClose}
      title="新增封禁"
      subtitle="可以按用户账号或 IP 地址封禁，封禁立即生效"
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="danger" size="sm" icon={<Ban className="h-3.5 w-3.5" />} loading={submitting} onClick={() => void handleSubmit()}>
            创建封禁
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {canSearchUsers ? (
          <Tabs
            items={[
              { id: "user", label: "按用户封禁", icon: UserRound },
              { id: "ip", label: "按 IP 封禁", icon: Ban },
            ]}
            value={mode}
            onChange={(id) => setMode(id === "ip" ? "ip" : "user")}
          />
        ) : (
          <Alert tone="warning">当前账号没有「用户管理」权限，无法搜索用户账号；可以按 IP 地址封禁。</Alert>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        {effectiveMode === "user" ? (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="搜索用户"
                  value={search}
                  maxLength={64}
                  placeholder="输入用户名或昵称"
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleSearch();
                  }}
                />
              </div>
              <Button variant="secondary" size="md" icon={<Search className="h-4 w-4" />} loading={searching} onClick={() => void handleSearch()}>
                搜索
              </Button>
            </div>
            {selected && (
              <div className="flex items-center gap-2 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2">
                <Avatar name={selected.displayName} color={selected.avatarColor} emoji={selected.avatarEmoji} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{selected.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{selected.username}</p>
                </div>
                <RoleBadge role={selected.role} />
                <button type="button" onClick={() => setSelected(null)} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                  取消选择
                </button>
              </div>
            )}
            {results.length > 0 && !selected && (
              <div className="max-h-56 space-y-1 overflow-y-auto app-scroll rounded-xl border border-border bg-card p-1.5">
                {results.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelected(row)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <Avatar name={row.displayName} color={row.avatarColor} emoji={row.avatarEmoji} size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{row.displayName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        @{row.username}
                        {row.online ? " · 在线" : ""}
                        {row.isBanned ? " · 已封禁" : ""}
                      </span>
                    </span>
                    <RoleBadge role={row.role} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Input label="IP 地址" value={ip} maxLength={64} placeholder="例如：203.0.113.24" hint="输入要封禁的 IP 地址，支持 IPv4 / IPv6" onChange={(event) => setIp(event.target.value)} />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="封禁时长" options={BAN_DURATIONS} value={duration} onChange={(event) => setDuration(event.target.value)} />
          <div />
        </div>
        <Textarea label="封禁原因" required rows={2} maxLength={200} value={reason} placeholder="请填写封禁原因，将记录到审计日志" onChange={(event) => setReason(event.target.value)} />
      </div>
    </Modal>
  );
}

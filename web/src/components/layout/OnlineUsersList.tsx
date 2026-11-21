import { useMemo, useRef, useState } from "react";
import { ChevronRight, HeadphoneOff, MicOff, Search, Users } from "lucide-react";
import { ROLE_LABELS, type OnlineUser } from "@airmic/shared";
import { Avatar, Button, Input, Modal } from "@/components/ui";
import { cn } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";

const PREVIEW_COUNT = 3;
const PAGE_SIZE = 20;

export default function OnlineUsersList() {
  const users = useAppStore((state) => state.onlineUsers);
  const selfId = useAuthStore((state) => state.user?.id ?? null);
  const [open, setOpen] = useState(false);
  const preview = users.slice(0, PREVIEW_COUNT + 1).filter((user) => user.userId !== selfId).slice(0, PREVIEW_COUNT);

  return (
    <div className="shrink-0 border-t border-sidebar-border">
      <button type="button" aria-haspopup="dialog" aria-label={`在线用户 ${users.length} 人`} onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>在线用户</span>
        <span className="mr-auto rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[11px] tabular-nums">{users.length}</span>
        <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
          {preview.map((user) => <Avatar key={user.userId} name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="xs" className="ring-2 ring-sidebar" />)}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && <OnlineUsersDialog users={users} selfId={selfId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function OnlineUsersDialog({ users, selfId, onClose }: { users: OnlineUser[]; selfId: number | null; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const searchBox = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    const results = keyword ? users.filter((user) => [user.displayName, user.username, user.roomName ?? "大厅"]
      .some((value) => value.toLocaleLowerCase().includes(keyword))) : [...users];
    return results.sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN") || a.userId - b.userId);
  }, [query, users]);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const changePage = (page: number) => {
    setPage(page);
    searchBox.current?.closest("[data-dialog-body]")?.scrollTo({ top: 0 });
  };

  return (
    <Modal open title="在线用户" subtitle={`${users.length} 人在线`} onClose={onClose} footer={pages > 1 ? <>
      <span className="mr-auto text-xs text-muted-foreground tabular-nums">{currentPage} / {pages} 页</span>
      <Button size="sm" variant="outline" onClick={() => changePage(currentPage - 1)} disabled={currentPage === 1}>上一页</Button>
      <Button size="sm" variant="outline" onClick={() => changePage(currentPage + 1)} disabled={currentPage === pages}>下一页</Button>
    </> : undefined}>
      <div ref={searchBox} className="sticky top-0 z-10 bg-popover pb-2">
        <Input aria-label="搜索在线用户" placeholder="搜索昵称、用户名或房间" value={query} maxLength={64}
          leftIcon={<Search className="h-4 w-4" />} onChange={(event) => { setQuery(event.target.value); changePage(1); }} />
      </div>
      {matches.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">{query.trim() ? "没有匹配的用户" : "暂无在线用户"}</p> : (
        <ul aria-label="在线用户名单" className="mt-3 divide-y divide-border">
          {matches.slice(start, start + PAGE_SIZE).map((user) => (
            <li key={user.userId} className="flex items-center gap-2.5 py-2">
              <Avatar name={user.displayName} color={user.avatarColor} emoji={user.avatarEmoji} size="sm" speaking={user.speaking} muted={user.muted} deafened={user.deafened} />
              <div className="min-w-0 flex-1">
                <p className={cn("flex items-center gap-1 text-sm", user.speaking && "font-medium text-success")}>
                  <span className="truncate" title={user.username}>{user.displayName}</span>
                  {user.userId === selfId && <span className="shrink-0 text-xs text-muted-foreground">（你）</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{user.roomName ?? "大厅"} · {ROLE_LABELS[user.role]}</p>
              </div>
              {user.deafened ? <HeadphoneOff aria-label="已关闭收听" className="h-4 w-4 shrink-0 text-muted-foreground" /> : user.muted ? (
                <MicOff aria-label="已静音" className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

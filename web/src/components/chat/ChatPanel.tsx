import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, MessageSquare, Send, X } from "lucide-react";
import type { ChatMessage, PeerInfo } from "@airmic/shared";
import { Avatar, Badge, IconButton } from "@/components/ui";
import { cn, formatClock } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useRoomStore } from "@/stores/room";
import { useUiStore } from "@/stores/ui";
import { colorForName, ROLE_LABEL, ROLE_TONE, showRoleBadge } from "@/components/room/roleMeta";

export interface ChatPanelProps {
  className?: string;
  open: boolean;
  /** 关闭/收起聊天面板（桌面折叠、移动端关闭抽屉） */
  onClose?: () => void;
}

type TimelineItem =
  | { key: string; createdAt: string; kind: "message"; message: ChatMessage }
  | { key: string; createdAt: string; kind: "notice"; text: string; level: "info" | "warn" | "error" };

/** 房间聊天面板：消息 + 系统提示，支持自动滚动、角色徽章与输入限制 */
export default function ChatPanel({ className, open, onClose }: ChatPanelProps) {
  const messages = useRoomStore((state) => state.messages);
  const room = useRoomStore((state) => state.snapshot?.room);
  const notices = useRoomStore((state) => state.notices);
  const sendChat = useRoomStore((state) => state.sendChat);
  const peers = useRoomStore((state) => state.peers);
  const me = useAuthStore((state) => state.user);
  const server = useAppStore((state) => state.server);

  const [draft, setDraft] = useState("");
  const [hasNew, setHasNew] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  const maxLength = server?.maxChatLength ?? 500;
  const chatDisabled = room?.textChatEnabled === false || server?.allowTextChat === false || (me?.isGuest && server?.allowGuestChat === false);
  const historyDays = room?.chatHistoryDays ?? 30;

  const peerMap = useMemo(() => {
    const map = new Map<number, PeerInfo>();
    for (const peer of peers) map.set(peer.userId, peer);
    return map;
  }, [peers]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const cutoff = new Date(Date.now() - historyDays * 86_400_000).toISOString();
    const items: TimelineItem[] = messages.filter((message) => message.createdAt > cutoff).map((message) => ({
      key: "m" + message.id,
      createdAt: message.createdAt,
      kind: "message",
      message,
    }));
    for (const notice of notices) {
      items.push({ key: "n" + notice.id, createdAt: notice.createdAt, kind: "notice", text: notice.text, level: notice.level });
    }
    items.sort((left, right) => {
      if (left.createdAt === right.createdAt) return 0;
      return left.createdAt < right.createdAt ? -1 : 1;
    });
    return items;
  }, [historyDays, messages, notices]);

  useEffect(() => {
    const element = listRef.current;
    if (!element || !open) return;
    if (stickRef.current) {
      element.scrollTop = element.scrollHeight;
      setHasNew(false);
    } else if (timeline.length > 0) {
      setHasNew(true);
    }
  }, [open, timeline.length]);

  const scrollToBottom = () => {
    const element = listRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    stickRef.current = true;
    setHasNew(false);
  };

  const submit = () => {
    const content = draft.trim();
    if (!content || chatDisabled) return;
    if (content.length > maxLength) {
      useUiStore.getState().toast("消息太长，最多 " + maxLength + " 个字符", "warning");
      return;
    }
    const sent = sendChat(content);
    if (!sent) {
      useUiStore.getState().toast("连接断开，消息未发送", "error");
      return;
    }
    setDraft("");
    stickRef.current = true;
    window.requestAnimationFrame(() => scrollToBottom());
  };

  return (
    <section className={cn("flex h-full min-h-0 flex-col bg-card", className)}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">房间聊天</h2>
        </div>
        {onClose && (
          <IconButton label="收起聊天" onClick={onClose} className="-mr-1 h-10 w-10">
            <X className="h-4 w-4" />
          </IconButton>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            if (stickRef.current) setHasNew(false);
          }}
          className="app-scroll absolute inset-0 space-y-3 overflow-y-auto overscroll-y-contain px-3 py-3"
        >
          {timeline.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <MessageSquare className="h-5 w-5" />
              </span>
              <p className="text-sm text-muted-foreground">暂无消息</p>
            </div>
          )}
          {timeline.map((item) =>
            item.kind === "notice" ? (
              <NoticeRow key={item.key} text={item.text} level={item.level} />
            ) : (
              <MessageRow
                key={item.key}
                message={item.message}
                isOwn={item.message.userId !== null && item.message.userId === me?.id}
                peer={item.message.userId === null ? undefined : peerMap.get(item.message.userId)}
              />
            ),
          )}
        </div>
        {hasNew && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground shadow-card transition-colors hover:bg-primary/90"
          >
            <ArrowDown className="h-3 w-3" /> 新消息
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-2.5">
        {chatDisabled ? (
          <p className="rounded-field bg-muted px-3 py-2.5 text-center text-[11px] text-muted-foreground">
            文字聊天已关闭
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              maxLength={maxLength}
              rows={1}
              aria-label="消息内容"
              enterKeyHint="send"
              placeholder="输入消息…"
              className="min-h-11 min-w-0 flex-1 resize-none rounded-field border border-input bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
            />
            <IconButton label="发送消息" onClick={submit} disabled={!draft.trim()} className="h-11 w-11 bg-primary text-primary-foreground hover:bg-primary/85 hover:text-primary-foreground">
              <Send className="h-4 w-4" />
            </IconButton>
          </div>
        )}
      </div>
    </section>
  );
}

function MessageRow({ message, isOwn, peer }: { message: ChatMessage; isOwn: boolean; peer?: PeerInfo }) {
  const color = isOwn ? undefined : peer?.avatarColor ?? colorForName(message.senderName);
  const emoji = peer?.avatarEmoji ?? null;
  const role = message.senderRole === "system" ? null : message.senderRole;
  return (
    <div className={cn("flex gap-2", isOwn && "flex-row-reverse")}>
      <div className="pt-0.5">
        <Avatar name={message.senderName} color={color} emoji={isOwn ? undefined : emoji} size="sm" />
      </div>
      <div className={cn("flex min-w-0 max-w-[82%] flex-col gap-1", isOwn && "items-end")}>
        <div className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground", isOwn && "flex-row-reverse")}>
          <span className="truncate font-medium text-foreground/80">{message.senderName}</span>
          {role && showRoleBadge(role) && <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>}
          <span className="tabular shrink-0 font-mono text-[10px]">{formatClock(message.createdAt)}</span>
        </div>
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl bg-muted px-3 py-2 text-sm leading-relaxed text-foreground",
            isOwn ? "rounded-tr-sm" : "rounded-tl-sm",
          )}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}

function NoticeRow({ text, level }: { text: string; level: "info" | "warn" | "error" }) {
  return (
    <div className="flex justify-center">
      <span
        className={cn(
          "max-w-full rounded-full px-2.5 py-1 text-center text-[11px]",
          level === "error" ? "bg-destructive/10 text-destructive" : level === "warn" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
        )}
      >
        {text}
      </span>
    </div>
  );
}

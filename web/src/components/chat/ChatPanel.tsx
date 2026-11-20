import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, MessageSquare, Send, X } from "lucide-react";
import type { ChatMessage, PeerInfo } from "@airmic/shared";
import { Avatar, Badge, Button, IconButton } from "@/components/ui";
import { cn, formatClock } from "@/lib/format";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useRoomStore } from "@/stores/room";
import { useUiStore } from "@/stores/ui";
import { colorForName, ROLE_LABEL, ROLE_TONE, showRoleBadge } from "@/components/room/roleMeta";

export interface ChatPanelProps {
  className?: string;
  /** 关闭/收起聊天面板（桌面折叠、移动端关闭抽屉） */
  onClose?: () => void;
}

type TimelineItem =
  | { key: string; createdAt: string; kind: "message"; message: ChatMessage }
  | { key: string; createdAt: string; kind: "notice"; text: string; level: "info" | "warn" | "error" };

/** 房间聊天面板：消息 + 系统提示，支持自动滚动、角色徽章与输入限制 */
export default function ChatPanel({ className, onClose }: ChatPanelProps) {
  const messages = useRoomStore((state) => state.messages);
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
  const chatDisabled = server !== null && !server.allowTextChat;

  const peerMap = useMemo(() => {
    const map = new Map<number, PeerInfo>();
    for (const peer of peers) map.set(peer.userId, peer);
    return map;
  }, [peers]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = messages.map((message) => ({
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
  }, [messages, notices]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    if (stickRef.current) {
      element.scrollTop = element.scrollHeight;
      setHasNew(false);
    } else if (timeline.length > 0) {
      setHasNew(true);
    }
  }, [timeline.length]);

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
      useUiStore.getState().toast("消息发送失败，实时连接未建立", "error");
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
          <span className="tabular rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {messages.length > 99 ? "99+" : messages.length}
          </span>
        </div>
        {onClose && (
          <IconButton label="收起聊天" size="sm" onClick={onClose} className="-mr-1">
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
          className="absolute inset-0 space-y-3 overflow-y-auto px-3 py-3 app-scroll"
        >
          {timeline.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <MessageSquare className="h-5 w-5" />
              </span>
              <p className="text-xs text-muted-foreground">还没有消息，和队友打个招呼吧</p>
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
            {server && !server.allowTextChat ? "服务器已关闭文字聊天" : "当前无法发送消息"}
          </p>
        ) : (
          <div className="rounded-field border border-input bg-card transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
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
              placeholder="发送消息…（Enter 发送，Shift+Enter 换行）"
              className="max-h-32 min-h-[2.5rem] w-full resize-none bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-1.5">
              <span className={cn("tabular text-[10px]", draft.length > maxLength * 0.9 ? "text-warning" : "text-muted-foreground")}>
                {draft.length > 0 ? draft.length + "/" + maxLength : ""}
              </span>
              <Button
                size="sm"
                onClick={submit}
                disabled={!draft.trim()}
                aria-label="发送消息"
                icon={<Send className="h-3.5 w-3.5" />}
              >
                发送
              </Button>
            </div>
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

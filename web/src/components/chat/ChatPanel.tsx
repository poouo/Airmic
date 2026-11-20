import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, MessageSquare, Send, X } from "lucide-react";
import type { ChatMessage, PeerInfo } from "@airmic/shared";
import { Avatar, Badge } from "@/components/ui";
import { cn, colorWithAlpha, formatClock, initials } from "@/lib/format";
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
    <section className={cn("flex h-full min-h-0 flex-col bg-ink-900/80", className)}>
      <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-mist-400" />
          <h2 className="text-sm font-medium text-mist-100">房间聊天</h2>
          <span className="text-[11px] text-mist-500">{messages.length > 99 ? "99+" : messages.length}</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="收起聊天"
            className="rounded-lg p-1 text-mist-500 transition-colors hover:bg-white/5 hover:text-mist-200"
          >
            <X className="h-4 w-4" />
          </button>
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
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <MessageSquare className="h-6 w-6 text-mist-600" />
              <p className="text-xs text-mist-500">还没有消息，和队友打个招呼吧</p>
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
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-brand-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg shadow-black/40"
          >
            <ArrowDown className="h-3 w-3" /> 新消息
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-white/5 p-2.5">
        {chatDisabled ? (
          <p className="rounded-xl bg-white/5 px-3 py-2.5 text-center text-[11px] text-mist-500">
            {server && !server.allowTextChat ? "服务器已关闭文字聊天" : "当前无法发送消息"}
          </p>
        ) : (
          <div className="rounded-xl border border-white/10 bg-ink-900/80 focus-within:border-brand-500/50 focus-within:ring-2 focus-within:ring-brand-500/15">
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
              className="max-h-32 min-h-[2.5rem] w-full resize-none bg-transparent px-3 py-2 text-sm text-mist-100 outline-none placeholder:text-mist-500"
            />
            <div className="flex items-center justify-between px-2 pb-1.5">
              <span className={cn("text-[10px]", draft.length > maxLength * 0.9 ? "text-warn-400" : "text-mist-600")}>
                {draft.length > 0 ? draft.length + "/" + maxLength : ""}
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim()}
                aria-label="发送消息"
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-brand-600 px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-3 w-3" /> 发送
              </button>
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
        {isOwn ? (
          <Avatar name={message.senderName} color={color} size="sm" />
        ) : (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-xs font-semibold text-white"
            style={{
              background: "linear-gradient(145deg, " + colorWithAlpha(color ?? "#6366f1", 0.95) + ", " + colorWithAlpha(color ?? "#6366f1", 0.55) + ")",
            }}
          >
            {emoji ? <span>{emoji}</span> : <span>{initials(message.senderName)}</span>}
          </div>
        )}
      </div>
      <div className={cn("flex min-w-0 max-w-[82%] flex-col gap-1", isOwn && "items-end")}>
        <div className={cn("flex items-center gap-1.5 text-[11px] text-mist-500", isOwn && "flex-row-reverse")}>
          <span className="truncate font-medium text-mist-300">{message.senderName}</span>
          {role && showRoleBadge(role) && <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>}
          <span className="font-mono text-[10px]">{formatClock(message.createdAt)}</span>
        </div>
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed",
            isOwn ? "rounded-tr-sm bg-brand-500/25 text-mist-100" : "rounded-tl-sm bg-ink-800/90 text-mist-200 ring-1 ring-white/5",
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
          level === "error" ? "bg-bad-500/10 text-bad-400" : level === "warn" ? "bg-warn-500/10 text-warn-400" : "bg-white/5 text-mist-400",
        )}
      >
        {text}
      </span>
    </div>
  );
}

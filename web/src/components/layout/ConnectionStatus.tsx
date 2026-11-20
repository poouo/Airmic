import type { SocketStatus } from "@/lib/ws";
import { cn } from "@/lib/format";

const STATUS_MAP: Record<SocketStatus, { label: string; dot: string; text: string; pulse: boolean }> = {
  idle: { label: "未连接", dot: "bg-mist-500", text: "text-mist-500", pulse: false },
  connecting: { label: "连接中", dot: "bg-warn-400", text: "text-warn-400", pulse: true },
  online: { label: "已连接", dot: "bg-good-400", text: "text-good-400", pulse: false },
  reconnecting: { label: "重连中", dot: "bg-warn-400", text: "text-warn-400", pulse: true },
  offline: { label: "已断开", dot: "bg-bad-500", text: "text-bad-400", pulse: false },
};

export default function ConnectionStatus({ status, compact = false }: { status: SocketStatus; compact?: boolean }) {
  const info = STATUS_MAP[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-1 text-[11px] ring-1 ring-white/5",
        info.text,
        compact && "px-1.5",
      )}
      title={"实时连接：" + info.label}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", info.dot, info.pulse && "animate-pulse")} />
      {!compact && info.label}
    </span>
  );
}

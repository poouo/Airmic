import type { SocketStatus } from "@/lib/ws";
import { cn } from "@/lib/format";

const STATUS_MAP: Record<SocketStatus, { label: string; dot: string; wrapper: string; pulse: boolean }> = {
  idle: { label: "未连接", dot: "bg-muted-foreground", wrapper: "bg-muted text-muted-foreground", pulse: false },
  connecting: { label: "连接中", dot: "bg-warning", wrapper: "bg-warning/10 text-warning", pulse: true },
  online: { label: "已连接", dot: "bg-success", wrapper: "bg-success/10 text-success", pulse: false },
  reconnecting: { label: "重连中", dot: "bg-warning", wrapper: "bg-warning/10 text-warning", pulse: true },
  offline: { label: "已断开", dot: "bg-destructive", wrapper: "bg-destructive/10 text-destructive", pulse: false },
};

export default function ConnectionStatus({ status, compact = false }: { status: SocketStatus; compact?: boolean }) {
  const info = STATUS_MAP[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
        info.wrapper,
        compact && "px-1.5",
      )}
      title={"实时连接：" + info.label}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", info.dot, info.pulse && "animate-pulse")} />
      {!compact && info.label}
    </span>
  );
}

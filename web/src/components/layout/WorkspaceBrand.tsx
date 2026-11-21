import { Link } from "react-router-dom";
import AirMicMark from "@/components/brand/AirMicMark";
import { cn } from "@/lib/format";
import { useAppStore } from "@/stores/app";

export default function WorkspaceBrand({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const serverName = useAppStore((state) => state.server?.name);
  return (
    <Link
      to="/"
      aria-label="AirMic 大厅"
      onClick={onNavigate}
      className={cn("flex min-w-0 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <AirMicMark size={34} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight tracking-tight">AirMic</span>
        {serverName && <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground" title={serverName}>{serverName}</span>}
      </span>
    </Link>
  );
}

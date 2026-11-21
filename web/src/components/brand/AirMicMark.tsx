import { cn } from "@/lib/format";

/** Decorative brand mark; the surrounding heading or link names AirMic. */
export default function AirMicMark({ size = 32, className }: { size?: number; className?: string }) {
  return <img src="/airmic-logo.svg" alt="" width={size} height={size} className={cn("shrink-0", className)} />;
}

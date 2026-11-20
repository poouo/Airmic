import { cn } from "@/lib/format";

export interface LevelMeterProps {
  level: number;
  active?: boolean;
  barCount?: number;
  className?: string;
}

/** 麦克风电平条：从左到右点亮，颜色随音量从绿到黄再到红 */
export function LevelMeter({ level, active = true, barCount = 14, className }: LevelMeterProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
  const lit = active ? Math.round(clamped * barCount) : 0;
  return (
    <div className={cn("flex h-2 w-full items-end gap-[2px]", className)} aria-hidden="true">
      {Array.from({ length: barCount }, (_, index) => {
        const ratio = barCount <= 1 ? 0 : index / (barCount - 1);
        const on = index < lit;
        const color = ratio > 0.82 ? "bg-destructive" : ratio > 0.62 ? "bg-warning" : "bg-success";
        return (
          <span
            key={index}
            className={cn("h-full flex-1 rounded-full transition-colors duration-75", on ? color : "bg-foreground/10")}
          />
        );
      })}
    </div>
  );
}

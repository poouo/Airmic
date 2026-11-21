import { Check } from "lucide-react";
import { cn } from "@/lib/format";
import { SETUP_STEPS } from "./types";

export interface SetupStepperProps {
  current: number;
  onSelect: (index: number) => void;
}

export default function SetupStepper({ current, onSelect }: SetupStepperProps) {
  return (
    <ol className="grid grid-cols-4 gap-1 rounded-xl bg-background p-1" aria-label="初始化步骤">
      {SETUP_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.id} className="min-w-0">
            <button
              type="button"
              onClick={() => {
                if (index < current) onSelect(index);
              }}
              disabled={index >= current}
              aria-current={active ? "step" : undefined}
              aria-label={step.title}
              className={cn(
                "flex min-h-11 w-full min-w-0 items-center justify-center gap-1 rounded-lg px-0.5 py-1 outline-none transition-colors sm:gap-2",
                "focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-card shadow-card" : done ? "cursor-pointer hover:bg-accent" : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors sm:h-7 sm:w-7",
                  done && "bg-primary text-primary-foreground",
                  active && "bg-accent text-brand",
                  !done && !active && "border border-border bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("hidden truncate text-xs font-medium sm:block", active ? "text-foreground" : done ? "text-foreground/80" : "text-muted-foreground")}>
                  {step.title}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

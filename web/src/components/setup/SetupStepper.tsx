import { Check } from "lucide-react";
import { cn } from "@/lib/format";
import { SETUP_STEPS } from "./types";

export interface SetupStepperProps {
  current: number;
  onSelect: (index: number) => void;
}

export default function SetupStepper({ current, onSelect }: SetupStepperProps) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto app-scroll pb-1 sm:gap-2.5" aria-label="初始化步骤">
      {SETUP_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2.5">
            <button
              type="button"
              onClick={() => {
                if (index < current) onSelect(index);
              }}
              disabled={index >= current}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring",
                done ? "cursor-pointer hover:bg-accent" : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                  done && "bg-primary text-primary-foreground",
                  active && "border border-foreground/40 bg-card text-foreground shadow-card",
                  !done && !active && "border border-border bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate text-xs font-medium", active ? "text-foreground" : done ? "text-foreground/80" : "text-muted-foreground")}>
                  {step.title}
                </span>
                <span className="hidden truncate text-[10px] text-muted-foreground sm:block">{step.description}</span>
              </span>
            </button>
            {index < SETUP_STEPS.length - 1 && <span className={cn("h-px min-w-3 flex-1", done ? "bg-foreground/25" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}

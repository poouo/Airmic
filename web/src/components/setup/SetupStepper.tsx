import { Check } from "lucide-react";
import { cn } from "@/lib/format";
import { SETUP_STEPS } from "./types";

export interface SetupStepperProps {
  current: number;
  onSelect: (index: number) => void;
}

export default function SetupStepper({ current, onSelect }: SetupStepperProps) {
  return (
    <ol className="flex items-center gap-1.5 overflow-x-auto app-scroll pb-1 sm:gap-3" aria-label="初始化步骤">
      {SETUP_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                if (index < current) onSelect(index);
              }}
              disabled={index >= current}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-xl px-1 py-1 text-left outline-none transition-colors",
                index < current ? "cursor-pointer hover:bg-white/5" : "cursor-default",
                "focus-visible:ring-2 focus-visible:ring-brand-400",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 transition-colors",
                  done && "bg-good-500/15 text-good-400 ring-good-500/30",
                  active && "bg-brand-500 text-white ring-brand-400/60",
                  !done && !active && "bg-ink-800 text-mist-500 ring-white/10",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate text-xs font-medium", active ? "text-mist-100" : done ? "text-mist-300" : "text-mist-500")}>
                  {step.title}
                </span>
                <span className="hidden truncate text-[10px] text-mist-500 sm:block">{step.description}</span>
              </span>
            </button>
            {index < SETUP_STEPS.length - 1 && <span className={cn("h-px min-w-3 flex-1", index < current ? "bg-good-500/40" : "bg-white/10")} />}
          </li>
        );
      })}
    </ol>
  );
}

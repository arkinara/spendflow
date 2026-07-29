import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  label: string;
  description?: string;
}

export interface StepperProps {
  steps: Step[];
  current: number; // 0-based index of the active step
  className?: string;
}

export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn("flex w-full items-center", className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const last = i === steps.length - 1;
        return (
          <li
            key={step.label}
            className={cn("flex items-center", !last && "flex-1")}
          >
            <div className="flex flex-col items-center gap-1.5 text-center">
              <span
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-200",
                  done && "bg-primary text-primary-foreground",
                  active && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  !done && !active && "bg-surface-container-high text-on-surface-variant"
                )}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="h-5 w-5" strokeWidth={2} aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden text-xs font-medium sm:block",
                  active || done ? "text-on-surface" : "text-on-surface-variant"
                )}
              >
                {step.label}
              </span>
            </div>
            {!last && (
              <span
                className={cn(
                  "mx-2 h-0.5 flex-1 rounded-full transition-colors duration-200 sm:mx-3",
                  i < current ? "bg-primary" : "bg-outline-variant"
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

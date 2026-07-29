import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  delta?: { value: string; direction: "up" | "down"; positive?: boolean };
  hint?: string;
  className?: string;
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  delta,
  hint,
  className,
}: MetricCardProps) {
  const deltaPositive = delta?.positive ?? delta?.direction === "up";
  return (
    <div
      className={cn(
        "rounded-2xl border border-outline-variant bg-surface-container-low p-5 shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-on-surface-variant">{label}</span>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-on-surface">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium",
              deltaPositive ? "text-success" : "text-error"
            )}
          >
            {delta.direction === "up" ? (
              <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            )}
            {delta.value}
          </span>
        )}
        {hint && <span className="text-xs text-on-surface-variant">{hint}</span>}
      </div>
    </div>
  );
}

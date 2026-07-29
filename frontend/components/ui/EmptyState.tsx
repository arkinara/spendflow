import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
  variant?: "default" | "compact";
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
  variant = "default",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "default" ? "px-6 py-16" : "px-4 py-10",
        className
      )}
    >
      <span className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
        <Icon className="h-7 w-7" strokeWidth={1.75} aria-hidden />
      </span>
      <h3 className="text-lg font-semibold text-on-surface">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-on-surface-variant">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

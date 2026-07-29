import { cn } from "@/lib/utils";

function Base({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-surface-container-high",
        className
      )}
      aria-hidden
    />
  );
}

export interface SkeletonProps {
  variant?: "line" | "block" | "list" | "card";
  lines?: number;
  className?: string;
}

export function Skeleton({ variant = "line", lines = 3, className }: SkeletonProps) {
  if (variant === "line") {
    return <Base className={cn("h-4 w-full", className)} />;
  }

  if (variant === "block") {
    return <Base className={cn("h-32 w-full rounded-2xl", className)} />;
  }

  if (variant === "card") {
    return (
      <div
        className={cn(
          "space-y-3 rounded-2xl border border-outline-variant bg-surface-container-low p-5",
          className
        )}
      >
        <div className="flex items-center justify-between">
          <Base className="h-4 w-24" />
          <Base className="h-9 w-9 rounded-full" />
        </div>
        <Base className="h-8 w-32" />
        <Base className="h-3 w-20" />
      </div>
    );
  }

  // list
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-2xl border border-outline-variant bg-surface-container-low p-4">
          <Base className="h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Base className="h-4 w-3/4" />
            <Base className="h-3 w-1/2" />
          </div>
          <Base className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

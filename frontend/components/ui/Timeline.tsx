import * as React from "react";
import { cn } from "@/lib/utils";

export interface TimelineEntry {
  id: string;
  title: React.ReactNode;
  actor?: string;
  timestamp?: string;
  body?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "error" | "info";
}

export interface TimelineProps {
  entries: TimelineEntry[];
  className?: string;
}

const DOT_TONE = {
  default: "bg-primary text-primary-foreground",
  success: "bg-success text-success-container",
  warning: "bg-warning text-warning-container",
  error: "bg-error text-error-container",
  info: "bg-info text-info-container",
} as const;

export function Timeline({ entries, className }: TimelineProps) {
  return (
    <ol className={cn("relative space-y-6", className)}>
      {entries.map((entry, i) => {
        const last = i === entries.length - 1;
        return (
          <li key={entry.id} className="relative flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-xs",
                  DOT_TONE[entry.tone ?? "default"]
                )}
              >
                {entry.icon ?? <span className="h-2 w-2 rounded-full bg-current" />}
              </span>
              {!last && (
                <span className="mt-1 w-0.5 flex-1 rounded-full bg-outline-variant" aria-hidden />
              )}
            </div>
            <div className={cn("min-w-0 flex-1", !last && "pb-2")}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-on-surface">{entry.title}</p>
                {entry.timestamp && (
                  <time className="text-xs text-on-surface-variant">{entry.timestamp}</time>
                )}
              </div>
              {entry.actor && (
                <p className="text-xs text-on-surface-variant">{entry.actor}</p>
              )}
              {entry.body && (
                <div className="mt-2 rounded-xl bg-surface-container px-3 py-2 text-sm text-on-surface">
                  {entry.body}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

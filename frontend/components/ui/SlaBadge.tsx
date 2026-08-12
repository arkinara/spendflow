import {
  AlertOctagon,
  AlertTriangle,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import type { SlaLevel, SlaSummary } from "@/lib/types";

/**
 * #74: renders the BE-stamped `sla` summary as a small tonal chip. M3 tonal
 * palettes (no box-shadow) — neutral surface for healthy buckets, tertiary
 * (warning) for aging/stale, error for breached. Wrapped in a Tooltip that
 * surfaces the status-keyed SLA threshold in days.
 */
const LEVEL_ICON: Record<SlaLevel, LucideIcon> = {
  fresh: Clock,
  on_track: Clock,
  aging: AlertTriangle,
  stale: AlertTriangle,
  breached: AlertOctagon,
};

const LEVEL_TONE: Record<SlaLevel, string> = {
  fresh: "bg-surface-container-high text-on-surface-variant",
  on_track: "bg-surface-container-high text-on-surface-variant",
  aging: "bg-tertiary-container text-tertiary-container-foreground",
  stale: "bg-tertiary-container text-tertiary-container-foreground",
  breached: "bg-error text-error-container",
};

function levelLabel({ level, ageDays }: SlaSummary): string {
  switch (level) {
    case "fresh":
      return "Just submitted";
    case "on_track":
      return `${ageDays}d open`;
    case "aging":
      return `Aging: ${ageDays}d`;
    case "stale":
      return `Stale: ${ageDays}d`;
    case "breached":
      return `Overdue: ${ageDays}d`;
  }
}

export function SlaBadge({ sla }: { sla: SlaSummary }) {
  const Icon = LEVEL_ICON[sla.level];
  return (
    <Tooltip content={`Threshold is ${sla.thresholdDays}d`}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
          LEVEL_TONE[sla.level]
        )}
      >
        <Icon className="h-3 w-3" strokeWidth={1.75} aria-hidden />
        {levelLabel(sla)}
      </span>
    </Tooltip>
  );
}

import {
  CheckCircle2,
  Hourglass,
  XCircle,
  AlertTriangle,
  CircleDashed,
  Wallet,
  Loader,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaimStatus, PaymentStatus } from "@/lib/types";

type Tone = "success" | "warning" | "error" | "info" | "neutral";

interface ChipSpec {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

const CLAIM_SPECS: Record<ClaimStatus, ChipSpec> = {
  draft: { label: "Draft", tone: "neutral", icon: CircleDashed },
  pending: { label: "Pending Approval", tone: "warning", icon: Hourglass },
  action_required: { label: "Action Required", tone: "error", icon: AlertTriangle },
  approved: { label: "Approved", tone: "success", icon: CheckCircle2 },
  processing: { label: "Processing", tone: "info", icon: Loader },
  paid: { label: "Paid", tone: "success", icon: Wallet },
  rejected: { label: "Rejected", tone: "neutral", icon: XCircle },
};

const PAYMENT_SPECS: Record<PaymentStatus, ChipSpec> = {
  queued: { label: "Queued", tone: "neutral", icon: CircleDashed },
  scheduled: { label: "Scheduled", tone: "info", icon: Hourglass },
  processing: { label: "Processing", tone: "warning", icon: Loader },
  paid: { label: "Paid", tone: "success", icon: CheckCircle2 },
  failed: { label: "Failed", tone: "error", icon: XCircle },
};

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success-container text-success-container-foreground",
  warning: "bg-warning-container text-warning-container-foreground",
  error: "bg-error-container text-error-container-foreground",
  info: "bg-info-container text-info-container-foreground",
  neutral: "bg-surface-container-high text-on-surface-variant",
};

const SIZE_CLASSES = {
  sm: "px-2 py-0.5 text-[11px] gap-1",
  md: "px-3 py-1 text-xs gap-1.5",
} as const;

export interface StatusChipProps {
  status?: ClaimStatus;
  paymentStatus?: PaymentStatus;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

export function StatusChip({
  status,
  paymentStatus,
  size = "md",
  className,
}: StatusChipProps) {
  const spec: ChipSpec = paymentStatus
    ? PAYMENT_SPECS[paymentStatus]
    : status
    ? CLAIM_SPECS[status]
    : CLAIM_SPECS.draft;
  const Icon = spec.icon;
  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        TONE_CLASSES[spec.tone],
        SIZE_CLASSES[size],
        className
      )}
    >
      <Icon className={iconSize} strokeWidth={1.75} aria-hidden />
      {spec.label}
    </span>
  );
}

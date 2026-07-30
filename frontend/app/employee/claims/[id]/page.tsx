"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Paperclip,
  MessageSquare,
  History,
  Send,
  FileText,
  Image as ImageIcon,
  Download,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  RefreshCw,
  Ban,
  Plane,
  BedDouble,
  Utensils,
  Car,
  Route as RouteIcon,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { useSnackbar } from "@/components/ui/Snackbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusChip } from "@/components/ui/StatusChip";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useClaimDetail } from "@/lib/mock/useClaimDetail";
import { withdrawClaim, resubmitClaim } from "@/lib/mock/claimStore";
import { evaluateLinePolicy } from "@/lib/mock/policy";
import {
  getUserName,
  getCategory,
  computeClaimTotal,
  type Claim,
  type LineItem,
  type Attachment,
  type ApprovalAction,
  type ExpenseCategoryId,
} from "@/lib/mock/mock_data";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";

const CATEGORY_ICON: Record<ExpenseCategoryId, LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  meals: Utensils,
  taxi: Car,
  mileage: RouteIcon,
  other: Receipt,
};

const ACTION_TONE: Record<ApprovalAction["action"], TimelineEntry["tone"]> = {
  created: "default",
  submitted: "info",
  approved: "success",
  rejected: "error",
  returned: "warning",
  resubmitted: "info",
  processing: "info",
  paid: "success",
  commented: "default",
};

const ACTION_LABEL: Record<ApprovalAction["action"], string> = {
  created: "Claim created",
  submitted: "Submitted for approval",
  approved: "Approved",
  rejected: "Rejected",
  returned: "Returned for changes",
  resubmitted: "Resubmitted",
  processing: "Payment processing",
  paid: "Payment disbursed",
  commented: "Comment added",
};

/**
 * Build the chronological status timeline from the live claim: every approval
 * transition plus any policy exception flag, sorted strictly ascending by the
 * raw ISO timestamp so the oldest event renders first. (Sorting on the raw
 * timestamp — not the formatted display string — keeps order correct across
 * months and years.)
 */
function buildTimeline(claim: Claim): TimelineEntry[] {
  const stamped: { at: string; entry: TimelineEntry }[] = claim.approvals.map((a) => ({
    at: a.at,
    entry: {
      id: a.id,
      title: ACTION_LABEL[a.action],
      actor: getUserName(a.actorId),
      timestamp: formatDateTime(a.at),
      body: a.note,
      tone: ACTION_TONE[a.action],
    },
  }));

  if (claim.exception) {
    stamped.push({
      at: claim.exception.flaggedAt,
      entry: {
        id: claim.exception.id,
        title:
          claim.exception.status === "resolved"
            ? "Policy exception resolved"
            : "Policy exception flagged",
        timestamp: formatDateTime(claim.exception.flaggedAt),
        actor: "Policy engine",
        body: claim.exception.message,
        tone: claim.exception.status === "resolved" ? "success" : "error",
      },
    });
  }

  return stamped
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((s) => s.entry);
}

/**
 * Per-line policy flag. Only the receipt-required rule is surfaced here so the
 * badge stays consistent with the persisted claim-level exception (over-cap and
 * currency rules are enforced pre-submit in the wizard and do not retroactively
 * flag already-submitted fixture lines).
 */
function lineReceiptFlag(line: LineItem): string | null {
  const violations = evaluateLinePolicy(
    {
      id: line.id,
      categoryId: line.categoryId,
      amount: line.amount,
      currency: line.currency,
      hasAttachment: line.hasReceipt,
    },
    line.currency
  );
  const missing = violations.find((v) => v.type === "missing_receipt");
  return missing ? "Receipt required" : null;
}

/** Extract a merchant name from a line note authored as "Merchant: …". */
function lineMerchant(line: LineItem): string | null {
  if (!line.note) return null;
  const m = line.note.match(/^Merchant:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

/** A downloadable mock placeholder so the demo "download" affordance works. */
function attachmentDataUrl(a: Attachment): string {
  const placeholder = [
    "SpendFlow mock receipt placeholder",
    `File: ${a.fileName}`,
    `Size: ${a.sizeKb} KB`,
    "",
    "Demo data — real receipts are delivered by the backend (BE-claims).",
  ].join("\n");
  return `data:text/plain;charset=utf-8,${encodeURIComponent(placeholder)}`;
}

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useSnackbar();
  const { user } = useRole();
  const { state, reload } = useClaimDetail(params.id, user.id);

  if (state.status === "loading") {
    return (
      <AppShell>
        <ClaimDetailSkeleton />
      </AppShell>
    );
  }

  if (state.status === "error") {
    return (
      <AppShell>
        <Card className="border-error/40" role="alert">
          <div className="flex flex-col items-center gap-4 px-4 py-10 text-center sm:flex-row sm:text-left">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
              <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-on-surface">
                Couldn&rsquo;t load this claim
              </h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                {state.message || "Something went wrong while loading this claim."} Try again.
              </p>
            </div>
            <Button variant="outlined" icon={RefreshCw} onClick={reload}>
              Retry
            </Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  if (state.status === "notfound") {
    return (
      <AppShell>
        <EmptyState
          icon={AlertTriangle}
          title="Claim not found"
          body="This claim may have been withdrawn or the link is incorrect."
          action={
            <Button href="/employee/claims" icon={ArrowLeft}>
              Back to my claims
            </Button>
          }
        />
      </AppShell>
    );
  }

  if (state.status === "denied") {
    return (
      <AppShell>
        <EmptyState
          icon={Ban}
          title="Access denied"
          body="This claim belongs to another employee. You can only view your own claims."
          action={
            <Button href="/employee/claims" icon={ArrowLeft}>
              Back to my claims
            </Button>
          }
        />
      </AppShell>
    );
  }

  const claim = state.claim!;
  const total = computeClaimTotal(claim);
  const timeline = buildTimeline(claim);

  return (
    <AppShell>
      <div className="mx-0 max-w-4xl space-y-6">
        <Button href="/employee/claims" variant="text" size="sm" icon={ArrowLeft}>
          Back to my claims
        </Button>

        <ClaimHeader claim={claim} total={total} />

        {claim.exception && claim.exception.status === "open" && (
          <Card className="border-error/40 bg-error-container/40">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-error" strokeWidth={1.75} aria-hidden />
              <div>
                <p className="text-sm font-semibold text-on-surface">Exception flagged</p>
                <p className="text-sm text-on-surface-variant">{claim.exception.message}</p>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="Expense lines" padded={false}>
              <ul className="divide-y divide-outline-variant px-2 py-1">
                {claim.lineItems.map((l) => {
                  const Icon = CATEGORY_ICON[l.categoryId];
                  const merchant = lineMerchant(l);
                  const flag = lineReceiptFlag(l);
                  return (
                    <li key={l.id} className="flex items-start gap-3 px-3 py-3">
                      <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-on-surface">{l.description}</p>
                        <p className="text-xs text-on-surface-variant">
                          {getCategory(l.categoryId)?.name} · {formatDate(l.date)}
                          {merchant ? ` · ${merchant}` : ""}
                          {l.quantity && l.unitLabel ? ` · ${l.quantity} ${l.unitLabel}` : ""}
                        </p>
                        {flag && (
                          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-error-container px-2 py-0.5 text-[11px] font-medium text-error-container-foreground">
                            <ShieldAlert className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                            {flag}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-on-surface">
                          {formatCurrency(l.amount, l.currency)}
                        </span>
                        {!l.hasReceipt && (
                          <span className="text-[11px] text-on-surface-variant">no receipt</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between border-t border-outline-variant px-5 py-4">
                <span className="text-sm font-medium text-on-surface-variant">Total claimed</span>
                <span className="text-lg font-bold text-on-surface">
                  {formatCurrency(total, claim.currency)}
                </span>
              </div>
            </Card>

            <Card title="Attachments" subtitle={`${claim.attachments.length} files`}>
              {claim.attachments.length === 0 ? (
                <p className="text-sm text-on-surface-variant">No receipts attached.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {claim.attachments.map((a) => {
                    const isImage = a.mimeType.startsWith("image/");
                    const Icon = isImage ? ImageIcon : FileText;
                    return (
                      <li
                        key={a.id}
                        className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5"
                      >
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant">
                          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-on-surface">{a.fileName}</p>
                          <p className="text-xs text-on-surface-variant">{a.sizeKb} KB</p>
                        </div>
                        <a
                          href={attachmentDataUrl(a)}
                          download={a.fileName}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={`Download ${a.fileName}`}
                        >
                          <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Status timeline" role="region" aria-label="Status timeline">
              <Timeline entries={timeline} />
            </Card>

            <Card padded={false}>
              <div className="p-2">
                <Button href={`/claims/${claim.id}/comments`} variant="text" icon={MessageSquare} fullWidth className="justify-start">
                  Comments
                </Button>
                <Button href={`/claims/${claim.id}/audit`} variant="text" icon={History} fullWidth className="justify-start">
                  Audit trail
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );

  function ClaimHeader({ claim, total }: { claim: Claim; total: number }) {
    const onWithdraw = () => {
      try {
        withdrawClaim(claim.id, user.id);
        show("Draft claim withdrawn.", { tone: "success" });
        router.push("/employee/claims");
      } catch (err) {
        show(err instanceof Error ? err.message : "Couldn't withdraw this claim.", {
          tone: "error",
        });
      }
    };

    const onResubmit = () => {
      try {
        resubmitClaim(claim.id, user.id);
        reload(); // re-read live store so the timeline re-renders immediately
        show("Claim resubmitted for approval.", { tone: "success" });
      } catch (err) {
        show(err instanceof Error ? err.message : "Couldn't resubmit this claim.", {
          tone: "error",
        });
      }
    };

    return (
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">{claim.title}</h1>
            <StatusChip status={claim.status} />
          </div>
          <p className="mt-1 text-sm text-on-surface-variant">
            {claim.reference} · {claim.destination} · {formatDate(claim.tripStart ?? claim.createdAt)}
            {claim.tripEnd ? ` → ${formatDate(claim.tripEnd)}` : ""} · {formatCurrency(total, claim.currency)}
          </p>
          <p className="mt-2 max-w-2xl text-sm text-on-surface">{claim.purpose}</p>
        </div>
        <div className="flex gap-2">
          {claim.status === "action_required" && (
            <Button icon={Send} onClick={onResubmit}>
              Resubmit
            </Button>
          )}
          {claim.status === "draft" && (
            <>
              <Button href="/employee/claims/new" variant="outlined" icon={Paperclip}>
                Edit
              </Button>
              <Button variant="danger" icon={Trash2} onClick={onWithdraw}>
                Withdraw
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }
}

function ClaimDetailSkeleton() {
  return (
    <div aria-busy="true" role="status" aria-label="Loading claim" className="space-y-6">
      <Skeleton className="h-4 w-32" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton variant="list" lines={4} />
        </div>
        <Skeleton variant="block" />
      </div>
    </div>
  );
}

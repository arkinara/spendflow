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
  AlertTriangle,
  Plane,
  BedDouble,
  Utensils,
  Car,
  Route as RouteIcon,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useSnackbar } from "@/components/ui/Snackbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusChip } from "@/components/ui/StatusChip";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getClaim,
  getUserName,
  getCategory,
  computeClaimTotal,
  type Claim,
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
  paid: "Payment disbursed",
  commented: "Comment added",
};

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useSnackbar();
  const claim = getClaim(params.id);

  if (!claim) {
    return (
      <AppShell>
        <EmptyState
          icon={AlertTriangle}
          title="Claim not found"
          body="This claim may have been removed or the link is incorrect."
          action={
            <Button href="/employee/claims" icon={ArrowLeft}>
              Back to my claims
            </Button>
          }
        />
      </AppShell>
    );
  }

  const total = computeClaimTotal(claim);
  const timeline: TimelineEntry[] = claim.approvals.map((a) => ({
    id: a.id,
    title: ACTION_LABEL[a.action],
    actor: getUserName(a.actorId),
    timestamp: formatDateTime(a.at),
    body: a.note,
    tone: ACTION_TONE[a.action],
  }));

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
                  return (
                    <li key={l.id} className="flex items-center gap-3 px-3 py-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-on-surface">{l.description}</p>
                        <p className="text-xs text-on-surface-variant">
                          {getCategory(l.categoryId)?.name} · {formatDate(l.date)}
                          {l.quantity && l.unitLabel ? ` · ${l.quantity} ${l.unitLabel}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-on-surface">
                          {formatCurrency(l.amount)}
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
                <span className="text-lg font-bold text-on-surface">{formatCurrency(total)}</span>
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
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant">
                          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-on-surface">{a.fileName}</p>
                          <p className="text-xs text-on-surface-variant">{a.sizeKb} KB</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Status timeline">
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
    return (
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">{claim.title}</h1>
            <StatusChip status={claim.status} />
          </div>
          <p className="mt-1 text-sm text-on-surface-variant">
            {claim.reference} · {claim.destination} · {formatDate(claim.tripStart ?? claim.createdAt)}
            {claim.tripEnd ? ` → ${formatDate(claim.tripEnd)}` : ""} · {formatCurrency(total)}
          </p>
          <p className="mt-2 max-w-2xl text-sm text-on-surface">{claim.purpose}</p>
        </div>
        <div className="flex gap-2">
          {claim.status === "action_required" && (
            <Button
              icon={Send}
              onClick={() => {
                show("Claim resubmitted for approval.", { tone: "success" });
                router.push("/employee/claims");
              }}
            >
              Resubmit
            </Button>
          )}
          {claim.status === "draft" && (
            <>
              <Button href="/employee/claims/new" variant="outlined" icon={Paperclip}>
                Continue editing
              </Button>
              <Button
                icon={Send}
                onClick={() => {
                  show("Draft submitted for approval.", { tone: "success" });
                  router.push("/employee/claims");
                }}
              >
                Submit
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }
}

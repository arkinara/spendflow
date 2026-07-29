"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  XCircle,
  AlertTriangle,
  MessageSquare,
  History,
  FileText,
  Image as ImageIcon,
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
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getClaim,
  getUser,
  getUserName,
  getCategory,
  computeClaimTotal,
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

type Decision = "approve" | "return" | "reject" | null;

const DECISION_META: Record<
  Exclude<Decision, null>,
  { title: string; verb: string; tone: "success" | "info"; requireNote: boolean; toast: string }
> = {
  approve: {
    title: "Approve claim",
    verb: "Approve",
    tone: "success",
    requireNote: false,
    toast: "Claim approved and queued for payment.",
  },
  return: {
    title: "Request changes",
    verb: "Send back",
    tone: "info",
    requireNote: true,
    toast: "Claim returned to the employee.",
  },
  reject: {
    title: "Reject claim",
    verb: "Reject",
    tone: "info",
    requireNote: true,
    toast: "Claim rejected.",
  },
};

export default function ApproverReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useSnackbar();
  const claim = getClaim(params.id);

  const [decision, setDecision] = React.useState<Decision>(null);
  const [note, setNote] = React.useState("");
  const [noteError, setNoteError] = React.useState<string>();

  if (!claim) {
    return (
      <AppShell>
        <EmptyState
          icon={AlertTriangle}
          title="Claim not found"
          body="This claim may have been decided already or the link is incorrect."
          action={
            <Button href="/approver" icon={ArrowLeft}>
              Back to inbox
            </Button>
          }
        />
      </AppShell>
    );
  }

  const employee = getUser(claim.employeeId);
  const total = computeClaimTotal(claim);
  const decided = claim.status !== "pending";

  const timeline: TimelineEntry[] = claim.approvals.map((a) => ({
    id: a.id,
    title: ACTION_LABEL[a.action],
    actor: getUserName(a.actorId),
    timestamp: formatDateTime(a.at),
    body: a.note,
    tone: ACTION_TONE[a.action],
  }));

  function openDecision(d: Exclude<Decision, null>) {
    setDecision(d);
    setNote("");
    setNoteError(undefined);
  }

  function confirmDecision() {
    if (!decision) return;
    const meta = DECISION_META[decision];
    if (meta.requireNote && note.trim().length === 0) {
      setNoteError("Please add a note so the employee knows what to do.");
      return;
    }
    show(meta.toast, { tone: "success" });
    setDecision(null);
    router.push("/approver");
  }

  return (
    <AppShell>
      <div className="mx-0 max-w-4xl space-y-6">
        <Button href="/approver" variant="text" size="sm" icon={ArrowLeft}>
          Back to inbox
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-on-surface">{claim.title}</h1>
              <StatusChip status={claim.status} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm text-on-surface-variant">
              <Avatar
                name={employee?.name ?? "Unknown"}
                size="sm"
                color={(employee?.avatarColor as never) ?? "primary"}
              />
              <span>
                {employee?.name} · {employee?.department} · {claim.reference}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-on-surface">{claim.purpose}</p>
            <p className="mt-1 text-sm text-on-surface-variant">
              {claim.destination} · {formatDate(claim.tripStart ?? claim.createdAt)}
              {claim.tripEnd ? ` → ${formatDate(claim.tripEnd)}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
              Amount claimed
            </p>
            <p className="text-2xl font-bold text-on-surface">{formatCurrency(total)}</p>
          </div>
        </div>

        {claim.exception && (
          <Card className="border-error/40 bg-error-container/40">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-error" strokeWidth={1.75} aria-hidden />
              <div>
                <p className="text-sm font-semibold text-on-surface">
                  Policy exception ({claim.exception.severity} severity)
                </p>
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
                  const cat = getCategory(l.categoryId);
                  const receiptMissing =
                    !l.hasReceipt && cat ? l.amount > cat.receiptThreshold : false;
                  return (
                    <li key={l.id} className="flex items-center gap-3 px-3 py-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-on-surface">{l.description}</p>
                        <p className="text-xs text-on-surface-variant">
                          {cat?.name} · {formatDate(l.date)}
                          {l.quantity && l.unitLabel ? ` · ${l.quantity} ${l.unitLabel}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-on-surface">
                          {formatCurrency(l.amount)}
                        </span>
                        {receiptMissing ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-error">
                            <AlertTriangle className="h-3 w-3" strokeWidth={2} aria-hidden />
                            receipt required
                          </span>
                        ) : l.hasReceipt ? (
                          <span className="text-[11px] text-success">receipt attached</span>
                        ) : (
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
            <Card title="Decision">
              {decided ? (
                <div className="space-y-3">
                  <StatusChip status={claim.status} />
                  <p className="text-sm text-on-surface-variant">
                    This claim has already been decided. See the timeline for details.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-on-surface-variant">
                    Choose an outcome. Requesting changes or rejecting requires a note.
                  </p>
                  <Button
                    icon={CheckCircle2}
                    fullWidth
                    onClick={() => openDecision("approve")}
                  >
                    Approve
                  </Button>
                  <Button
                    icon={RotateCcw}
                    variant="tonal"
                    fullWidth
                    onClick={() => openDecision("return")}
                  >
                    Request changes
                  </Button>
                  <Button
                    icon={XCircle}
                    variant="outlined"
                    fullWidth
                    onClick={() => openDecision("reject")}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </Card>

            <Card title="Status timeline">
              <Timeline entries={timeline} />
            </Card>

            <Card padded={false}>
              <div className="p-2">
                <Button
                  href={`/claims/${claim.id}/comments`}
                  variant="text"
                  icon={MessageSquare}
                  fullWidth
                  className="justify-start"
                >
                  Comments
                </Button>
                <Button
                  href={`/claims/${claim.id}/audit`}
                  variant="text"
                  icon={History}
                  fullWidth
                  className="justify-start"
                >
                  Audit trail
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <Dialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision ? DECISION_META[decision].title : ""}
        description={
          decision
            ? `${claim.title} · ${formatCurrency(total)} · ${employee?.name ?? ""}`
            : undefined
        }
        icon={
          decision === "approve" ? (
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-success-container text-success-container-foreground">
              <CheckCircle2 className="h-6 w-6" strokeWidth={1.75} aria-hidden />
            </span>
          ) : decision === "return" ? (
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-warning-container text-warning-container-foreground">
              <RotateCcw className="h-6 w-6" strokeWidth={1.75} aria-hidden />
            </span>
          ) : (
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
              <XCircle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
            </span>
          )
        }
        footer={
          <>
            <Button variant="text" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === "reject" ? "danger" : "filled"}
              onClick={confirmDecision}
            >
              {decision ? DECISION_META[decision].verb : ""}
            </Button>
          </>
        }
      >
        <TextArea
          label={
            decision === "approve"
              ? "Note (optional)"
              : "Note to the employee"
          }
          required={decision !== null && DECISION_META[decision].requireNote}
          placeholder={
            decision === "return"
              ? "e.g. Please attach the hotel invoice and resubmit."
              : decision === "reject"
              ? "e.g. Suite upgrade exceeds the nightly cap."
              : "Add an optional note…"
          }
          value={note}
          error={noteError}
          onChange={(e) => {
            setNote(e.target.value);
            if (noteError) setNoteError(undefined);
          }}
        />
      </Dialog>
    </AppShell>
  );
}

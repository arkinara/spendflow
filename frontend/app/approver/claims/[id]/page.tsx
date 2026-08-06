"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  Ban,
  Send,
  FileText,
  Image as ImageIcon,
  Download,
  Plane,
  BedDouble,
  Utensils,
  Car,
  Route as RouteIcon,
  Receipt,
  AlertOctagon,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { useSnackbar } from "@/components/ui/Snackbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusChip } from "@/components/ui/StatusChip";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useApproverClaim } from "@/lib/mock/useApproverClaim";
import {
  decide as apiDecide,
  ApprovalApiError,
  type DecisionAction,
} from "@/lib/api/approvals";
import {
  listComments as apiListComments,
  addComment as apiAddComment,
  CommentApiError,
  type BackendComment,
} from "@/lib/api/comments";
import type { BackendAuditEntry } from "@/lib/api/claims";
import { evaluateLinePolicy } from "@/lib/mock/policy";
import {
  getUserName,
  getCategory,
  computeClaimTotal,
} from "@/lib/mock/mock_data";
import type {
  Claim,
  LineItem,
  Attachment,
  ExpenseCategoryId,
} from "@/lib/types";
import { formatCurrency, formatDate, formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<ExpenseCategoryId, LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  meals: Utensils,
  taxi: Car,
  mileage: RouteIcon,
  other: Receipt,
};

const ACTION_TONE: Record<string, TimelineEntry["tone"]> = {
  created: "default",
  submitted: "info",
  approved: "success",
  rejected: "error",
  returned: "warning",
  resubmitted: "info",
  withdrawn: "warning",
  processing: "info",
  paid: "success",
  commented: "default",
  default: "default",
};

const ACTION_LABEL: Record<string, string> = {
  created: "Claim created",
  submitted: "Submitted for approval",
  approved: "Approved",
  rejected: "Rejected",
  returned: "Returned for changes",
  resubmitted: "Resubmitted",
  withdrawn: "Withdrawn",
  processing: "Payment processing",
  paid: "Payment disbursed",
  commented: "Comment added",
};

/**
 * Normalise a backend audit `action` string (e.g. `claim.submitted`,
 * `claim.approved.advance`) into a stable key the label/tone maps understand.
 * Mirrors the employee detail page (#18); unknown prefixes fall back to a
 * generic timeline row so the audit never silently drops an event.
 */
function auditKey(action: string): string {
  const lower = action.toLowerCase();
  for (const key of [
    "resubmitted",
    "submitted",
    "withdrawn",
    "approved",
    "rejected",
    "returned",
    "processing",
    "paid",
    "created",
    "attachment.upload",
    "attachment.delete",
    "exception",
  ]) {
    if (lower.includes(key)) {
      if (key === "attachment.upload") return "created";
      if (key === "attachment.delete") return "withdrawn";
      if (key === "exception") return lower.includes("override") ? "approved" : "returned";
      return key;
    }
  }
  return "default";
}

function isRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function prettifyAction(action: string): string {
  return action
    .replace(/^[a-z]+\./, "")
    .replace(/[_\.]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function buildTimeline(audit: BackendAuditEntry[] | undefined): TimelineEntry[] {
  if (!audit || audit.length === 0) return [];
  return audit.map((entry) => {
    const key = auditKey(entry.action);
    const after = isRecord(entry.after);
    const before = isRecord(entry.before);
    const body =
      (after && typeof after.status === "string"
        ? before && typeof before.status === "string"
          ? `${before.status} → ${after.status}`
          : `Status: ${after.status}`
        : null) ?? undefined;
    return {
      id: entry.id,
      title: ACTION_LABEL[key] ?? prettifyAction(entry.action),
      actor: getUserName(entry.actorId),
      timestamp: formatDateTime(entry.createdAt),
      body,
      tone: ACTION_TONE[key] ?? "default",
    };
  });
}

interface DecisionMeta {
  title: string;
  verb: string;
  icon: LucideIcon;
  iconWrap: string;
  requireNote: boolean;
  placeholder: string;
  label: string;
}

const DECISION_META: Record<DecisionAction, DecisionMeta> = {
  approve: {
    title: "Approve claim",
    verb: "Approve",
    icon: CheckCircle2,
    iconWrap: "bg-success-container text-success-container-foreground",
    requireNote: false,
    placeholder: "Add an optional note for the employee…",
    label: "Note (optional)",
  },
  request_changes: {
    title: "Request changes",
    verb: "Send back",
    icon: RotateCcw,
    iconWrap: "bg-warning-container text-warning-container-foreground",
    requireNote: true,
    placeholder: "e.g. Please attach the hotel invoice and resubmit.",
    label: "Note to the employee",
  },
  reject: {
    title: "Reject claim",
    verb: "Reject",
    icon: XCircle,
    iconWrap: "bg-error-container text-error-container-foreground",
    requireNote: true,
    placeholder: "e.g. Suite upgrade exceeds the nightly cap.",
    label: "Reason for rejection",
  },
};

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

function lineMerchant(line: LineItem): string | null {
  if (!line.note) return null;
  const m = line.note.match(/^Merchant:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

function attachmentDataUrl(a: Attachment): string {
  const placeholder = [
    "SpendFlow receipt",
    `File: ${a.fileName}`,
    `Size: ${a.sizeKb} KB`,
    "",
    "Download links will resolve to the backend attachment route once exposed.",
  ].join("\n");
  return `data:text/plain;charset=utf-8,${encodeURIComponent(placeholder)}`;
}

export default function ApproverReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useSnackbar();
  const { user } = useRole();
  const { state, reload } = useApproverClaim(params.id);

  const [decision, setDecision] = React.useState<DecisionAction | null>(null);
  const [note, setNote] = React.useState("");
  const [noteError, setNoteError] = React.useState<string>();
  const [submitting, setSubmitting] = React.useState(false);
  const [conflict, setConflict] = React.useState<string | null>(null);

  if (state.status === "loading") {
    return (
      <AppShell>
        <ReviewSkeleton />
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
                {state.message || "Something went wrong while loading this claim."}{" "}
                Try again.
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

  if (state.status === "denied") {
    // 403 from the BE: the claim is not at the caller's step (cross-approver
    // access, already-decided claim, or withdrawn). The same panel handles all
    // three because the BE cannot distinguish them from this endpoint.
    return (
      <AppShell>
        <EmptyState
          icon={Ban}
          title="No longer awaiting your decision"
          body="This claim is not currently at your approval step — it may have been decided, advanced, or withdrawn. It has been removed from your inbox."
          action={
            <Button href="/approver" icon={ArrowLeft}>
              Back to inbox
            </Button>
          }
        />
      </AppShell>
    );
  }

  const claim = state.claim;
  const employeeName = state.employeeName;
  const total = computeClaimTotal(claim);
  const timeline = buildTimeline(state.audit);
  const steps = state.steps;
  const currentStep = state.currentStep;

  function openDecision(d: DecisionAction) {
    setDecision(d);
    setNote("");
    setNoteError(undefined);
  }

  async function confirmDecision() {
    if (!decision) return;
    const meta = DECISION_META[decision];
    // Client-side pre-check so an empty required note doesn't round-trip;
    // the BE enforces the same rule and its 400 message is surfaced inline
    // below on the rare path this pre-check is bypassed.
    if (meta.requireNote && note.trim().length === 0) {
      setNoteError("A comment is required so the employee knows what to do.");
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await apiDecide(claim.id, {
        action: decision,
        comment: note.trim() ? note.trim() : undefined,
      });
      show(
        decision === "approve"
          ? outcome.finalised
            ? "Claim approved and queued for payment."
            : "Approved — advanced to the next review step."
          : decision === "reject"
            ? "Claim rejected."
            : "Claim returned to the employee.",
        { tone: "success" }
      );
      setDecision(null);
      // On any decision the claim leaves this approver's inbox: advanced to
      // the next step, finalised, rejected, or returned. Route back so the
      // inbox reflects the new state.
      router.push("/approver");
    } catch (err) {
      if (err instanceof ApprovalApiError) {
        // Stale-step / already-decided claim: the typed conflict surface as
        // the "claim has changed" panel so the approver doesn't re-act. We
        // intentionally do NOT reload here — reloading would flip the page
        // to loading/denied and hide the dialog before the user reads it.
        // The dialog's "Back to inbox" button navigates to a fresh state.
        if (err.code === "stale_decision") {
          setConflict(err.message);
          setDecision(null);
        } else if (err.status === 400 && err.code === "comment_required") {
          // The BE's required-comment 400 maps straight onto the inline note
          // error so the dialog stays open and the user can fix the input.
          setNoteError(err.message);
        } else {
          show(err.message, { tone: "error" });
        }
      } else {
        show(err instanceof Error ? err.message : "We couldn't apply this decision. Try again.", {
          tone: "error",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-0 max-w-4xl space-y-6">
        <Button href="/approver" variant="text" size="sm" icon={ArrowLeft}>
          Back to inbox
        </Button>

        <ClaimHeader
          claim={claim}
          total={total}
          employeeName={employeeName}
          currentStepLabel={currentStep?.label}
        />

        {claim.exception && claim.exception.status === "open" && (
          <Card className="border-error/40 bg-error-container/40">
            <div className="flex gap-3">
              <AlertTriangle
                className="h-5 w-5 shrink-0 text-error"
                strokeWidth={1.75}
                aria-hidden
              />
              <div>
                <p className="text-sm font-semibold text-on-surface">
                  Policy exception ({claim.exception.severity} severity)
                </p>
                <p className="text-sm text-on-surface-variant">
                  {claim.exception.message}
                </p>
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
                        <p className="truncate text-sm font-medium text-on-surface">
                          {l.description}
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          {getCategory(l.categoryId)?.name} · {formatDate(l.date)}
                          {merchant ? ` · ${merchant}` : ""}
                          {l.quantity && l.unitLabel
                            ? ` · ${l.quantity} ${l.unitLabel}`
                            : ""}
                        </p>
                        {flag && (
                          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-error-container px-2 py-0.5 text-[11px] font-medium text-error-container-foreground">
                            <ShieldAlert
                              className="h-3 w-3"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                            {flag}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-on-surface">
                          {formatCurrency(l.amount, l.currency)}
                        </span>
                        {!l.hasReceipt && !flag && (
                          <span className="text-[11px] text-on-surface-variant">
                            no receipt
                          </span>
                        )}
                        {l.hasReceipt && (
                          <span className="text-[11px] text-success">
                            receipt attached
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between border-t border-outline-variant px-5 py-4">
                <span className="text-sm font-medium text-on-surface-variant">
                  Total claimed
                </span>
                <span className="text-lg font-bold text-on-surface">
                  {formatCurrency(total, claim.currency)}
                </span>
              </div>
            </Card>

            <Card
              title="Attachments"
              subtitle={`${claim.attachments.length} file${
                claim.attachments.length === 1 ? "" : "s"
              }`}
            >
              {claim.attachments.length === 0 ? (
                <p className="text-sm text-on-surface-variant">
                  No receipts attached. The BE surfaces the per-line
                  <span className="px-1 font-medium">hasReceipt</span> flag; a
                  dedicated list-attachments endpoint ships in a later phase.
                </p>
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
                          <Icon
                            className="h-[18px] w-[18px]"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-on-surface">
                            {a.fileName}
                          </p>
                          <p className="text-xs text-on-surface-variant">
                            {a.sizeKb} KB
                          </p>
                        </div>
                        <a
                          href={attachmentDataUrl(a)}
                          download={a.fileName}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={`Download ${a.fileName}`}
                        >
                          <Download
                            className="h-4 w-4"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <CommentsCard claimId={claim.id} approverId={user.id} approverName={user.name} />
          </div>

          <div className="space-y-6">
            <Card title="Decision">
              <div className="space-y-3">
                <p className="text-sm text-on-surface-variant">
                  {steps.length > 1
                    ? `This claim needs ${steps.length} approvals (${steps
                        .map((s) => s.label)
                        .join(" → ")}). Your approval advances it to the next step.`
                    : "You are the final approver for this claim."}
                  Requesting changes or rejecting requires a comment.
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
                  onClick={() => openDecision("request_changes")}
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
            </Card>

            <Card
              title="Status timeline"
              role="region"
              aria-label="Status timeline"
            >
              <Timeline entries={timeline} />
            </Card>
          </div>
        </div>
      </div>

      <DecisionDialog
        action={decision}
        claimTitle={claim.title}
        totalLabel={`${formatCurrency(total, claim.currency)} · ${employeeName}`}
        note={note}
        noteError={noteError}
        submitting={submitting}
        onNoteChange={(v) => {
          setNote(v);
          if (noteError) setNoteError(undefined);
        }}
        onClose={() => {
          if (submitting) return;
          setDecision(null);
        }}
        onConfirm={confirmDecision}
      />

      <Dialog
        open={!!conflict}
        onClose={() => setConflict(null)}
        title="This claim has changed"
        description={conflict ?? undefined}
        icon={
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
            <AlertOctagon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
          </span>
        }
        footer={
          <>
            <Button variant="text" onClick={() => setConflict(null)}>
              Stay here
            </Button>
            <Button onClick={() => router.push("/approver")}>Back to inbox</Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant">
          The claim was updated since you opened it. Your decision was not
          applied to avoid acting on stale state.
        </p>
      </Dialog>
    </AppShell>
  );

  function ClaimHeader({
    claim,
    total,
    employeeName,
    currentStepLabel,
  }: {
    claim: Claim;
    total: number;
    employeeName: string;
    currentStepLabel?: string;
  }) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">
              {claim.title}
            </h1>
            <StatusChip status={claim.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
            <Avatar name={employeeName || "Unknown"} size="sm" color="primary" />
            <span>
              {employeeName}
              {currentStepLabel ? ` · ${currentStepLabel}` : ""} · {claim.reference}
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
          <p className="text-2xl font-bold text-on-surface">
            {formatCurrency(total, claim.currency)}
          </p>
        </div>
      </div>
    );
  }
}

/* ---------------------------------------------------------------- DecisionDialog */

function DecisionDialog({
  action,
  claimTitle,
  totalLabel,
  note,
  noteError,
  submitting,
  onNoteChange,
  onClose,
  onConfirm,
}: {
  action: DecisionAction | null;
  claimTitle: string;
  totalLabel: string;
  note: string;
  noteError?: string;
  submitting: boolean;
  onNoteChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const meta = action ? DECISION_META[action] : null;
  const Icon = meta?.icon;
  return (
    <Dialog
      open={action !== null}
      onClose={onClose}
      dismissable={!submitting}
      title={meta?.title ?? ""}
      description={`${claimTitle} · ${totalLabel}`}
      icon={
        Icon ? (
          <span
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-full",
              meta!.iconWrap
            )}
          >
            <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={action === "reject" ? "danger" : "filled"}
            onClick={onConfirm}
            loading={submitting}
          >
            {meta?.verb ?? ""}
          </Button>
        </>
      }
    >
      <TextArea
        label={meta?.label}
        required={!!meta?.requireNote}
        placeholder={meta?.placeholder}
        value={note}
        error={noteError}
        onChange={(e) => onNoteChange(e.target.value)}
      />
    </Dialog>
  );
}

/* ---------------------------------------------------------------- CommentsCard */

function CommentsCard({
  claimId,
  approverId,
  approverName,
}: {
  claimId: string;
  approverId: string;
  approverName: string;
}) {
  const { show } = useSnackbar();
  const [version, setVersion] = React.useState(0);
  const [draft, setDraft] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const [thread, setThread] = React.useState<BackendComment[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Best-effort thread load + reload on `version` bump (after a post).
  React.useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    apiListComments(claimId)
      .then((rows) => {
        if (!cancelled) setThread(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          // A 403 here means the session lost access between the page load and
          // the comment read; surface a minimal empty thread rather than
          // blanking the card.
          setThread([]);
          setLoadError(
            err instanceof CommentApiError
              ? err.message
              : "Couldn't load the comment thread.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [claimId, version]);

  async function send() {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await apiAddComment(claimId, body);
      setVersion((v) => v + 1);
      setDraft("");
      show("Comment posted.", { tone: "success" });
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't post that comment.", {
        tone: "error",
      });
    } finally {
      setPosting(false);
    }
  }

  return (
    <Card title="Comments" padded={false}>
      {loadError ? (
        <p className="px-5 py-4 text-sm text-on-surface-variant">{loadError}</p>
      ) : thread.length === 0 ? (
        <p className="px-5 py-4 text-sm text-on-surface-variant">
          No comments yet. Add one below without taking a formal decision.
        </p>
      ) : (
        <ul className="space-y-4 p-5">
          {thread.map((c) => (
            <CommentBubble key={c.id} comment={c} mine={c.authorId === approverId} />
          ))}
        </ul>
      )}
      <div className="border-t border-outline-variant p-4">
        <div className="flex items-end gap-3">
          <Avatar name={approverName} size="sm" color="tertiary" />
          <div className="flex-1">
            <TextArea
              aria-label="Add a comment"
              rows={2}
              placeholder="Write a comment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
            />
          </div>
          <Button
            icon={Send}
            onClick={send}
            disabled={!draft.trim() || posting}
            loading={posting}
            variant="tonal"
          >
            Send
          </Button>
        </div>
        <p className="mt-1.5 pl-11 text-xs text-on-surface-variant">
          Press ⌘/Ctrl + Enter to send. Posting a comment does not change the
          claim status.
        </p>
      </div>
    </Card>
  );
}

function CommentBubble({
  comment,
  mine,
}: {
  comment: BackendComment;
  mine: boolean;
}) {
  return (
    <li className={cn("flex gap-3", mine && "flex-row-reverse")}>
      <Avatar name={comment.authorName || "Unknown"} size="sm" color="primary" />
      <div className={cn("min-w-0 max-w-[80%]", mine && "text-right")}>
        <div className={cn("flex items-baseline gap-2", mine && "flex-row-reverse")}>
          <span className="text-sm font-medium text-on-surface">
            {mine ? "You" : comment.authorName}
          </span>
          <time
            className="text-xs text-on-surface-variant"
            title={formatDateTime(comment.createdAt)}
          >
            {formatRelativeTime(comment.createdAt)}
          </time>
        </div>
        <div
          className={cn(
            "mt-1 inline-block rounded-2xl px-4 py-2.5 text-left text-sm",
            mine
              ? "bg-primary text-primary-foreground"
              : "bg-surface-container text-on-surface"
          )}
        >
          {comment.body}
        </div>
      </div>
    </li>
  );
}

function ReviewSkeleton() {
  return (
    <div
      aria-busy="true"
      role="status"
      aria-label="Loading claim"
      className="mx-0 max-w-4xl space-y-6"
    >
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

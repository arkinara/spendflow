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
  MessagesSquare,
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
import { decideOnClaim, addClaimComment, type DecisionAction } from "@/lib/mock/claimStore";
import { evaluateLinePolicy } from "@/lib/mock/policy";
import {
  getUser,
  getUserName,
  getCategory,
  commentsForClaim,
  computeClaimTotal,
  routingStepsForClaim,
  type Claim,
  type LineItem,
  type Attachment,
  type Comment,
  type ApprovalAction,
  type ExpenseCategoryId,
} from "@/lib/mock/mock_data";
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

function buildTimeline(claim: Claim): TimelineEntry[] {
  const stamped: { at: string; entry: TimelineEntry }[] = claim.approvals.map(
    (a) => ({
      at: a.at,
      entry: {
        id: a.id,
        title: ACTION_LABEL[a.action],
        actor: getUserName(a.actorId),
        timestamp: formatDateTime(a.at),
        body: a.note,
        tone: ACTION_TONE[a.action],
      },
    })
  );

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

  return stamped.sort((a, b) => a.at.localeCompare(b.at)).map((s) => s.entry);
}

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
    "SpendFlow mock receipt placeholder",
    `File: ${a.fileName}`,
    `Size: ${a.sizeKb} KB`,
    "",
    "Demo data — real receipts are delivered by the backend (BE-claims).",
  ].join("\n");
  return `data:text/plain;charset=utf-8,${encodeURIComponent(placeholder)}`;
}

/** A claim is actionable by the approver only while it sits at their step. */
function isActionable(claim: Claim): boolean {
  return claim.status === "pending" && (claim.currentStepIndex ?? 0) === 0;
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

  const claim = state.claim;
  const employee = getUser(claim.employeeId);
  const total = computeClaimTotal(claim);
  const timeline = buildTimeline(claim);
  const actionable = isActionable(claim);
  const steps = routingStepsForClaim(claim);

  function openDecision(d: DecisionAction) {
    setDecision(d);
    setNote("");
    setNoteError(undefined);
  }

  function confirmDecision() {
    if (!decision || !claim) return;
    const meta = DECISION_META[decision];
    if (meta.requireNote && note.trim().length === 0) {
      setNoteError("A comment is required so the employee knows what to do.");
      return;
    }
    setSubmitting(true);
    try {
      const outcome = decideOnClaim({
        claimId: claim.id,
        approverId: user.id,
        action: decision,
        note,
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
      reload();
      if (outcome.finalised || decision !== "approve") {
        // Approved-final, rejected, or returned → claim leaves the inbox.
        router.push("/approver");
      } else {
        // Advanced past this approver's step → also leaves the inbox.
        router.push("/approver");
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "We couldn't apply this decision. Try again.";
      // Stale/already-decided claim: surface as a conflict, not a silent fail.
      setConflict(message);
      setDecision(null);
      reload();
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

        <ClaimHeader claim={claim} total={total} />

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

        {!actionable && (
          <Card className="border-warning/40 bg-warning-container/40">
            <div className="flex items-start gap-3">
              <Ban
                className="mt-0.5 h-5 w-5 shrink-0 text-on-warning-container"
                strokeWidth={1.75}
                aria-hidden
              />
              <div>
                <p className="text-sm font-semibold text-on-surface">
                  No longer awaiting your decision
                </p>
                <p className="text-sm text-on-surface-variant">
                  This claim is{" "}
                  {claim.status === "pending"
                    ? "now at a later approval step"
                    : `already ${claim.status}`}
                  . It has been removed from your inbox. See the timeline below
                  for details.
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
                  No receipts attached.
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
              {actionable ? (
                <div className="space-y-3">
                  <p className="text-sm text-on-surface-variant">
                    {steps.length > 1
                      ? `This claim needs ${steps.length} approvals (${steps.join(
                          " → "
                        )}). Your approval advances it to the next step.`
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
              ) : (
                <div className="space-y-3">
                  <StatusChip status={claim.status} />
                  <p className="text-sm text-on-surface-variant">
                    This claim is no longer awaiting your decision. See the
                    timeline for details, or return to your inbox.
                  </p>
                  <Button href="/approver" icon={ArrowLeft} fullWidth>
                    Back to inbox
                  </Button>
                </div>
              )}
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
        totalLabel={`${formatCurrency(total, claim.currency)} · ${
          employee?.name ?? ""
        }`}
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

  function ClaimHeader({ claim, total }: { claim: Claim; total: number }) {
    const employee = getUser(claim.employeeId);
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
  // Bump `version` after posting so `commentsForClaim` re-reads the live store
  // (where the comment was persisted) without keeping a duplicate local copy.
  const [version, setVersion] = React.useState(0);
  const [draft, setDraft] = React.useState("");

  const thread = React.useMemo(
    () => commentsForClaim(claimId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [claimId, version]
  );

  function send() {
    const body = draft.trim();
    if (!body) return;
    try {
      addClaimComment({ claimId, authorId: approverId, body });
      setVersion((v) => v + 1);
      setDraft("");
      show("Comment posted.", { tone: "success" });
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't post that comment.", {
        tone: "error",
      });
    }
  }

  return (
    <Card title="Comments" padded={false}>
      {thread.length === 0 ? (
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
            disabled={!draft.trim()}
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

function CommentBubble({ comment, mine }: { comment: Comment; mine: boolean }) {
  const author = getUser(comment.authorId);
  return (
    <li className={cn("flex gap-3", mine && "flex-row-reverse")}>
      <Avatar
        name={author?.name ?? "Unknown"}
        size="sm"
        color={(author?.avatarColor as never) ?? "primary"}
      />
      <div className={cn("min-w-0 max-w-[80%]", mine && "text-right")}>
        <div className={cn("flex items-baseline gap-2", mine && "flex-row-reverse")}>
          <span className="text-sm font-medium text-on-surface">
            {mine ? "You" : author?.name}
          </span>
          <time
            className="text-xs text-on-surface-variant"
            title={formatDateTime(comment.at)}
          >
            {formatRelativeTime(comment.at)}
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

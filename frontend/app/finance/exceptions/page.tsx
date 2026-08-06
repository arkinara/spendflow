"use client";

import * as React from "react";
import {
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertOctagon,
  Plane,
  BedDouble,
  Utensils,
  Car,
  Route as RouteIcon,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSnackbar } from "@/components/ui/Snackbar";
import { useFinanceExceptions } from "@/lib/hooks/useFinanceLists";
import {
  resolveException as resolveExceptionApi,
  FinanceApiError,
  type FinanceExceptionItem,
  type ExceptionAction,
} from "@/lib/api/finance";
import {
  evaluateLinePolicy,
  violationsForLine,
} from "@/lib/utils/policy";
import {
  computeClaimTotal,
  getCategory,
} from "@/lib/seed-data";
import type {
  ClaimException,
  LineItem,
  ExpenseCategoryId,
} from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const EXCEPTION_LABEL: Record<ClaimException["type"], string> = {
  missing_receipt: "Missing receipt",
  over_policy: "Over policy cap",
  duplicate: "Possible duplicate",
  late_submission: "Late submission",
};

const SEVERITY_TONE: Record<ClaimException["severity"], string> = {
  high: "bg-error-container text-error-container-foreground",
  medium: "bg-warning-container text-warning-container-foreground",
  low: "bg-info-container text-info-container-foreground",
};

const CATEGORY_ICON: Record<ExpenseCategoryId, LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  meals: Utensils,
  taxi: Car,
  mileage: RouteIcon,
  other: Receipt,
};

export default function ExceptionsPage() {
  const { show } = useSnackbar();
  const { state, retry, refresh } = useFinanceExceptions();

  const [active, setActive] = React.useState<FinanceExceptionItem | null>(null);
  const [pendingAction, setPendingAction] = React.useState<ExceptionAction | null>(null);
  const [note, setNote] = React.useState("");
  const [noteError, setNoteError] = React.useState<string>();
  const [submitting, setSubmitting] = React.useState(false);
  const [conflict, setConflict] = React.useState<string | null>(null);

  function openResolve(claim: FinanceExceptionItem) {
    setActive(claim);
    setPendingAction(null);
    setNote("");
    setNoteError(undefined);
  }

  function closeResolve() {
    if (submitting) return;
    setActive(null);
    setPendingAction(null);
    setNote("");
    setNoteError(undefined);
  }

  async function confirmResolve() {
    if (!active || !pendingAction) return;
    // Fast-path FE guard: never round-trip an obviously-empty justification.
    // The BE independently enforces non-empty (400 comment_required) and that
    // path also surfaces inline below — defense in depth.
    if (note.trim().length === 0) {
      setNoteError("A justification is required so the decision is auditable.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await resolveExceptionApi(active.id, {
        action: pendingAction,
        comment: note,
      });
      show(
        pendingAction === "override"
          ? `Exception overridden — ${result.claim.reference} is ready to pay.`
          : `${result.claim.reference} returned to the employee.`,
        { tone: "success" }
      );
      closeResolve();
      refresh();
    } catch (err) {
      if (err instanceof FinanceApiError && err.code === "stale_decision") {
        // The claim moved out of Approved since the dialog opened — surface the
        // existing stale panel so the Finance Admin isn't acting on stale state.
        setConflict(err.message);
        closeResolve();
        refresh();
      } else {
        // 400 (comment_required / validation_required) / 403 / 404 — show the
        // BE's message inline on the justification field.
        const message =
          err instanceof FinanceApiError
            ? err.message
            : "We couldn't apply this decision. Try again.";
        setNoteError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const itemCount = state.status === "ready" ? state.items.length : 0;

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">Exception queue</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              {state.status === "ready"
                ? `${itemCount} approved claim${itemCount === 1 ? "" : "s"} with an open policy flag awaiting your judgment.`
                : "Approved claims with open policy flags awaiting a finance decision."}
            </p>
          </div>
          {state.status === "ready" && (
            <Button
              variant="outlined"
              icon={RefreshCw}
              onClick={refresh}
              aria-label="Retry — refresh the queue"
            >
              Refresh
            </Button>
          )}
        </div>

        {state.status === "loading" && <QueueSkeleton />}
        {state.status === "error" && (
          <QueueError message={state.message} onRetry={retry} />
        )}
        {state.status === "ready" && (
          <Card padded={false}>
            <DataTable
              columns={buildColumns(openResolve)}
              data={state.items}
              rowKey={(c) => c.id}
              density="compact"
              caption="Open policy exceptions on approved claims"
              empty={
                <EmptyState
                  icon={ShieldCheck}
                  title="All clear"
                  body="No approved claims are carrying an open policy flag. Flagged claims will appear here for review."
                />
              }
            />
          </Card>
        )}
      </div>

      <ResolveDialog
        claim={active}
        pendingAction={pendingAction}
        note={note}
        noteError={noteError}
        submitting={submitting}
        onChoose={(a) => {
          setPendingAction(a);
          setNote("");
          setNoteError(undefined);
        }}
        onNoteChange={(v) => {
          setNote(v);
          if (noteError) setNoteError(undefined);
        }}
        onClose={closeResolve}
        onConfirm={confirmResolve}
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
              Dismiss
            </Button>
            <Button onClick={refresh}>Refresh queue</Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant">
          The claim was updated since you opened it (it may already have been
          resolved or moved out of the finance queue). Your decision was not
          applied to avoid acting on stale state.
        </p>
      </Dialog>
    </AppShell>
  );
}

function buildColumns(
  onResolve: (c: FinanceExceptionItem) => void,
): Column<FinanceExceptionItem>[] {
  return [
    {
      key: "reference",
      header: "Claim",
      sortable: true,
      sortValue: (c) => c.reference,
      render: (c) => (
        <div>
          <p className="font-medium text-on-surface">{c.title}</p>
          <p className="text-xs text-on-surface-variant">{c.reference}</p>
        </div>
      ),
    },
    {
      key: "employee",
      header: "Employee",
      sortable: true,
      sortValue: (c) => c.employeeName || "Unknown",
      render: (c) => c.employeeName || "Unknown",
    },
    {
      key: "amount",
      header: "Total",
      align: "right",
      sortable: true,
      sortValue: (c) => computeClaimTotal(c),
      render: (c) => (
        <div>
          <p className="font-semibold text-on-surface">
            {formatCurrency(computeClaimTotal(c))}
          </p>
          <p className="text-[11px] text-on-surface-variant">{c.currency}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Exception",
      sortable: true,
      sortValue: (c) => c.exception?.type ?? "",
      render: (c) =>
        c.exception ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
              SEVERITY_TONE[c.exception.severity]
            )}
          >
            <AlertTriangle className="h-3 w-3" strokeWidth={2} aria-hidden />
            {EXCEPTION_LABEL[c.exception.type]}
          </span>
        ) : null,
    },
    {
      key: "submitted",
      header: "Submitted",
      align: "right",
      sortable: true,
      sortValue: (c) => c.submittedAt ?? c.createdAt,
      render: (c) => formatDate(c.submittedAt ?? c.createdAt),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => <StatusChip status={c.status} size="sm" />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (c) => (
        <div className="flex justify-end gap-1.5">
          <Button href={`/claims/${c.id}/audit`} variant="text" size="sm">
            Audit
          </Button>
          <Button size="sm" onClick={() => onResolve(c)}>
            Resolve
          </Button>
        </div>
      ),
    },
  ];
}

function ResolveDialog({
  claim,
  pendingAction,
  note,
  noteError,
  submitting,
  onChoose,
  onNoteChange,
  onClose,
  onConfirm,
}: {
  claim: FinanceExceptionItem | null;
  pendingAction: ExceptionAction | null;
  note: string;
  noteError?: string;
  submitting: boolean;
  onChoose: (a: ExceptionAction) => void;
  onNoteChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const open = claim !== null;
  const choosing = pendingAction === null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!submitting}
      size="lg"
      title={pendingAction === "override" ? "Override exception" : pendingAction === "reject" ? "Reject flagged line" : "Resolve exception"}
      description={claim ? `${claim.title} · ${claim.reference}` : undefined}
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-warning-container text-warning-container-foreground">
          <ShieldAlert className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        choosing ? (
          <>
            <Button variant="text" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="outlined" icon={XCircle} onClick={() => onChoose("reject")}>
              Reject &amp; return
            </Button>
            <Button icon={CheckCircle2} onClick={() => onChoose("override")}>
              Override &amp; accept
            </Button>
          </>
        ) : (
          <>
            <Button variant="text" onClick={() => onChoose(pendingAction === "override" ? "reject" : "override")} disabled={submitting}>
              Back
            </Button>
            <Button
              variant={pendingAction === "reject" ? "danger" : "filled"}
              icon={pendingAction === "reject" ? XCircle : CheckCircle2}
              loading={submitting}
              onClick={onConfirm}
            >
              {pendingAction === "reject" ? "Reject & return" : "Confirm override"}
            </Button>
          </>
        )
      }
    >
      {claim?.exception && (
        <div className="mb-4 rounded-xl bg-error-container/60 px-4 py-3 text-sm text-on-surface">
          <p className="font-semibold">
            {EXCEPTION_LABEL[claim.exception.type]} · {claim.exception.severity} severity
          </p>
          <p className="mt-0.5 text-on-surface-variant">{claim.exception.message}</p>
        </div>
      )}

      {claim && <FlaggedLines claim={claim} />}

      {!choosing && (
        <div className="mt-4">
          <TextArea
            label={pendingAction === "override" ? "Justification (required)" : "Comment to employee (required)"}
            required
            placeholder={
              pendingAction === "override"
                ? "e.g. Pre-approved upgrade — accept the over-cap expense."
                : "e.g. Receipt is required for this amount. Please attach and resubmit."
            }
            value={note}
            error={noteError}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        </div>
      )}
    </Dialog>
  );
}

/** Render every line item, flagging the ones that violate policy with the reason. */
function FlaggedLines({ claim }: { claim: FinanceExceptionItem }) {
  const violations = claim.lineItems.flatMap((l) =>
    evaluateLinePolicy(
      {
        id: l.id,
        categoryId: l.categoryId,
        amount: l.amount,
        currency: l.currency,
        hasAttachment: l.hasReceipt,
      },
      claim.currency
    )
  );

  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-2">
      <ul className="divide-y divide-outline-variant">
        {claim.lineItems.map((l) => (
          <LineRow key={l.id} line={l} violations={violationsForLine(violations, l.id)} />
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-outline-variant px-3 py-2.5">
        <span className="text-xs font-medium text-on-surface-variant">Total claimed</span>
        <span className="text-sm font-bold text-on-surface">
          {formatCurrency(computeClaimTotal(claim), claim.currency)}
        </span>
      </div>
    </div>
  );
}

function LineRow({
  line,
  violations,
}: {
  line: LineItem;
  violations: ReturnType<typeof violationsForLine>;
}) {
  const Icon = CATEGORY_ICON[line.categoryId] ?? Receipt;
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-on-surface">{line.description}</p>
        <p className="text-xs text-on-surface-variant">
          {getCategory(line.categoryId)?.name} · {formatDate(line.date)} ·{" "}
          {line.hasReceipt ? "receipt attached" : "no receipt"}
        </p>
        {violations.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {violations.map((v) => (
              <li key={v.type}>
                <span className="inline-flex items-center gap-1 rounded-full bg-error-container px-2 py-0.5 text-[11px] font-medium text-error-container-foreground">
                  <ShieldAlert className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                  {v.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className="text-sm font-semibold text-on-surface">
        {formatCurrency(line.amount, line.currency)}
      </span>
    </li>
  );
}

function QueueSkeleton() {
  return (
    <div
      aria-busy="true"
      role="status"
      aria-label="Loading exception queue"
      className="space-y-3"
    >
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton variant="list" lines={4} />
    </div>
  );
}

function QueueError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <Card className="border-error/40" role="alert">
      <div className="flex flex-col items-center gap-4 px-4 py-10 text-center sm:flex-row sm:text-left">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-on-surface">
            Couldn&rsquo;t load the exception queue
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {message || "Something went wrong while loading exceptions."} Try again.
          </p>
        </div>
        <Button variant="outlined" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

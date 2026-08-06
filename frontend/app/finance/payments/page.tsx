"use client";

import * as React from "react";
import {
  Clock,
  Loader,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  AlertOctagon,
  Landmark,
  CreditCard,
  Wallet,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { StatusChip } from "@/components/ui/StatusChip";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSnackbar } from "@/components/ui/Snackbar";
import { useFinancePayments } from "@/lib/hooks/useFinanceLists";
import {
  markProcessing as markProcessingApi,
  markPaid as markPaidApi,
  FinanceApiError,
  type FinancePaymentItem,
} from "@/lib/api/finance";
import type { ClaimPayment } from "@/lib/types";
import { formatCurrency, formatCurrencyCompact, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type PendingAction = "processing" | "paid";

const METHOD_OPTIONS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "payroll", label: "Payroll deduction" },
];

export default function PaymentsBoard() {
  const { show } = useSnackbar();
  const { state, retry, refresh } = useFinancePayments();

  const [active, setActive] = React.useState<FinancePaymentItem | null>(null);
  const [action, setAction] = React.useState<PendingAction | null>(null);
  const [method, setMethod] = React.useState<ClaimPayment["method"]>("bank_transfer");
  const [reference, setReference] = React.useState("");
  const [errors, setErrors] = React.useState<{ method?: string; reference?: string }>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [conflict, setConflict] = React.useState<string | null>(null);

  function openProcessing(claim: FinancePaymentItem) {
    setActive(claim);
    setAction("processing");
    setMethod("bank_transfer");
    setReference("");
    setErrors({});
  }

  function openPaid(claim: FinancePaymentItem) {
    setActive(claim);
    setAction("paid");
    setErrors({});
  }

  function close() {
    if (submitting) return;
    setActive(null);
    setAction(null);
    setReference("");
    setErrors({});
  }

  async function confirm() {
    if (!active || !action) return;

    if (action === "processing") {
      // Fast-path FE guard: don't round-trip an obviously-empty reference.
      // The BE independently enforces non-empty (400 validation_required).
      const next: typeof errors = {};
      if (!method) next.method = "Select a payment method.";
      if (!reference.trim()) next.reference = "A bank or payroll reference is required.";
      setErrors(next);
      if (Object.keys(next).length > 0) return;
    }

    setSubmitting(true);
    try {
      if (action === "processing") {
        const result = await markProcessingApi(active.id, {
          method,
          reference: reference.trim(),
        });
        show(`${result.claim.reference} moved to Processing (${reference.trim()}).`, {
          tone: "success",
        });
      } else {
        const result = await markPaidApi(active.id);
        show(`${result.claim.reference} marked Paid — employee notified.`, {
          tone: "success",
        });
      }
      close();
      refresh();
    } catch (err) {
      if (err instanceof FinanceApiError && err.code === "stale_decision") {
        // Concurrent transition (already processing/paid) — surface the stale
        // panel so the Finance Admin sees the conflict rather than a silent
        // failure or a double-transition.
        setConflict(err.message);
        close();
        refresh();
      } else {
        // 400 (validation_required — missing reference) / 403 / 404 → inline.
        const message =
          err instanceof FinanceApiError
            ? err.message
            : "We couldn't update this payment. Try again.";
        if (action === "processing") {
          setErrors({ reference: message });
        } else {
          setConflict(message);
          close();
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  const approved = state.status === "ready" ? state.approved : [];
  const processing = state.status === "ready" ? state.processing : [];
  const paid = state.status === "ready" ? state.paid : [];

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">Payment board</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              Track reimbursements from approved through disbursement.
            </p>
          </div>
          {state.status === "ready" && (
            <BoardTotals
              readyCount={approved.length}
              inFlightCount={processing.length}
              paidCount={paid.length}
            />
          )}
        </div>

        {state.status === "loading" && <BoardSkeleton />}
        {state.status === "error" && (
          <BoardError message={state.message} onRetry={retry} />
        )}

        {state.status === "ready" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Column
              label="Ready to pay"
              icon={Clock}
              accent="text-on-surface-variant"
              claims={approved}
              onAction={(c) => openProcessing(c)}
              actionLabel="Mark Processing"
              render={(c) => <ReadyCard claim={c} onAction={() => openProcessing(c)} />}
            />
            <Column
              label="Processing"
              icon={Loader}
              accent="text-warning"
              claims={processing}
              onAction={(c) => openPaid(c)}
              actionLabel="Mark Paid"
              render={(c) => <ProcessingCard claim={c} onAction={() => openPaid(c)} />}
            />
            <Column
              label="Paid"
              icon={CheckCircle2}
              accent="text-success"
              claims={paid}
              render={(c) => <PaidCard claim={c} />}
            />
          </div>
        )}
      </div>

      <PaymentDialog
        claim={active}
        action={action}
        method={method}
        reference={reference}
        errors={errors}
        submitting={submitting}
        onMethodChange={(m) => {
          setMethod(m as ClaimPayment["method"]);
          if (errors.method) setErrors((e) => ({ ...e, method: undefined }));
        }}
        onReferenceChange={(v) => {
          setReference(v);
          if (errors.reference) setErrors((e) => ({ ...e, reference: undefined }));
        }}
        onClose={close}
        onConfirm={confirm}
      />

      <Dialog
        open={!!conflict}
        onClose={() => setConflict(null)}
        title="This payment has changed"
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
            <Button onClick={refresh}>Refresh board</Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant">
          The claim&rsquo;s payment state moved since you opened it (it may
          already have been processed or paid). Your action was not applied to
          avoid acting on stale state.
        </p>
      </Dialog>
    </AppShell>
  );
}

function BoardTotals({
  readyCount,
  inFlightCount,
  paidCount,
}: {
  readyCount: number;
  inFlightCount: number;
  paidCount: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Pill icon={Clock} label="Ready" value={readyCount} />
      <Pill icon={Loader} label="Processing" value={inFlightCount} />
      <Pill icon={CheckCircle2} label="Paid" value={paidCount} />
    </div>
  );
}

function Pill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-low px-3 py-1.5 text-xs font-medium text-on-surface-variant">
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      {label}
      <span className="rounded-full bg-surface-container-high px-1.5 text-[11px] font-semibold text-on-surface">
        {value}
      </span>
    </span>
  );
}

function Column({
  label,
  icon: Icon,
  accent,
  claims,
  actionLabel,
  onAction,
  render,
}: {
  label: string;
  icon: typeof Clock;
  accent: string;
  claims: FinancePaymentItem[];
  actionLabel?: string;
  onAction?: (c: FinancePaymentItem) => void;
  render: (c: FinancePaymentItem) => React.ReactNode;
}) {
  const total = claims.reduce((s, c) => s + c.totalAmount, 0);
  return (
    <section
      aria-label={label}
      className="flex flex-col rounded-2xl bg-surface-container p-3"
    >
      <header className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", accent)} strokeWidth={1.75} aria-hidden />
          <h2 className="text-sm font-semibold text-on-surface">{label}</h2>
          <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-surface-container-highest px-1.5 text-[11px] font-semibold text-on-surface-variant">
            {claims.length}
          </span>
        </div>
      </header>
      <p className="mb-2 px-1 text-xs text-on-surface-variant">
        {formatCurrencyCompact(total)}
      </p>
      <div className="flex flex-1 flex-col gap-2">
        {claims.length === 0 ? (
          <p className="rounded-xl border border-dashed border-outline-variant px-3 py-6 text-center text-xs text-on-surface-variant">
            No claims
          </p>
        ) : (
          claims.map((c) => <div key={c.id}>{render(c)}</div>)
        )}
      </div>
      {actionLabel && claims.length > 0 && (
        <p className="sr-only">
          {claims.length} claim{claims.length === 1 ? "" : "s"} ready for “{actionLabel}”.
        </p>
      )}
    </section>
  );
}

function ClaimCardShell({
  claim,
  children,
}: {
  claim: FinancePaymentItem;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-xl border border-outline-variant bg-surface-container-low p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <Avatar
          name={claim.employeeName || "Unknown"}
          size="sm"
          color="primary"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-on-surface">{claim.title}</p>
          <p className="truncate text-xs text-on-surface-variant">
            {claim.reference} · {claim.employeeName || "Unknown"}
          </p>
        </div>
        <StatusChip status={claim.status} size="sm" />
      </div>
      <p className="mt-2 text-base font-bold text-on-surface">
        {formatCurrency(claim.totalAmount, claim.currency)}
      </p>
      {children}
    </article>
  );
}

function ReadyCard({ claim, onAction }: { claim: FinancePaymentItem; onAction: () => void }) {
  return (
    <ClaimCardShell claim={claim}>
      <div className="mt-3">
        <Button size="sm" variant="tonal" iconRight={ChevronRight} fullWidth onClick={onAction}>
          Mark Processing
        </Button>
      </div>
    </ClaimCardShell>
  );
}

function ProcessingCard({ claim, onAction }: { claim: FinancePaymentItem; onAction: () => void }) {
  const method = claim.payment?.method;
  return (
    <ClaimCardShell claim={claim}>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-on-surface-variant">
        <span className="inline-flex items-center gap-1">
          {method === "payroll" ? (
            <Landmark className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          ) : (
            <CreditCard className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          )}
          {method === "payroll" ? "Payroll" : "Bank transfer"}
        </span>
        {claim.payment?.reference && <span>· {claim.payment.reference}</span>}
        {claim.payment?.processedAt && (
          <span>· started {formatDate(claim.payment.processedAt)}</span>
        )}
      </div>
      <div className="mt-3">
        <Button size="sm" icon={CheckCircle2} fullWidth onClick={onAction}>
          Mark Paid
        </Button>
      </div>
    </ClaimCardShell>
  );
}

function PaidCard({ claim }: { claim: FinancePaymentItem }) {
  return (
    <ClaimCardShell claim={claim}>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-on-surface-variant">
        {claim.payment?.reference && <span>· {claim.payment.reference}</span>}
        {claim.payment?.paidAt && <span>· paid {formatDate(claim.payment.paidAt)}</span>}
      </div>
    </ClaimCardShell>
  );
}

function PaymentDialog({
  claim,
  action,
  method,
  reference,
  errors,
  submitting,
  onMethodChange,
  onReferenceChange,
  onClose,
  onConfirm,
}: {
  claim: FinancePaymentItem | null;
  action: PendingAction | null;
  method: ClaimPayment["method"];
  reference: string;
  errors: { method?: string; reference?: string };
  submitting: boolean;
  onMethodChange: (v: string) => void;
  onReferenceChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const open = claim !== null && action !== null;
  const Icon = action === "paid" ? Wallet : CreditCard;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!submitting}
      title={action === "paid" ? "Confirm payment" : "Start processing"}
      description={claim ? `${claim.title} · ${claim.reference}` : undefined}
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={action === "paid" ? "filled" : "tonal"}
            icon={action === "paid" ? CheckCircle2 : undefined}
            loading={submitting}
            onClick={onConfirm}
          >
            {action === "paid" ? "Mark Paid" : "Move to Processing"}
          </Button>
        </>
      }
    >
      {claim && (
        <div className="space-y-4">
          <div className="rounded-xl bg-surface-container px-4 py-3 text-sm text-on-surface">
            <p className="font-semibold">{formatCurrency(claim.totalAmount, claim.currency)}</p>
            <p className="text-xs text-on-surface-variant">
              {claim.employeeName || "Unknown"} · {claim.reference}
            </p>
          </div>

          {action === "processing" ? (
            <>
              <Select
                label="Payment method"
                required
                options={METHOD_OPTIONS}
                value={method}
                onChange={onMethodChange}
                error={errors.method}
              />
              <TextField
                label="Bank / payroll reference"
                required
                placeholder="e.g. TRX-881234"
                value={reference}
                error={errors.reference}
                onChange={(e) => onReferenceChange(e.target.value)}
              />
              <p className="text-xs text-on-surface-variant">
                The method and reference are recorded with your name and timestamp, and the employee is notified the payment is in flight.
              </p>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-outline-variant px-4 py-3 text-sm">
                <p className="text-on-surface-variant">Payment method</p>
                <p className="font-medium text-on-surface">
                  {claim.payment?.method === "payroll" ? "Payroll deduction" : "Bank transfer"}
                </p>
                {claim.payment?.reference && (
                  <>
                    <p className="mt-2 text-on-surface-variant">Reference</p>
                    <p className="font-medium text-on-surface">{claim.payment.reference}</p>
                  </>
                )}
              </div>
              <p className="text-xs text-on-surface-variant">
                Confirming records the disbursement timestamp against your name and notifies the employee they have been paid.
              </p>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function BoardSkeleton() {
  return (
    <div
      aria-busy="true"
      role="status"
      aria-label="Loading payment board"
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
    >
      <Skeleton variant="list" lines={3} />
      <Skeleton variant="list" lines={3} />
      <Skeleton variant="list" lines={3} />
    </div>
  );
}

function BoardError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <Card className="border-error/40" role="alert">
      <div className="flex flex-col items-center gap-4 px-4 py-10 text-center sm:flex-row sm:text-left">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-on-surface">
            Couldn&rsquo;t load the payment board
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {message || "Something went wrong while loading payments."} Try again.
          </p>
        </div>
        <Button variant="outlined" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

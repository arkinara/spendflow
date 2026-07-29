"use client";

import * as React from "react";
import {
  Clock,
  CalendarClock,
  Loader,
  CheckCircle2,
  XCircle,
  ChevronRight,
  RefreshCw,
  Landmark,
  CreditCard,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { useSnackbar } from "@/components/ui/Snackbar";
import {
  payments as seedPayments,
  getUser,
  type Payment,
  type PaymentStatus,
} from "@/lib/mock/mock_data";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS: {
  status: PaymentStatus;
  label: string;
  icon: typeof Clock;
  accent: string;
}[] = [
  { status: "queued", label: "Queued", icon: Clock, accent: "text-on-surface-variant" },
  { status: "scheduled", label: "Scheduled", icon: CalendarClock, accent: "text-info" },
  { status: "processing", label: "Processing", icon: Loader, accent: "text-warning" },
  { status: "paid", label: "Paid", icon: CheckCircle2, accent: "text-success" },
  { status: "failed", label: "Failed", icon: XCircle, accent: "text-error" },
];

const NEXT_STATE: Partial<Record<PaymentStatus, PaymentStatus>> = {
  queued: "scheduled",
  scheduled: "processing",
  processing: "paid",
  failed: "queued",
};

const ADVANCE_LABEL: Partial<Record<PaymentStatus, string>> = {
  queued: "Schedule",
  scheduled: "Process",
  processing: "Mark paid",
  failed: "Retry",
};

export default function PaymentsBoard() {
  const { show } = useSnackbar();
  const [items, setItems] = React.useState<Payment[]>(seedPayments);

  function advance(payment: Payment) {
    const next = NEXT_STATE[payment.status];
    if (!next) return;
    setItems((list) =>
      list.map((p) => (p.id === payment.id ? { ...p, status: next } : p))
    );
    show(
      next === "paid"
        ? `${payment.claimReference} disbursed.`
        : next === "queued"
        ? `${payment.claimReference} re-queued for retry.`
        : `${payment.claimReference} moved to ${next}.`,
      { tone: "success" }
    );
  }

  const total = items.reduce((s, p) => s + p.amount, 0);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">Payment board</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              {items.length} payments · {formatCurrency(total)} in the ledger
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const colItems = items.filter((p) => p.status === col.status);
            const colTotal = colItems.reduce((s, p) => s + p.amount, 0);
            const Icon = col.icon;
            return (
              <section
                key={col.status}
                aria-label={col.label}
                className="flex flex-col rounded-2xl bg-surface-container p-3"
              >
                <header className="mb-3 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", col.accent)} strokeWidth={1.75} aria-hidden />
                    <h2 className="text-sm font-semibold text-on-surface">{col.label}</h2>
                    <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-surface-container-highest px-1.5 text-[11px] font-semibold text-on-surface-variant">
                      {colItems.length}
                    </span>
                  </div>
                </header>
                <p className="mb-2 px-1 text-xs text-on-surface-variant">
                  {formatCurrency(colTotal)}
                </p>
                <div className="flex flex-1 flex-col gap-2">
                  {colItems.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-outline-variant px-3 py-6 text-center text-xs text-on-surface-variant">
                      No payments
                    </p>
                  ) : (
                    colItems.map((p) => (
                      <PaymentCard key={p.id} payment={p} onAdvance={advance} />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function PaymentCard({
  payment,
  onAdvance,
}: {
  payment: Payment;
  onAdvance: (p: Payment) => void;
}) {
  const payee = getUser(payment.payeeId);
  const advanceLabel = ADVANCE_LABEL[payment.status];
  return (
    <article className="rounded-xl border border-outline-variant bg-surface-container-low p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <Avatar
          name={payee?.name ?? "Unknown"}
          size="sm"
          color={(payee?.avatarColor as never) ?? "primary"}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-on-surface">{payment.claimTitle}</p>
          <p className="truncate text-xs text-on-surface-variant">{payment.claimReference}</p>
        </div>
      </div>
      <p className="mt-2 text-base font-bold text-on-surface">{formatCurrency(payment.amount)}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-on-surface-variant">
        <span className="inline-flex items-center gap-1">
          {payment.method === "payroll" ? (
            <Landmark className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          ) : (
            <CreditCard className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          )}
          {payment.method === "payroll" ? "Payroll" : "Bank transfer"}
        </span>
        {payment.scheduledFor && <span>· due {formatDate(payment.scheduledFor)}</span>}
        {payment.paidAt && <span>· paid {formatDate(payment.paidAt)}</span>}
        {payment.bankReference && <span>· {payment.bankReference}</span>}
      </div>
      {advanceLabel && (
        <div className="mt-3">
          <Button
            size="sm"
            variant={payment.status === "failed" ? "outlined" : "tonal"}
            icon={payment.status === "failed" ? RefreshCw : undefined}
            iconRight={payment.status === "failed" ? undefined : ChevronRight}
            fullWidth
            onClick={() => onAdvance(payment)}
          >
            {advanceLabel}
          </Button>
        </div>
      )}
    </article>
  );
}

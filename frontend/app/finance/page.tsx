"use client";

import {
  AlertTriangle,
  CreditCard,
  Wallet,
  Clock,
  ArrowRight,
  CircleDollarSign,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { ListItem } from "@/components/ui/ListItem";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFinanceDashboard } from "@/lib/mock/useFinanceDashboard";
import type {
  FinanceDashboardData,
  FinancePaymentItem,
} from "@/lib/api/finance";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
} from "@/lib/format";

export default function FinanceDashboard() {
  const { state, retry } = useFinanceDashboard();

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Finance</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Resolve policy exceptions, disburse payments, and track the reimbursement lifecycle.
          </p>
        </div>

        {state.status === "loading" && <DashboardSkeleton />}
        {state.status === "error" && (
          <DashboardError message={state.message} onRetry={retry} />
        )}
        {state.status === "ready" && <DashboardBody data={state.data} />}
      </div>
    </AppShell>
  );
}

function DashboardBody({ data }: { data: FinanceDashboardData }) {
  return (
    <>
      {data.openExceptionCount > 0 && (
        <Card className="border-error/40 bg-error-container/40">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error/15 text-error">
              <AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-on-surface">
                {data.openExceptionCount} open exception
                {data.openExceptionCount === 1 ? "" : "s"} need a finance decision
              </p>
              <p className="text-sm text-on-surface-variant">
                Flagged claims cannot be paid until you override or return them.
              </p>
            </div>
            <Button href="/finance/exceptions" variant="tonal" size="sm" iconRight={ArrowRight}>
              Resolve
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Open exceptions"
          value={String(data.openExceptionCount)}
          icon={AlertTriangle}
          hint="Awaiting a decision"
        />
        <MetricCard
          label="Ready to pay"
          value={formatCurrencyCompact(data.readyToPayAmount)}
          icon={Clock}
          hint={`${data.readyToPayCount} approved claim${data.readyToPayCount === 1 ? "" : "s"}`}
        />
        <MetricCard
          label="In progress"
          value={String(data.inFlightCount)}
          icon={CreditCard}
          hint="Payments processing"
        />
        <MetricCard
          label="Paid to date"
          value={formatCurrencyCompact(data.paidAmount)}
          icon={Wallet}
          hint={`${data.paidCount} reimbursed`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickAction
          href="/finance/exceptions"
          icon={AlertTriangle}
          label="Exception queue"
          hint={`${data.openExceptionCount} open`}
        />
        <QuickAction
          href="/finance/payments"
          icon={CreditCard}
          label="Payment board"
          hint={`${data.readyToPayCount + data.inFlightCount} to action`}
        />
        <QuickAction
          href="/finance/policies"
          icon={ShieldCheck}
          label="Policy admin"
          hint="Rules & routing"
        />
        <QuickAction
          href="/reports"
          icon={Wallet}
          label="Reports"
          hint="Spend analysis"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Approved & processing"
          subtitle={`${data.readyToPayCount + data.inFlightCount} claim${
            data.readyToPayCount + data.inFlightCount === 1 ? "" : "s"
          } awaiting disbursement`}
          action={
            <Button href="/finance/payments" variant="text" size="sm" iconRight={ArrowRight}>
              Payments
            </Button>
          }
          padded={false}
        >
          {data.readyToPay.length === 0 && data.inFlight.length === 0 ? (
            <EmptyState
              icon={CircleDollarSign}
              title="Nothing to pay"
              body="Approved claims will appear here for disbursement."
              variant="compact"
            />
          ) : (
            <ul className="divide-y divide-outline-variant px-2 pb-2">
              {data.inFlight.map((c) => (
                <LifecycleRow key={c.id} claim={c} />
              ))}
              {data.readyToPay.slice(0, Math.max(0, 6 - data.inFlight.length)).map((c) => (
                <LifecycleRow key={c.id} claim={c} />
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent payments"
          subtitle={`${data.paidCount} paid claim${data.paidCount === 1 ? "" : "s"}`}
          action={
            <Button href="/finance/payments" variant="text" size="sm" iconRight={ArrowRight}>
              Board
            </Button>
          }
          padded={false}
        >
          {data.recentPaid.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No payments yet"
              body="Disbursed claims will appear here."
              variant="compact"
            />
          ) : (
            <ul className="divide-y divide-outline-variant px-2 pb-2">
              {data.recentPaid.slice(0, 5).map((c) => (
                <PaidRow key={c.id} claim={c} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: typeof AlertTriangle;
  label: string;
  hint: string;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-low p-4 shadow-sm transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-on-surface">{label}</p>
        <p className="truncate text-xs text-on-surface-variant">{hint}</p>
      </div>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5"
        strokeWidth={1.75}
        aria-hidden
      />
    </a>
  );
}

function LifecycleRow({ claim }: { claim: FinancePaymentItem }) {
  return (
    <li>
      <ListItem
        href={`/claims/${claim.id}/audit`}
        title={claim.title}
        subtitle={`${claim.reference} · ${claim.employeeName || "Unknown"}`}
        meta={
          <p className="text-sm font-semibold text-on-surface">
            {formatCurrency(claim.totalAmount)}
          </p>
        }
        trailing={<StatusChip status={claim.status} size="sm" />}
      />
    </li>
  );
}

function PaidRow({ claim }: { claim: FinancePaymentItem }) {
  const paidAt = claim.payment?.paidAt;
  return (
    <li>
      <ListItem
        href={`/claims/${claim.id}/audit`}
        title={claim.title}
        subtitle={`${claim.reference} · ${claim.employeeName || "Unknown"}${
          paidAt ? ` · paid ${formatDate(paidAt)}` : ""
        }${claim.payment?.reference ? ` · ${claim.payment.reference}` : ""}`}
        meta={
          <p className="text-sm font-semibold text-on-surface">
            {formatCurrency(claim.totalAmount)}
          </p>
        }
        trailing={<StatusChip status={claim.status} size="sm" />}
      />
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div
      aria-busy="true"
      role="status"
      aria-label="Loading finance dashboard"
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton variant="block" />
        <Skeleton variant="block" />
        <Skeleton variant="block" />
        <Skeleton variant="block" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton variant="list" lines={4} />
        <Skeleton variant="list" lines={4} />
      </div>
    </div>
  );
}

function DashboardError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <Card className="border-error/40" role="alert">
      <div className="flex flex-col items-center gap-4 px-4 py-10 text-center sm:flex-row sm:text-left">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-on-surface">
            Couldn&rsquo;t load the finance dashboard
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {message || "Something went wrong while loading finance data."} Try again.
          </p>
        </div>
        <Button variant="outlined" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

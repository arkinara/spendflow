"use client";

import {
  AlertTriangle,
  CreditCard,
  Wallet,
  Clock,
  ArrowRight,
  CircleDollarSign,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { ListItem } from "@/components/ui/ListItem";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import {
  claims,
  payments,
  openExceptions,
  computeClaimTotal,
  getUser,
  type Claim,
  type Payment,
} from "@/lib/mock/mock_data";
import { formatCurrency, formatCurrencyCompact, formatDate } from "@/lib/format";

export default function FinanceDashboard() {
  const exceptions = openExceptions();
  const queued = payments.filter((p) => ["queued", "scheduled"].includes(p.status));
  const inFlight = payments.filter((p) => p.status === "processing");
  const paid = payments.filter((p) => p.status === "paid");
  const failed = payments.filter((p) => p.status === "failed");

  const readyToPay = claims.filter((c) => c.status === "approved");
  const queuedAmount = queued.reduce((s, p) => s + p.amount, 0);
  const paidAmount = paid.reduce((s, p) => s + p.amount, 0);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Finance</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Resolve exceptions, disburse payments, and keep policy in check.
          </p>
        </div>

        {(exceptions.length > 0 || failed.length > 0) && (
          <Card className="border-error/40 bg-error-container/40">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error/15 text-error">
                <AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-on-surface">
                  {exceptions.length} open exception{exceptions.length === 1 ? "" : "s"}
                  {failed.length > 0 ? ` · ${failed.length} failed payment${failed.length === 1 ? "" : "s"}` : ""}
                </p>
                <p className="text-sm text-on-surface-variant">
                  These items need finance attention before claims can be paid.
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
            value={String(exceptions.length)}
            icon={AlertTriangle}
            hint="Need resolution"
          />
          <MetricCard
            label="Queued payments"
            value={formatCurrencyCompact(queuedAmount)}
            icon={Clock}
            hint={`${queued.length} awaiting disbursement`}
          />
          <MetricCard
            label="In progress"
            value={String(inFlight.length)}
            icon={CreditCard}
            hint="Transfers processing"
          />
          <MetricCard
            label="Paid to date"
            value={formatCurrencyCompact(paidAmount)}
            icon={Wallet}
            delta={{ value: "+8.2%", direction: "up", positive: true }}
            hint="vs last period"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card
            title="Ready to pay"
            subtitle={`${readyToPay.length} approved claim${readyToPay.length === 1 ? "" : "s"}`}
            action={
              <Button href="/finance/payments" variant="text" size="sm" iconRight={ArrowRight}>
                Payments
              </Button>
            }
            padded={false}
          >
            {readyToPay.length === 0 ? (
              <EmptyState
                icon={CircleDollarSign}
                title="Nothing to pay"
                body="Approved claims will appear here for disbursement."
                variant="compact"
              />
            ) : (
              <ul className="divide-y divide-outline-variant px-2 pb-2">
                {readyToPay.map((c) => (
                  <ReadyRow key={c.id} claim={c} />
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Recent payments"
            subtitle={`${payments.length} in the ledger`}
            action={
              <Button href="/finance/payments" variant="text" size="sm" iconRight={ArrowRight}>
                Board
              </Button>
            }
            padded={false}
          >
            <ul className="divide-y divide-outline-variant px-2 pb-2">
              {payments.slice(0, 5).map((p) => (
                <PaymentRow key={p.id} payment={p} />
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function ReadyRow({ claim }: { claim: Claim }) {
  const employee = getUser(claim.employeeId);
  return (
    <li>
      <ListItem
        href={`/claims/${claim.id}/audit`}
        title={claim.title}
        subtitle={`${claim.reference} · ${employee?.name ?? "Unknown"}`}
        meta={
          <p className="text-sm font-semibold text-on-surface">
            {formatCurrency(computeClaimTotal(claim))}
          </p>
        }
        trailing={<StatusChip status={claim.status} size="sm" />}
      />
    </li>
  );
}

function PaymentRow({ payment }: { payment: Payment }) {
  const payee = getUser(payment.payeeId);
  return (
    <li>
      <ListItem
        title={payment.claimTitle}
        subtitle={`${payment.claimReference} · ${payee?.name ?? "Unknown"}${
          payment.scheduledFor ? ` · due ${formatDate(payment.scheduledFor)}` : ""
        }`}
        meta={
          <p className="text-sm font-semibold text-on-surface">
            {formatCurrency(payment.amount)}
          </p>
        }
        trailing={<StatusChip paymentStatus={payment.status} size="sm" />}
      />
    </li>
  );
}

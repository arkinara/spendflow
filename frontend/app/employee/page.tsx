"use client";

import * as React from "react";
import Link from "next/link";
import {
  Plus,
  Wallet,
  Hourglass,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  CircleDashed,
  Loader,
  XCircle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusChip } from "@/components/ui/StatusChip";
import { ListItem } from "@/components/ui/ListItem";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useEmployeeDashboard } from "@/lib/mock/useEmployeeDashboard";
import {
  type EmployeeDashboardData,
  type StatusGroup,
} from "@/lib/mock/dashboard";
import type { ClaimStatus } from "@/lib/mock/mock_data";
import { formatCurrency, formatCurrencyCompact, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "warning" | "error" | "success" | "info";

interface StatusMeta {
  icon: LucideIcon;
  tone: Tone;
  hint: string;
}

const STATUS_META: Record<ClaimStatus, StatusMeta> = {
  draft: { icon: CircleDashed, tone: "neutral", hint: "Not yet submitted" },
  pending: { icon: Hourglass, tone: "warning", hint: "With your manager" },
  action_required: { icon: AlertTriangle, tone: "error", hint: "Returned to you" },
  approved: { icon: CheckCircle2, tone: "success", hint: "Approved, awaiting payment" },
  processing: { icon: Loader, tone: "info", hint: "Payment in flight" },
  paid: { icon: Wallet, tone: "success", hint: "Reimbursed" },
  rejected: { icon: XCircle, tone: "neutral", hint: "Not reimbursable" },
};

const CARD_TONE: Record<Tone, string> = {
  neutral: "border-outline-variant bg-surface-container-low",
  warning: "border-warning/50 bg-warning-container/50",
  error: "border-error/50 bg-error-container/60",
  success: "border-success/40 bg-success-container/40",
  info: "border-info/40 bg-info-container/40",
};

const ICON_TONE: Record<Tone, string> = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/15 text-error",
  success: "bg-success/15 text-success",
  info: "bg-info/15 text-info",
};

export default function EmployeeDashboard() {
  const { user } = useRole();
  const { state, retry } = useEmployeeDashboard(user.id);

  const newClaimAction = (
    <Button href="/employee/claims/new" icon={Plus} size="sm">
      New claim
    </Button>
  );

  return (
    <AppShell action={newClaimAction}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">
              Hi {user.name.split(" ")[0]} 👋
            </h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              Here is where your travel expenses stand today.
            </p>
          </div>
          <Button href="/employee/claims/new" icon={Plus} className="sm:hidden" fullWidth>
            New claim
          </Button>
        </header>

        {state.status === "loading" && <DashboardSkeleton />}
        {state.status === "error" && (
          <DashboardError message={state.message} onRetry={retry} />
        )}
        {state.status === "ready" && (
          <DashboardContent
            data={state.data}
            employeeName={user.name.split(" ")[0]}
          />
        )}
      </div>
    </AppShell>
  );
}

function DashboardContent({
  data,
  employeeName,
}: {
  data: EmployeeDashboardData;
  employeeName: string;
}) {
  if (!data.hasAnyClaims) {
    return <EmptyDashboardHero employeeName={employeeName} />;
  }

  const topActionRequired = data.actionRequired[0];

  return (
    <>
      {topActionRequired && (
        <Card className="border-error/40 bg-error-container/40" role="alert">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error/15 text-error">
              <AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-on-surface">
                {data.actionRequired.length} claim
                {data.actionRequired.length > 1 ? "s" : ""} need your attention
              </p>
              <p className="text-sm text-on-surface-variant">
                A reviewer returned {topActionRequired.reference}. Update it and resubmit to keep it moving.
              </p>
            </div>
            <Button
              href={`/employee/claims/${topActionRequired.id}`}
              variant="tonal"
              size="sm"
              iconRight={ArrowRight}
            >
              Review
            </Button>
          </div>
        </Card>
      )}

      <section aria-label="Claim status summary">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-on-surface-variant">
          Claim status
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.primaryGroups.map((g) => (
            <StatusCard key={g.status} group={g} />
          ))}
        </div>
        {data.secondaryGroups.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.secondaryGroups.map((g) => (
              <StatusCard key={g.status} group={g} />
            ))}
          </div>
        )}
      </section>

      <RecentlyPaidSection
        entries={data.recentlyPaid}
        totalReimbursed={data.totalReimbursed}
      />
    </>
  );
}

function StatusCard({ group }: { group: StatusGroup }) {
  const meta = STATUS_META[group.status];
  const Icon = meta.icon;
  const isError = meta.tone === "error";
  const amountLabel =
    group.count > 0 ? formatCurrencyCompact(group.amount) : "—";

  return (
    <Link
      href={`/employee/claims?status=${group.status}`}
      aria-label={`${group.count} ${group.label} claim${group.count === 1 ? "" : "s"}, ${group.count > 0 ? `${amountLabel} total` : "none"}. ${meta.hint}. View these claims.`}
      className={cn(
        "group flex flex-col gap-3 rounded-2xl border p-5 shadow-sm transition-all duration-200 ease-m3",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        CARD_TONE[meta.tone],
        isError && "ring-1 ring-error/30"
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-full",
            ICON_TONE[meta.tone]
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        {isError && group.count > 0 && (
          <span className="inline-flex items-center rounded-full bg-error px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-error-container">
            Needs action
          </span>
        )}
      </div>
      <div>
        <p className="text-3xl font-bold tracking-tight text-on-surface">{group.count}</p>
        <p className="mt-0.5 text-sm font-medium text-on-surface">{group.label}</p>
        <p className="text-xs text-on-surface-variant">
          {group.count > 0 ? `${amountLabel} total · ${meta.hint}` : meta.hint}
        </p>
      </div>
      <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        View claims
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </span>
    </Link>
  );
}

function RecentlyPaidSection({
  entries,
  totalReimbursed,
}: {
  entries: { claim: { id: string; reference: string; title: string }; amount: number; paidAt: string }[];
  totalReimbursed: number;
}) {
  return (
    <section aria-label="Recently paid claims" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-on-surface">Recently paid</h2>
          <p className="text-sm text-on-surface-variant">
            {entries.length > 0
              ? `${entries.length} reimbursement${entries.length === 1 ? "" : "s"} · ${formatCurrency(totalReimbursed)} total`
              : "Your reimbursements will appear here."}
          </p>
        </div>
        <Link
          href="/employee/claims?status=paid"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View all paid
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </Link>
      </div>

      <Card padded={false}>
        {entries.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No reimbursements yet"
            body="Once an approved claim is paid out, it will show up here with the amount and date."
            variant="compact"
          />
        ) : (
          <ul className="divide-y divide-outline-variant px-2 pb-2">
            {entries.map(({ claim, amount, paidAt }) => (
              <li key={claim.id}>
                <ListItem
                  href={`/employee/claims/${claim.id}`}
                  title={claim.title}
                  subtitle={`${claim.reference} · Paid ${formatDate(paidAt)}`}
                  meta={
                    <p className="text-sm font-semibold text-on-surface">
                      {formatCurrency(amount)}
                    </p>
                  }
                  trailing={<StatusChip status="paid" size="sm" />}
                  showChevron
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function EmptyDashboardHero({ employeeName }: { employeeName: string }) {
  return (
    <section aria-label="Get started" className="space-y-6">
      <Card className="bg-surface-container-low">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Wallet className="h-7 w-7" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-on-surface">
              Welcome to SpendFlow, {employeeName}
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              You haven&rsquo;t filed any expense claims yet. Most employees submit their first
              claim in under two minutes — start one now and attach your receipts as you go.
            </p>
          </div>
          <Button href="/employee/claims/new" icon={Plus} size="lg">
            New claim
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <EmptyState
          icon={CircleDashed}
          title="Nothing to track yet"
          body="Your claim status summary and recent reimbursements will appear here once you submit a claim."
          action={
            <Button href="/employee/claims/new" icon={Plus}>
              Start your first claim
            </Button>
          }
        />
      </Card>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" role="status" aria-label="Loading dashboard" className="space-y-6">
      <div>
        <Skeleton className="mb-3 h-4 w-32" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="card" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton variant="list" lines={3} />
      </div>
    </div>
  );
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-error/40" role="alert">
      <div className="flex flex-col items-center gap-4 px-4 py-10 text-center sm:flex-row sm:text-left">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-on-surface">
            Couldn&rsquo;t load your dashboard
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {message || "Something went wrong while loading your claims."} Try again — your data is safe.
          </p>
        </div>
        <Button variant="outlined" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

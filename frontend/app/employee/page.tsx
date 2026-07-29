"use client";

import Link from "next/link";
import {
  Plus,
  Wallet,
  Hourglass,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { ListItem } from "@/components/ui/ListItem";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  claimsForEmployee,
  computeClaimTotal,
  getCategory,
  type Claim,
} from "@/lib/mock/mock_data";
import { formatCurrency, formatCurrencyCompact, formatRelativeTime } from "@/lib/format";

export default function EmployeeDashboard() {
  const { user } = useRole();
  const claims = claimsForEmployee(user.id).sort((a, b) =>
    (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt)
  );

  const pending = claims.filter((c) => c.status === "pending");
  const actionRequired = claims.filter((c) => c.status === "action_required");
  const reimbursed = claims.filter((c) => c.status === "paid");
  const totalReimbursed = reimbursed.reduce((s, c) => s + computeClaimTotal(c), 0);
  const inFlight = claims
    .filter((c) => ["pending", "approved", "processing"].includes(c.status))
    .reduce((s, c) => s + computeClaimTotal(c), 0);

  return (
    <AppShell
      action={
        <Button href="/employee/claims/new" icon={Plus} size="sm">
          New claim
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
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
        </div>

        {actionRequired.length > 0 && (
          <Card className="border-error/40 bg-error-container/40">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error/15 text-error">
                <AlertTriangle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-on-surface">
                  {actionRequired.length} claim{actionRequired.length > 1 ? "s" : ""} need your attention
                </p>
                <p className="text-sm text-on-surface-variant">
                  A reviewer returned a claim. Update it and resubmit to keep it moving.
                </p>
              </div>
              <Button
                href={`/employee/claims/${actionRequired[0].id}`}
                variant="tonal"
                size="sm"
                iconRight={ArrowRight}
              >
                Review
              </Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="In flight"
            value={formatCurrencyCompact(inFlight)}
            icon={Wallet}
            hint="Awaiting approval or payment"
          />
          <MetricCard label="Pending approval" value={String(pending.length)} icon={Hourglass} hint="With your manager" />
          <MetricCard
            label="Action required"
            value={String(actionRequired.length)}
            icon={AlertTriangle}
            hint="Returned to you"
          />
          <MetricCard
            label="Reimbursed"
            value={formatCurrencyCompact(totalReimbursed)}
            icon={CheckCircle2}
            hint={`${reimbursed.length} paid claims`}
          />
        </div>

        <Card
          title="Recent claims"
          action={
            <Link
              href="/employee/claims"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View all
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </Link>
          }
          padded={false}
        >
          {claims.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No claims yet"
              body="Create your first travel expense claim and attach the receipts."
              action={
                <Button href="/employee/claims/new" icon={Plus}>
                  New claim
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-outline-variant px-2 pb-2">
              {claims.slice(0, 5).map((c) => (
                <RecentClaimRow key={c.id} claim={c} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function RecentClaimRow({ claim }: { claim: Claim }) {
  const total = computeClaimTotal(claim);
  const cats = Array.from(new Set(claim.lineItems.map((l) => getCategory(l.categoryId)?.name))).filter(
    Boolean
  );
  return (
    <li>
      <ListItem
        href={`/employee/claims/${claim.id}`}
        title={claim.title}
        subtitle={`${claim.reference} · ${cats.slice(0, 3).join(", ")}`}
        meta={
          <div className="space-y-1">
            <p className="text-sm font-semibold text-on-surface">{formatCurrency(total)}</p>
            <p>{formatRelativeTime(claim.submittedAt ?? claim.createdAt)}</p>
          </div>
        }
        trailing={<StatusChip status={claim.status} />}
        showChevron
      />
    </li>
  );
}

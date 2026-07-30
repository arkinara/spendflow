"use client";

import * as React from "react";
import {
  Inbox,
  Hourglass,
  ClipboardCheck,
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { ListItem } from "@/components/ui/ListItem";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useApproverInbox } from "@/lib/mock/useApproverInbox";
import {
  computeClaimTotal,
  getUser,
  type Claim,
} from "@/lib/mock/mock_data";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatRelativeTime,
} from "@/lib/format";

type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

const SORT_OPTIONS = [
  { value: "date_desc" as const, label: "Newest first" },
  { value: "date_asc" as const, label: "Oldest first" },
  { value: "amount_desc" as const, label: "Amount (high → low)" },
  { value: "amount_asc" as const, label: "Amount (low → high)" },
];

/** A claim is "policy-flagged" if it carries an open exception. */
function hasOpenPolicyFlag(claim: Claim): boolean {
  return !!claim.exception && claim.exception.status === "open";
}

function sortClaims(claims: Claim[], key: SortKey): Claim[] {
  const byDate = (c: Claim) => c.submittedAt ?? c.createdAt;
  const byAmount = (c: Claim) => computeClaimTotal(c);
  switch (key) {
    case "date_asc":
      return [...claims].sort((a, b) => byDate(a).localeCompare(byDate(b)));
    case "amount_desc":
      return [...claims].sort((a, b) => byAmount(b) - byAmount(a));
    case "amount_asc":
      return [...claims].sort((a, b) => byAmount(a) - byAmount(b));
    case "date_desc":
    default:
      return [...claims].sort((a, b) => byDate(b).localeCompare(byDate(a)));
  }
}

export default function ApproverDashboard() {
  const { user } = useRole();
  const { state, retry } = useApproverInbox(user.id);
  const [sort, setSort] = React.useState<SortKey>("date_desc");

  const sorted = React.useMemo(
    () => (state.status === "ready" ? sortClaims(state.claims, sort) : []),
    [state, sort]
  );

  const pendingValue =
    state.status === "ready"
      ? state.claims.reduce((s, c) => s + computeClaimTotal(c), 0)
      : 0;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">
            Approvals
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Review and decide on claims submitted by your team.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Awaiting your review"
            value={state.status === "ready" ? String(state.claims.length) : "—"}
            icon={Inbox}
            hint="In your inbox"
          />
          <MetricCard
            label="Pending value"
            value={formatCurrencyCompact(pendingValue)}
            icon={Hourglass}
            hint="Across pending claims"
          />
        </div>

        {state.status === "loading" && <InboxSkeleton />}
        {state.status === "error" && (
          <InboxError message={state.message} onRetry={retry} />
        )}
        {state.status === "ready" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-on-surface-variant">
                {state.claims.length === 0
                  ? "No claims awaiting a decision."
                  : `${state.claims.length} claim${
                      state.claims.length === 1 ? "" : "s"
                    } awaiting a decision`}
              </p>
              <div className="w-full sm:w-64">
                <Select
                  value={sort}
                  onChange={(v) => setSort(v as SortKey)}
                  options={SORT_OPTIONS}
                />
              </div>
            </div>

            <Card
              title="Inbox"
              subtitle={
                sorted.length === 0
                  ? undefined
                  : `${sorted.length} awaiting a decision`
              }
              padded={false}
            >
              {sorted.length === 0 ? (
                <EmptyState
                  icon={ClipboardCheck}
                  title="Inbox zero"
                  body="Every claim submitted to you has been reviewed. Nice work."
                />
              ) : (
                <ul className="divide-y divide-outline-variant px-2 pb-2 pt-1">
                  {sorted.map((c) => (
                    <InboxRow key={c.id} claim={c} />
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function InboxRow({ claim }: { claim: Claim }) {
  const employee = getUser(claim.employeeId);
  const total = computeClaimTotal(claim);
  const flagged = hasOpenPolicyFlag(claim);
  return (
    <li>
      <ListItem
        href={`/approver/claims/${claim.id}`}
        leading={
          <Avatar
            name={employee?.name ?? "Unknown"}
            color={(employee?.avatarColor as never) ?? "primary"}
          />
        }
        title={
          <span className="inline-flex items-center gap-1.5">
            {claim.title}
            {flagged && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-error-container px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-error-container-foreground"
                title={claim.exception?.message}
              >
                <ShieldAlert className="h-3 w-3" strokeWidth={2} aria-hidden />
                Policy flag
              </span>
            )}
          </span>
        }
        subtitle={`${employee?.name ?? "Unknown"} · ${claim.reference} · ${
          claim.lineItems.length
        } items`}
        meta={
          <div className="space-y-1">
            <p className="text-sm font-semibold text-on-surface">
              {formatCurrency(total, claim.currency)}
            </p>
            <p>{formatRelativeTime(claim.submittedAt ?? claim.createdAt)}</p>
          </div>
        }
        trailing={<StatusChip status={claim.status} size="sm" />}
        showChevron
      />
    </li>
  );
}

function InboxSkeleton() {
  return (
    <div
      aria-busy="true"
      role="status"
      aria-label="Loading inbox"
      className="space-y-3"
    >
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton variant="list" lines={4} />
    </div>
  );
}

function InboxError({
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
            Couldn&rsquo;t load your inbox
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {message || "Something went wrong while loading your inbox."} Try
            again.
          </p>
        </div>
        <Button variant="outlined" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

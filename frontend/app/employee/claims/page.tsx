"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  ReceiptText,
  FilterX,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/TextField";
import { DateField } from "@/components/ui/DateField";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { StatusChip } from "@/components/ui/StatusChip";
import { ListItem } from "@/components/ui/ListItem";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useEmployeeClaims } from "@/lib/hooks/useEmployeeClaims";
import {
  computeClaimTotal,
} from "@/lib/seed-data";
import type { Claim, ClaimStatus } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format";

type Filter = "all" | ClaimStatus;

const VALID_STATUSES: ClaimStatus[] = [
  "draft",
  "pending",
  "action_required",
  "approved",
  "processing",
  "paid",
  "rejected",
];

/**
 * Pagination page size.
 *
 * The mock fixture set is small (a handful of claims per employee), but the PRD
 * requires the list to render smoothly with 100+ claims. We use classic numbered
 * pagination (rather than virtualised scrolling) because it is the simplest
 * approach that bounds DOM size for arbitrarily large mock sets, is fully
 * keyboard-operable, and needs no extra rendering dependency. A virtualised list
 * would be over-engineering for Phase 1 mock data.
 */
const PAGE_SIZE = 10;

function resolveInitialFilter(statusParam: string | null): Filter {
  if (statusParam && (VALID_STATUSES as string[]).includes(statusParam)) {
    return statusParam as ClaimStatus;
  }
  return "all";
}

/**
 * Suspense boundary is required because this page reads `useSearchParams` to
 * support deep links from the dashboard status cards (e.g. `?status=pending`).
 */
export default function ClaimHistoryPage() {
  return (
    <React.Suspense fallback={null}>
      <ClaimHistoryInner />
    </React.Suspense>
  );
}

function ClaimHistoryInner() {
  const { user } = useRole();
  const searchParams = useSearchParams();
  const { state, retry } = useEmployeeClaims(user.id);

  const [filter, setFilter] = React.useState<Filter>(() =>
    resolveInitialFilter(searchParams.get("status"))
  );
  const [query, setQuery] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [page, setPage] = React.useState(1);

  const all = React.useMemo<Claim[]>(() => {
    const list = state.status === "ready" ? state.claims : [];
    return [...list].sort((a, b) =>
      (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt)
    );
  }, [state]);

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const claim of all) c[claim.status] = (c[claim.status] ?? 0) + 1;
    return c;
  }, [all]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      const matchStatus = filter === "all" || c.status === filter;
      const matchQuery =
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.reference.toLowerCase().includes(q) ||
        (c.destination ?? "").toLowerCase().includes(q);
      if (!matchStatus || !matchQuery) return false;

      const claimDate = (c.submittedAt ?? c.createdAt).slice(0, 10);
      if (dateFrom && claimDate < dateFrom) return false;
      if (dateTo && claimDate > dateTo) return false;
      return true;
    });
  }, [all, filter, query, dateFrom, dateTo]);

  // Reset to the first page whenever the active filter set changes so the user
  // never lands on an out-of-range page after narrowing results.
  React.useEffect(() => {
    setPage(1);
  }, [filter, query, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const hasActiveFilters = filter !== "all" || !!query || !!dateFrom || !!dateTo;

  const clearFilters = React.useCallback(() => {
    setFilter("all");
    setQuery("");
    setDateFrom("");
    setDateTo("");
  }, []);

  const options: { value: Filter; label: string; count?: number }[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "draft", label: "Draft", count: counts.draft },
    { value: "pending", label: "Pending", count: counts.pending },
    { value: "action_required", label: "Action Required", count: counts.action_required },
    { value: "approved", label: "Approved", count: counts.approved },
    { value: "processing", label: "Processing", count: counts.processing },
    { value: "paid", label: "Paid", count: counts.paid },
    { value: "rejected", label: "Rejected", count: counts.rejected },
  ];

  return (
    <AppShell
      action={
        <Button href="/employee/claims/new" icon={Plus} size="sm">
          New claim
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">My claims</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              {all.length} claims · {formatCurrency(all.reduce((s, c) => s + computeClaimTotal(c), 0))} total
            </p>
          </div>
        </div>

        {state.status === "loading" && <ClaimListSkeleton />}
        {state.status === "error" && (
          <ClaimListError message={state.message} onRetry={retry} />
        )}
        {state.status === "ready" && (
          <>
            <div className="space-y-3">
              <TextField
                iconLeft={Search}
                placeholder="Search by title, reference or destination…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search claims"
              />
              <div className="overflow-x-auto pb-1">
                <SegmentedTabs
                  options={options}
                  value={filter}
                  onChange={setFilter}
                  ariaLabel="Filter claims by status"
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <DateField
                  label="From"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="Filter claims from this date"
                  containerClassName="w-40"
                />
                <DateField
                  label="To"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="Filter claims up to this date"
                  containerClassName="w-40"
                />
                {hasActiveFilters && (
                  <Button
                    variant="text"
                    size="sm"
                    icon={FilterX}
                    onClick={clearFilters}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </div>

            {/* ARIA live region: announces result-count changes to assistive tech. */}
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {filtered.length === 0
                ? "No claims match your filters."
                : `Showing ${pageItems.length} of ${filtered.length} claims.`}
            </p>

            <Card padded={false}>
              {filtered.length === 0 ? (
                hasActiveFilters ? (
                  <EmptyState
                    icon={FilterX}
                    title="No matching claims"
                    body="No claims match your search, status or date filters. Try clearing them."
                    action={
                      <Button variant="outlined" onClick={clearFilters}>
                        Clear all filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={ReceiptText}
                    title="No claims yet"
                    body="Your submitted and draft claims will show up here."
                    action={
                      <Button href="/employee/claims/new" icon={Plus}>
                        New claim
                      </Button>
                    }
                  />
                )
              ) : (
                <ul className="divide-y divide-outline-variant px-2 py-2">
                  {pageItems.map((c) => (
                    <ClaimRow key={c.id} claim={c} />
                  ))}
                </ul>
              )}
            </Card>

            {totalPages > 1 && (
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPage={setPage}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <li>
      <ListItem
        href={`/employee/claims/${claim.id}`}
        title={claim.title}
        subtitle={`${claim.reference} · ${claim.destination ?? "—"} · ${claim.lineItems.length} items`}
        meta={
          <div className="space-y-1">
            <p className="text-sm font-semibold text-on-surface">
              {formatCurrency(computeClaimTotal(claim))}
            </p>
            <p>{formatDate(claim.submittedAt ?? claim.createdAt)}</p>
          </div>
        }
        trailing={<StatusChip status={claim.status} />}
        showChevron
      />
    </li>
  );
}

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  return (
    <nav aria-label="Claim pages" className="flex items-center justify-center gap-2">
      <Button
        variant="outlined"
        size="sm"
        icon={ChevronLeft}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="Previous page"
      >
        Prev
      </Button>
      <span className="px-2 text-sm font-medium text-on-surface-variant" aria-current="page">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outlined"
        size="sm"
        iconRight={ChevronRight}
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label="Next page"
      >
        Next
      </Button>
    </nav>
  );
}

function ClaimListSkeleton() {
  return (
    <div aria-busy="true" role="status" aria-label="Loading claims" className="space-y-3">
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton variant="list" lines={5} />
    </div>
  );
}

function ClaimListError({
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
            Couldn&rsquo;t load your claims
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

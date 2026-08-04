"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  BarChart3,
  ReceiptText,
  FilterX,
  AlertTriangle,
  RefreshCw,
  ShieldX,
  SlidersHorizontal,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSnackbar } from "@/components/ui/Snackbar";
import { cn } from "@/lib/utils";
import { DEPARTMENTS, categories, type ClaimStatus } from "@/lib/mock/mock_data";
import { formatCurrency, formatDate } from "@/lib/format";
import { useReportClaims } from "@/lib/mock/useReportClaims";
import {
  REPORT_STATUSES,
  filtersFromSearchParams,
  filtersToSearchParams,
  hasActiveFilters,
  validateDateRange,
  type ReportFilters,
} from "@/lib/mock/reportFilter";
import {
  exportCsv,
  downloadBlob,
  reportCsvFilename,
  ReportingApiError,
  type ReportRow,
} from "@/lib/api/reporting";

/* --------------------------------------------------------------- chips --- */

interface ChipOption {
  value: string;
  label: string;
}

/**
 * Accessible multi-select chip group. Each chip is a real <button> with
 * aria-pressed so the state is announced to screen readers; tab + Enter/Space
 * toggles (no custom key handling needed). The group is wrapped in a
 * role="group" with an aria-labelledby legend.
 */
function FilterChipGroup({
  legendId,
  legend,
  options,
  selected,
  onToggle,
  onClear,
}: {
  legendId: string;
  legend: string;
  options: ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div role="group" aria-labelledby={legendId} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span id={legendId} className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
            {legend}
          </span>
          {selected.length > 0 && (
            <span className="text-xs text-on-surface-variant/70">({selected.length})</span>
          )}
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(opt.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                active
                  ? "border-primary bg-primary text-primary-foreground hover:brightness-110"
                  : "border-outline bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- page shell --- */

/**
 * Reports reads `useSearchParams` (for URL-state restoration) which requires
 * a Suspense boundary in Next 14 app router.
 */
export default function ReportsPage() {
  return (
    <React.Suspense fallback={<ReportsSkeleton />}>
      <ReportsPageInner />
    </React.Suspense>
  );
}

const STATUS_OPTIONS: ChipOption[] = REPORT_STATUSES.map((s) => ({
  value: s,
  label: statusLabel(s),
}));

function statusLabel(s: ClaimStatus): string {
  switch (s) {
    case "draft": return "Draft";
    case "pending": return "Pending Approval";
    case "action_required": return "Action Required";
    case "approved": return "Approved";
    case "processing": return "Processing";
    case "paid": return "Paid";
    case "rejected": return "Rejected";
  }
}

function ReportsPageInner() {
  const { show } = useSnackbar();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ---------------------------------------------------------------- filters
  // Initialise filter state from the URL once on mount. After mount:
  //   - user edits flow state → URL (best-effort mirror via router.replace)
  //   - external URL changes (back/forward, link, paste) re-seed state via
  //     the searchParams-driven effect below.
  const [filters, setFilters] = React.useState<ReportFilters>(() =>
    filtersFromSearchParams(searchParams)
  );

  // Canonical serialization of the URL's filter params. Recomputed only when
  // the underlying value changes (not on every searchParams object identity
  // change), so the URL→state effect below doesn't fire on unrelated renders.
  const urlCanonical = React.useMemo(
    () => filtersToSearchParams(filtersFromSearchParams(searchParams)).toString(),
    [searchParams]
  );

  // External navigation → state. Fires only when the canonical URL form
  // changes. Our own router.replace writes round-trip through here too, but
  // the values match current state, so setFilters becomes a no-op.
  React.useEffect(() => {
    const fromUrl = filtersFromSearchParams(searchParams);
    const a = filtersToSearchParams(filters).toString();
    const b = filtersToSearchParams(fromUrl).toString();
    if (a !== b) setFilters(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCanonical]);

  // State → URL (best-effort mirror; never scrolls). Skipped when the URL is
  // already canonical for the current state.
  React.useEffect(() => {
    const qs = filtersToSearchParams(filters).toString();
    const urlQs = filtersToSearchParams(
      filtersFromSearchParams(searchParams)
    ).toString();
    if (qs === urlQs) return;
    const url = qs ? `${pathname}?${qs}` : pathname;
    router.replace(url, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function updateFilters(patch: Partial<ReportFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function toggleInList(key: "departments" | "categories" | "statuses", value: string) {
    setFilters((prev) => {
      const current = prev[key] as string[];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  }

  function clearAll() {
    setFilters({
      dateStart: undefined,
      dateEnd: undefined,
      departments: [],
      categories: [],
      statuses: [],
    });
  }

  // ---------------------------------------------------------- report data
  const { state, retry } = useReportClaims(filters);
  const filtersActive = hasActiveFilters(filters);
  const rangeError = validateDateRange(filters);

  const rows: ReportRow[] = state.status === "ready" ? state.result.rows : [];
  const totals = state.status === "ready" ? state.result.totals : [];
  const claimCount = state.status === "ready" ? state.result.claimCount : 0;

  // Export needs both dates AND a valid (non-inverted) range — the BE's CSV
  // route always requires start+end, unlike the JSON report.
  const exportDisabled =
    claimCount === 0 || !!rangeError || !filters.dateStart || !filters.dateEnd;

  // ----------------------------------------------------------- CSV export
  const [exportError, setExportError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setExportError(null);
  }, [filters]);

  const onExport = React.useCallback(async () => {
    if (exportDisabled) return;
    setExportError(null);
    try {
      const blob = await exportCsv(filters);
      downloadBlob(reportCsvFilename(), blob);
      show(`Exported ${claimCount} claim${claimCount === 1 ? "" : "s"} to CSV.`, {
        tone: "success",
      });
    } catch (err) {
      const message =
        err instanceof ReportingApiError
          ? err.message
          : "Couldn't reach the server. Check your connection and try again.";
      setExportError(message);
    }
  }, [exportDisabled, filters, claimCount, show]);

  // -------------------------------------------------------------- columns
  const columns: Column<ReportRow>[] = [
    {
      key: "claim",
      header: "Claim ID",
      sortable: true,
      sortValue: (r) => r.reference,
      render: (r) => (
        <div className="min-w-[8rem]">
          <p className="font-medium text-on-surface">{r.reference}</p>
        </div>
      ),
    },
    {
      key: "employee",
      header: "Employee",
      sortable: true,
      sortValue: (r) => r.employeeName,
      render: (r) => (
        <div>
          <p className="text-on-surface">{r.employeeName}</p>
          {r.department && (
            <p className="text-xs text-on-surface-variant">{r.department}</p>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      sortable: true,
      sortValue: (r) => r.categoryName,
      render: (r) => <span className="text-on-surface-variant">{r.categoryName}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortable: true,
      sortValue: (r) => r.amount,
      render: (r) => (
        <span className="font-semibold text-on-surface">
          {formatCurrency(r.amount, r.currency as "IDR" | "USD")}
        </span>
      ),
    },
    {
      key: "currency",
      header: "Currency",
      render: (r) => <span className="text-on-surface-variant">{r.currency}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusChip status={r.status} size="sm" />,
    },
    {
      key: "payment",
      header: "Payment ref",
      render: (r) =>
        r.paymentReference ? (
          <span className="font-mono text-xs text-on-surface">{r.paymentReference}</span>
        ) : (
          <span className="text-on-surface-variant/60">—</span>
        ),
    },
    {
      key: "submitted",
      header: "Submitted",
      sortable: true,
      sortValue: (r) => r.submittedAt ?? "",
      render: (r) => (
        <span className="text-on-surface-variant">
          {r.submittedAt ? formatDate(r.submittedAt) : "—"}
        </span>
      ),
    },
  ];

  // -------------------------------------------------------- filter options
  const categoryOptions: ChipOption[] = React.useMemo(
    () =>
      [...categories]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name })),
    []
  );

  const departmentOptions: ChipOption[] = React.useMemo(
    () => DEPARTMENTS.map((d) => ({ value: d, label: d })),
    []
  );

  // ARIA live announcement string — polite, atomic, so SR users hear filter
  // result changes without losing context.
  const liveAnnouncement = React.useMemo(() => {
    if (state.status === "ready") {
      const lines = totals.map(
        (t) => `${t.count} claim${t.count === 1 ? "" : "s"} totalling ${formatCurrency(t.total, t.currency as "IDR" | "USD")} ${t.currency}`
      );
      return lines.length > 0
        ? `Report shows ${lines.join("; ")}.`
        : "No claims match the current filters.";
    }
    if (state.status === "invalid") return `Filter error: ${state.message}`;
    if (state.status === "unfiltered") return "Select a filter to generate a report.";
    return "";
  }, [state, totals]);

  // --------------------------------------------------------------- render
  return (
    <AppShell
      action={
        <Button
          size="sm"
          icon={Download}
          onClick={onExport}
          disabled={exportDisabled}
        >
          Export CSV
        </Button>
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Reports</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Filter submitted claims, review spend totals per currency, and export a finance-ready CSV.
          </p>
        </div>

        {/* Filters ---------------------------------------------------- */}
        <Card>
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DateField
                label="Start date"
                value={filters.dateStart ?? ""}
                onChange={(e) => updateFilters({ dateStart: e.target.value || undefined })}
                helper="Inclusive — claims submitted on or after this date."
                containerClassName="w-full"
              />
              <DateField
                label="End date"
                value={filters.dateEnd ?? ""}
                onChange={(e) => updateFilters({ dateEnd: e.target.value || undefined })}
                error={rangeError ?? undefined}
                aria-invalid={!!rangeError}
                helper={
                  rangeError
                    ? undefined
                    : "Inclusive — claims submitted on or before this date."
                }
                containerClassName="w-full"
              />
            </div>

            <FilterChipGroup
              legendId="filter-dept-label"
              legend="Department"
              options={departmentOptions}
              selected={filters.departments}
              onToggle={(v) => toggleInList("departments", v)}
              onClear={() => updateFilters({ departments: [] })}
            />

            <FilterChipGroup
              legendId="filter-cat-label"
              legend="Category"
              options={categoryOptions}
              selected={filters.categories}
              onToggle={(v) => toggleInList("categories", v)}
              onClear={() => updateFilters({ categories: [] })}
            />

            <FilterChipGroup
              legendId="filter-status-label"
              legend="Status"
              options={STATUS_OPTIONS}
              selected={filters.statuses}
              onToggle={(v) => toggleInList("statuses", v)}
              onClear={() => updateFilters({ statuses: [] })}
            />

            {rangeError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-error/40 bg-error-container/40 px-4 py-3 text-sm text-error"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>{rangeError} CSV export is blocked until the range is corrected.</span>
              </div>
            )}

            {state.status === "invalid" && !rangeError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-error/40 bg-error-container/40 px-4 py-3 text-sm text-error"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>{state.message}</span>
              </div>
            )}

            {exportError && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-xl border border-error/40 bg-error-container/40 px-4 py-3 text-sm text-error"
              >
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  {exportError}
                </span>
                <Button variant="text" size="sm" icon={RefreshCw} onClick={onExport}>
                  Retry
                </Button>
              </div>
            )}

            {filtersActive && (
              <div className="flex justify-end">
                <Button variant="text" size="sm" icon={FilterX} onClick={clearAll}>
                  Clear all filters
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* ARIA live region — polite, atomic, screen-reader-only. */}
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {liveAnnouncement}
        </p>

        {state.status === "loading" && <ReportsSkeleton />}

        {state.status === "forbidden" && (
          <div
            role="alert"
            aria-live="assertive"
            className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container px-6 py-10 text-center"
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
              <ShieldX className="h-6 w-6" strokeWidth={1.75} aria-hidden />
            </span>
            <p className="font-medium text-on-surface">You&apos;re not authorized to view reports.</p>
            <p className="text-sm text-on-surface-variant">
              Your session no longer has Finance Admin access. Reload the page or sign in again.
            </p>
          </div>
        )}

        {state.status === "unfiltered" && (
          <Card>
            <EmptyState
              icon={SlidersHorizontal}
              title="Choose a filter to generate a report"
              body="Select a date range, department, category, or status above to see matching claims."
              variant="compact"
            />
          </Card>
        )}

        {state.status === "error" && (
          <Card>
            <EmptyState
              icon={AlertTriangle}
              title="Couldn’t load report data"
              body={state.message}
              action={
                <Button variant="outlined" icon={RefreshCw} onClick={retry}>
                  Try again
                </Button>
              }
            />
          </Card>
        )}

        {state.status === "ready" && (
          <>
            {/* Totals ----------------------------------------------------- */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MetricCard label="Claims" value={String(claimCount)} icon={ReceiptText} />
                <MetricCard
                  label="Line items"
                  value={String(rows.length)}
                  icon={BarChart3}
                  hint={totals.length > 1 ? `${totals.length} currencies` : undefined}
                />
              </div>

              {/* Per-currency subtotals — do NOT FX-convert. */}
              <Card title="Totals by currency" subtitle="Per-currency subtotals for the current filter set">
                {totals.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">No matching claims.</p>
                ) : (
                  <ul className="divide-y divide-outline-variant">
                    {totals.map((t) => (
                      <li
                        key={t.currency}
                        className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                      >
                        <div>
                          <p className="text-sm font-semibold text-on-surface">{t.currency}</p>
                          <p className="text-xs text-on-surface-variant">
                            {t.count} claim{t.count === 1 ? "" : "s"}
                          </p>
                        </div>
                        <p className="text-lg font-bold text-on-surface">
                          {formatCurrency(t.total, t.currency as "IDR" | "USD")}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* Results table --------------------------------------------- */}
            <Card
              title="Claims"
              subtitle={`${rows.length} matching`}
              padded={false}
            >
              <DataTable
                columns={columns}
                data={rows}
                rowKey={(r) => r.lineItemId}
                density="compact"
                caption="Filtered claims report"
                empty={
                  <EmptyState
                    icon={filtersActive ? FilterX : ReceiptText}
                    title="No claims match"
                    body="Adjust the filters above to widen the report."
                    action={
                      <Button variant="outlined" onClick={clearAll}>
                        Clear all filters
                      </Button>
                    }
                    variant="compact"
                  />
                }
              />
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

/* ----------------------------------------------------------- skeleton --- */

function ReportsSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton variant="line" className="h-7 w-40" />
        <Skeleton variant="line" className="mt-2 h-4 w-72" />
      </div>
      <Skeleton variant="block" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
      <Skeleton variant="list" lines={6} />
    </div>
  );
}

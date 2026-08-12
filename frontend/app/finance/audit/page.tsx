"use client";

/* ============================================================================
 * SpendFlow — /finance/audit (#71).
 *
 * Finance-Admin directory-wide audit viewer: every admin action (role change,
 * manager change, status change, claim unblock, user delete/create, overrides,
 * rejections, payment processing) across the whole system, newest-first.
 * Read-only — never mutates state.
 *
 * Reads the directory via `useUsers` (to resolve actor + target names through
 * `AuditEntryRow`'s `userById` map) and the audit trail via `useGlobalAudit`
 * (`GET /api/admin/audit`). Filter bar: action select (derived from the same
 * hardcoded action codes `AuditEntryRow` humanizes), a from/to date range, and
 * an actor select (Phase 1: "All" only — the picker is left open for a future
 * actor filter). A BE 403 maps to the same access-denied panel `RouteGuard`
 * shows for a role mismatch (the `denied` state of `useGlobalAudit`).
 *
 * Pagination is a simple Next/Prev over the fetched window (client-side slice)
 * for Phase 1 — the BE caps at `limit` with no offset/cursor yet, so a future
 * BE cursor replaces this once landing.
 * ========================================================================== */

import * as React from "react";
import { AlertTriangle, Download, History, RefreshCw, ShieldX, ChevronLeft, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useUsers, useGlobalAudit } from "@/lib/hooks/useUsers";
import { AuditEntryRow, ALL_AUDIT_ACTIONS, humanizeAction } from "@/components/admin/AuditEntryRow";
import { buildAuditCsvUrl, type AuditAllFilters } from "@/lib/api/users";

/** Fetch window for the audit table. Bumped to the BE max so client-side
 *  pagination over the slice has room to breathe (Phase 1). */
const FETCH_LIMIT = 500;
const PAGE_SIZE = 50;

/** Action options for the filter select: "All" + every known action code,
 *  humanized with the same `humanizeAction` the row renderer uses. */
const ACTION_OPTIONS = [
  { value: "", label: "All" },
  ...ALL_AUDIT_ACTIONS.map((action) => ({ value: action, label: humanizeAction(action) })),
];

/** Actor options — Phase 1 is "All" only. The picker is left in place so a
 *  future ticket can wire a specific Finance Admin / Approver list in. */
const ACTOR_OPTIONS = [{ value: "", label: "All" }];

/** `"YYYY-MM-DD"` (date input value) → unix seconds. `to` is end-of-day so the
 *  inclusive date range on the BE catches entries on the boundary day. */
function dateToUnixSeconds(date: string, endOfDay = false): number {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, 0, 0);
  return Math.floor(dt.getTime() / 1000);
}

export default function FinanceAuditPage() {
  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Audit log</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Every admin action across the system — role changes, manager changes, overrides,
            and more — recorded by the backend, newest first. Read-only.
          </p>
        </div>
        <FinanceAuditView />
      </div>
    </AppShell>
  );
}

function FinanceAuditView() {
  const [action, setAction] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [denied, setDenied] = React.useState(false);

  const { state: directory } = useUsers();
  const users = directory.status === "ready" ? directory.rows : [];

  const filters = React.useMemo<AuditAllFilters>(() => {
    const f: AuditAllFilters = { limit: FETCH_LIMIT };
    if (action) f.action = action;
    if (from) f.from = dateToUnixSeconds(from);
    if (to) f.to = dateToUnixSeconds(to, true);
    return f;
  }, [action, from, to]);

  const { state, refresh } = useGlobalAudit(filters);

  const userById = React.useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );

  React.useEffect(() => {
    if (state.status === "denied") setDenied(true);
  }, [state.status]);

  // Reset to the first page whenever the filter state changes.
  const [page, setPage] = React.useState(0);
  React.useEffect(() => setPage(0), [action, from, to]);

  const entries = state.status === "ready" ? state.entries : [];
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageEntries = entries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const hasActiveFilters = action !== "" || from !== "" || to !== "";

  // CSV export (#72): top-level <a> navigation so the browser sends the
  // httpOnly session cookie (SameSite=Lax); the BE's Content-Disposition
  // header supplies the real filename. Disabled until a fetch has landed.
  const canExport = state.status === "ready" && entries.length > 0;

  return (
    <div className="space-y-5">
      {denied ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container px-6 py-10 text-center"
        >
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
            <ShieldX className="h-6 w-6" strokeWidth={1.75} aria-hidden />
          </span>
          <p className="font-medium text-on-surface">You&apos;re not authorized to view the audit log.</p>
          <p className="text-sm text-on-surface-variant">
            Your session no longer has Finance Admin access. Reload the page or sign in again.
          </p>
        </div>
      ) : (
        <>
          <Card padded={false}>
            {/* filter bar */}
            <div className="space-y-3 border-b border-outline-variant px-5 py-4">
              <div className="flex justify-end">
                <a
                  href={buildAuditCsvUrl(filters)}
                  download="audit.csv"
                  aria-disabled={!canExport}
                  tabIndex={canExport ? 0 : -1}
                  aria-label="Export CSV"
                  className="relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full bg-secondary-container px-4 font-medium text-secondary-container-foreground transition-all duration-200 ease-m3 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 h-9 text-sm"
                >
                  <Download className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
                  Export CSV
                </a>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Select
                  label="Action"
                  placeholder="All actions"
                  options={ACTION_OPTIONS}
                  value={action}
                  onChange={setAction}
                  containerClassName="sm:col-span-2 lg:col-span-1"
                />
                <DateField
                  label="From"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  max={to || undefined}
                  containerClassName="lg:col-span-1"
                />
                <DateField
                  label="To"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  min={from || undefined}
                  containerClassName="lg:col-span-1"
                />
                <Select
                  label="Actor"
                  placeholder="All"
                  options={ACTOR_OPTIONS}
                  value=""
                  onChange={() => {}}
                  disabled
                  containerClassName="sm:col-span-2 lg:col-span-1"
                />
              </div>
              <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {entries.length === 0
                  ? "No audit entries match your filters."
                  : `Showing ${pageEntries.length} of ${entries.length} audit entries.`}
              </p>
              {hasActiveFilters && (
                <p className="text-xs text-on-surface-variant">
                  Filtered by {action && humanizeAction(action)}
                  {action && (from || to) ? " · " : ""}
                  {from && `from ${from}`}
                  {from && to ? " · " : ""}
                  {to && `to ${to}`}
                </p>
              )}
            </div>

            {/* results */}
            <div className="p-5">
              {state.status === "loading" && (
                <div aria-busy="true" role="status" aria-label="Loading audit log">
                  <Skeleton variant="list" lines={4} />
                </div>
              )}
              {state.status === "error" && (
                <div
                  role="alert"
                  className="flex flex-col items-center gap-3 px-4 py-10 text-center sm:flex-row sm:gap-6 sm:text-left"
                >
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
                    <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-on-surface">Couldn&apos;t load the audit log</p>
                    <p className="mt-1 text-sm text-on-surface-variant">{state.message}</p>
                  </div>
                  <Button variant="tonal" size="sm" icon={RefreshCw} onClick={refresh}>
                    Retry
                  </Button>
                </div>
              )}
              {state.status === "ready" && entries.length === 0 && (
                <EmptyState
                  icon={History}
                  title={hasActiveFilters ? "No matching audit entries" : "No audit entries yet"}
                  body={
                    hasActiveFilters
                      ? "No admin actions match your filters. Try widening the date range or action."
                      : "Admin actions — role changes, overrides, payment processing — will be recorded here."
                  }
                  variant="compact"
                />
              )}
              {state.status === "ready" && entries.length > 0 && (
                <>
                  <ul className="space-y-2" aria-label="Audit entries">
                    {pageEntries.map((entry) => (
                      <AuditEntryRow key={entry.id} entry={entry} userById={userById} />
                    ))}
                  </ul>
                  {/* pagination: Next/Prev over the fetched window (Phase 1) */}
                  <div className="mt-4 flex items-center justify-between border-t border-outline-variant pt-3">
                    <p className="text-xs text-on-surface-variant">
                      Page {safePage + 1} of {totalPages}
                      {entries.length >= FETCH_LIMIT && " · window capped — refine filters for older entries"}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="tonal"
                        size="sm"
                        icon={ChevronLeft}
                        disabled={safePage === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                      >
                        Prev
                      </Button>
                      <Button
                        variant="tonal"
                        size="sm"
                        iconRight={ChevronRight}
                        disabled={safePage >= totalPages - 1}
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ============================================================================
   SpendFlow — Finance reporting filter / totals / CSV helpers (Phase 1, #9).
   Pure, side-effect-free utilities over the live `claims` fixture so the same
   logic drives the on-screen totals, the results table, and the CSV export
   (single source of truth — no duplicated filter code).
   ========================================================================== */

import {
  computeClaimTotal,
  getUser,
  getCategory,
  type Claim,
  type ClaimStatus,
} from "@/lib/mock/mock_data";
import type { CurrencyCode } from "@/lib/format";

/** Statuses surfaced in the report status multi-select. */
export const REPORT_STATUSES: ClaimStatus[] = [
  "draft",
  "pending",
  "action_required",
  "approved",
  "processing",
  "paid",
  "rejected",
];

/**
 * Report filter state. Empty arrays / undefined mean "no constraint" (AND
 * semantics across the populated dimensions). `dateStart` / `dateEnd` are
 * inclusive `YYYY-MM-DD` bounds applied to the claim's submission date
 * (falling back to createdAt for drafts).
 */
export interface ReportFilters {
  dateStart?: string;
  dateEnd?: string;
  departments: string[];
  categories: string[];
  statuses: ClaimStatus[];
}

export const EMPTY_FILTERS: ReportFilters = {
  dateStart: undefined,
  dateEnd: undefined,
  departments: [],
  categories: [],
  statuses: [],
};

/**
 * True when `filters` carries no constraint. Used to toggle the "Clear
 * filters" affordance and to short-circuit the CSV export validation.
 */
export function hasActiveFilters(filters: ReportFilters): boolean {
  return (
    !!filters.dateStart ||
    !!filters.dateEnd ||
    filters.departments.length > 0 ||
    filters.categories.length > 0 ||
    filters.statuses.length > 0
  );
}

/**
 * Validate the date-range pair. Returns a user-facing message when the range
 * is inverted or partially malformed, otherwise `null`. Used both to block
 * CSV export and to surface an inline error before filtering executes (per
 * the ticket's negative acceptance criteria).
 */
export function validateDateRange(filters: ReportFilters): string | null {
  const { dateStart, dateEnd } = filters;
  if (dateStart && dateEnd && dateEnd < dateStart) {
    return "End date must be on or after the start date.";
  }
  return null;
}

/** Claim's effective submission date (falls back to createdAt for drafts). */
export function claimSubmittedDate(claim: Claim): string {
  return (claim.submittedAt ?? claim.createdAt).slice(0, 10);
}

/**
 * AND-across-dimensions filter. Empty arrays / undefineds mean "any". A claim
 * matches when:
 *   - submission date is within [dateStart, dateEnd] (inclusive),
 *   - the submitter's department is in the set (or set is empty),
 *   - it carries at least one line item whose category is in the set
 *     (or the set is empty),
 *   - its status is in the set (or the set is empty).
 *
 * Exported so the test suite can assert combinations directly.
 */
export function filterClaims(claims: Claim[], filters: ReportFilters): Claim[] {
  const deptSet = filters.departments;
  const catSet = filters.categories;
  const statusSet = filters.statuses;
  return claims.filter((c) => {
    const submitted = claimSubmittedDate(c);
    if (filters.dateStart && submitted < filters.dateStart) return false;
    if (filters.dateEnd && submitted > filters.dateEnd) return false;
    if (deptSet.length > 0) {
      const dept = getUser(c.employeeId)?.department;
      if (!dept || !deptSet.includes(dept)) return false;
    }
    if (catSet.length > 0) {
      const hit = c.lineItems.some((li) => catSet.includes(li.categoryId));
      if (!hit) return false;
    }
    if (statusSet.length > 0 && !statusSet.includes(c.status)) return false;
    return true;
  });
}

/** Distinct category ids present on a claim (used for CSV / table display). */
export function claimCategoryIds(claim: Claim): string[] {
  const ids = new Set<string>();
  for (const li of claim.lineItems) ids.add(li.categoryId);
  return [...ids];
}

/** Comma-joined category names for a claim, e.g. "Flight; Hotel; Meals". */
export function claimCategoryLabel(claim: Claim): string {
  const names = claimCategoryIds(claim)
    .map((id) => getCategory(id)?.name ?? id)
    .filter(Boolean);
  return names.length > 0 ? names.join("; ") : "—";
}

/** Per-currency subtotal row. Phase 1 mock data is IDR-only but the report
 *  groups by `claim.currency` so a mixed-currency fixture still reconciles. */
export interface CurrencyTotal {
  currency: CurrencyCode;
  count: number;
  total: number;
}

/**
 * Group filtered claims by currency and sum each bucket. Returns rows sorted
 * alphabetically by currency code (stable order for the UI and tests). The
 * "grand total" claim count is the sum of per-currency counts; we never
 * FX-convert across currencies (per the DoD).
 */
export function computeCurrencyTotals(claims: Claim[]): CurrencyTotal[] {
  const map = new Map<CurrencyCode, CurrencyTotal>();
  for (const c of claims) {
    const cur = c.currency;
    const row = map.get(cur) ?? { currency: cur, count: 0, total: 0 };
    row.count += 1;
    row.total += computeClaimTotal(c);
    map.set(cur, row);
  }
  return [...map.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency)
  );
}

/* ----------------------------------------------------------------- CSV --- */

/** CSV column order (per the ticket DoD — finance reconciliation feed). */
export const REPORT_CSV_COLUMNS = [
  "Claim ID",
  "Employee",
  "Category",
  "Amount",
  "Currency",
  "Status",
  "Payment reference",
  "Submitted at",
] as const;

/**
 * RFC-4180-style CSV escaping: a field is wrapped in double quotes when it
 * contains a comma, double-quote, newline, or leading/trailing whitespace;
 * embedded double-quotes are doubled. Numbers and the empty string pass
 * through unchanged. Exported for direct unit testing.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Employee display name (defensive — falls back to the id). */
export function claimEmployeeName(claim: Claim): string {
  return getUser(claim.employeeId)?.name ?? claim.employeeId;
}

/** Payment reference stamped by Finance, or empty string for unpaid claims. */
export function claimPaymentReference(claim: Claim): string {
  return claim.payment?.reference ?? "";
}

/**
 * Build the CSV body (header + rows) for the supplied claims. The header row
 * matches {@link REPORT_CSV_COLUMNS} exactly; rows are produced in the same
 * order the caller passed them so the export mirrors the on-screen table.
 * Uses `\r\n` line terminators (Excel-friendly) and {@link escapeCsvField}
 * for every cell.
 */
export function buildReportCsv(claims: Claim[]): string {
  const header = REPORT_CSV_COLUMNS.map(escapeCsvField).join(",");
  const rows = claims.map((c) =>
    [
      c.reference,
      claimEmployeeName(c),
      claimCategoryLabel(c),
      computeClaimTotal(c).toFixed(0),
      c.currency,
      c.status,
      claimPaymentReference(c),
      claimSubmittedDate(c),
    ]
      .map(escapeCsvField)
      .join(",")
  );
  return [header, ...rows].join("\r\n");
}

/**
 * Trigger a client-side CSV download via a Blob URL. No page reload, so the
 * caller's filter state (URL + component state) survives. The filename
 * includes a timestamp so repeat exports never overwrite each other.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build a timestamped export filename, e.g. `spendflow-report-20260731-093015.csv`.
 * Dates are zero-padded so a directory listing sorts naturally.
 */
export function reportCsvFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `spendflow-report-${stamp}.csv`;
}

/* ----------------------------------------------------------- URL state --- */

/**
 * Serialize {@link ReportFilters} into URL search params. Empty arrays and
 * missing dates are omitted entirely (so an "all time / everything" view
 * produces a clean `/reports` URL). Stable key order makes the URL diffable.
 */
export function filtersToSearchParams(filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.dateStart) params.set("start", filters.dateStart);
  if (filters.dateEnd) params.set("end", filters.dateEnd);
  if (filters.departments.length > 0) {
    params.set("dept", filters.departments.slice().sort().join(","));
  }
  if (filters.categories.length > 0) {
    params.set("cat", filters.categories.slice().sort().join(","));
  }
  if (filters.statuses.length > 0) {
    params.set("status", filters.statuses.slice().sort().join(","));
  }
  return params;
}

/**
 * Parse a `URLSearchParams` (or `null`) back into {@link ReportFilters}.
 * Unknown / malformed values are dropped rather than thrown — a stale or
 * hand-edited URL still produces a valid report view (per the ticket's
 * "revisiting a copied URL restores the same view" criterion).
 */
export function filtersFromSearchParams(
  params: URLSearchParams | null
): ReportFilters {
  const next: ReportFilters = { ...EMPTY_FILTERS };
  if (!params) return next;
  const start = params.get("start");
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) next.dateStart = start;
  const end = params.get("end");
  if (end && /^\d{4}-\d{2}-\d{2}$/.test(end)) next.dateEnd = end;
  const dept = params.get("dept");
  if (dept) next.departments = dept.split(",").map((s) => s.trim()).filter(Boolean);
  const cat = params.get("cat");
  if (cat) next.categories = cat.split(",").map((s) => s.trim()).filter(Boolean);
  const status = params.get("status");
  if (status) {
    next.statuses = status
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is ClaimStatus =>
        (REPORT_STATUSES as string[]).includes(s)
      );
  }
  return next;
}

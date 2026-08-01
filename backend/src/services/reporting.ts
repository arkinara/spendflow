/* ============================================================================
 * SpendFlow — Reporting & CSV export service (ticket #16, BE-reporting).
 *
 * Read-only domain over the claim / line-item / payment data produced by
 * BE-claims (#11) and BE-finance (#13). Two consumer-facing operations share
 * the same filter + row-collection core so the JSON report and the CSV export
 * always agree row-for-row:
 *
 *   - getReport(filters)   → per-line-item rows + per-currency totals + claim count
 *   - exportCsv(filters)   → RFC-4180 CSV body + timestamped filename
 *
 * Filters combine with AND semantics across dimensions:
 *   - start / end  : inclusive YYYY-MM-DD bounds on the claim's effective
 *                    submission date (submittedAt, falling back to createdAt
 *                    for never-submitted drafts — matches the #9 FE behavior).
 *   - departments  : claim submitter's department is in the set.
 *   - categoryIds  : the line item's category is in the set (line-item-level).
 *   - statuses     : the claim's status is in the set.
 *
 * Amounts are summed per line-item currency without any FX conversion (per
 * the #9 DoD — Phase 1 is same-currency reconciliation only).
 * ========================================================================== */

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import {
  categoriesTable,
  claimLineItemsTable,
  claimsTable,
  paymentsTable,
  usersTable,
  CLAIM_STATUSES,
  type ClaimStatus,
} from "../db/schema.js";
import type { DB } from "../db/index.js";

export class ReportingError extends Error {
  constructor(
    public status: number,
    public code:
      | "empty_filter"
      | "date_range_required"
      | "invalid_start"
      | "invalid_end"
      | "inverted_date_range"
      | "unknown_status"
      | "unknown_category",
    message: string
  ) {
    super(message);
    this.name = "ReportingError";
  }
}

/* ----------------------------------------------------------- public types -- */

export interface ReportFilters {
  start?: string;
  end?: string;
  departments: string[];
  categoryIds: string[];
  statuses: ClaimStatus[];
}

/** A single reportable line-item row joined to its claim + employee + payment. */
export interface ReportRow {
  claimId: string;
  reference: string;
  employeeId: string;
  employeeName: string;
  department: string | null;
  lineItemId: string;
  categoryId: string;
  categoryName: string;
  description: string;
  /** Line-item expense date (ISO yyyy-mm-dd). */
  date: string;
  /** Line-item amount in minor units. */
  amount: number;
  /** Line-item currency code (e.g. IDR, USD). */
  currency: string;
  status: ClaimStatus;
  /** Payment reference stamped by Finance, or null when the claim is unpaid. */
  paymentReference: string | null;
  /** Claim's effective submission date (ISO yyyy-mm-dd), null for drafts. */
  submittedAt: string | null;
}

export interface CurrencyTotal {
  currency: string;
  /** Sum of line-item amounts in this currency (minor units, no FX). */
  total: number;
  /** Number of report rows (line items) in this currency. */
  count: number;
}

export interface ReportTotals {
  /** Per-currency subtotals, sorted alphabetically by currency code. */
  totals: CurrencyTotal[];
  /** Distinct claims represented in the result set. */
  claimCount: number;
}

export interface ReportResult extends ReportTotals {
  rows: ReportRow[];
}

export interface CsvExport {
  filename: string;
  content: string;
}

/* ------------------------------------------------------------- validation -- */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: string | undefined): s is string {
  return !!s && ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00.000Z`));
}

export function isEmptyFilter(f: ReportFilters): boolean {
  return (
    !f.start &&
    !f.end &&
    f.departments.length === 0 &&
    f.categoryIds.length === 0 &&
    f.statuses.length === 0
  );
}

/**
 * Validate the filter set. `requireDateRange` is true for the CSV export (both
 * start AND end mandatory, per the #9 FE behavior); false for the JSON report
 * which only rejects a completely empty filter set. Date ordering, status
 * enums, and category existence are checked in both modes so a malformed
 * request never reaches the query layer.
 */
export function validateReportFilters(
  db: DB,
  filters: ReportFilters,
  opts: { requireDateRange: boolean }
): void {
  if (opts.requireDateRange) {
    if (!filters.start || !filters.end) {
      throw new ReportingError(
        400,
        "date_range_required",
        "CSV export requires both start and end dates"
      );
    }
  } else if (isEmptyFilter(filters)) {
    throw new ReportingError(
      400,
      "empty_filter",
      "At least one filter (start, end, dept, cat, or status) is required"
    );
  }

  if (filters.start !== undefined && !isValidIsoDate(filters.start)) {
    throw new ReportingError(
      400,
      "invalid_start",
      "`start` must be a valid YYYY-MM-DD date"
    );
  }
  if (filters.end !== undefined && !isValidIsoDate(filters.end)) {
    throw new ReportingError(
      400,
      "invalid_end",
      "`end` must be a valid YYYY-MM-DD date"
    );
  }
  if (filters.start && filters.end && filters.end < filters.start) {
    throw new ReportingError(
      400,
      "inverted_date_range",
      "`end` must be on or after `start`"
    );
  }

  for (const s of filters.statuses) {
    if (!(CLAIM_STATUSES as readonly string[]).includes(s)) {
      throw new ReportingError(
        400,
        "unknown_status",
        `Unknown status value: ${s}`
      );
    }
  }

  if (filters.categoryIds.length > 0) {
    const known = new Set(
      db
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(inArray(categoriesTable.id, filters.categoryIds))
        .all()
        .map((r) => r.id)
    );
    for (const catId of filters.categoryIds) {
      if (!known.has(catId)) {
        throw new ReportingError(
          400,
          "unknown_category",
          `Unknown category id: ${catId}`
        );
      }
    }
  }
}

/* --------------------------------------------------------- core collection -- */

/**
 * Resolve inclusive UTC Date bounds for the date filter. A `YYYY-MM-DD` start
 * becomes UTC midnight; end becomes the last millisecond of that UTC day so
 * the bound is inclusive of the entire end day (matches the #9 string-slice
 * comparison semantics).
 */
function dateBounds(f: ReportFilters): { start?: Date; end?: Date } {
  const start = isValidIsoDate(f.start)
    ? new Date(`${f.start}T00:00:00.000Z`)
    : undefined;
  const end = isValidIsoDate(f.end)
    ? new Date(`${f.end}T23:59:59.999Z`)
    : undefined;
  return { start, end };
}

function effectiveSubmissionDate(claim: typeof claimsTable.$inferSelect): string | null {
  const d = claim.submittedAt ?? claim.createdAt;
  return d.toISOString().slice(0, 10);
}

/**
 * Collect matching report rows. A constant number of queries is issued
 * regardless of result size (no N+1): one pass each for the matching claims,
 * their line items, and the employee/category/payment lookups — so the
 * endpoint stays within acceptable response time on a large claim set.
 */
export function collectReportRows(db: DB, filters: ReportFilters): ReportRow[] {
  // ----- claim-level filtering (date / status / department) ---------------
  const claimConds: ReturnType<typeof eq>[] = [];

  const { start, end } = dateBounds(filters);
  if (start && end) {
    claimConds.push(
      or(
        and(
          isNotNull(claimsTable.submittedAt),
          gte(claimsTable.submittedAt, start),
          lte(claimsTable.submittedAt, end)
        ),
        and(
          isNull(claimsTable.submittedAt),
          gte(claimsTable.createdAt, start),
          lte(claimsTable.createdAt, end)
        )
      )!
    );
  } else if (start) {
    claimConds.push(
      or(
        and(isNotNull(claimsTable.submittedAt), gte(claimsTable.submittedAt, start)),
        and(isNull(claimsTable.submittedAt), gte(claimsTable.createdAt, start))
      )!
    );
  } else if (end) {
    claimConds.push(
      or(
        and(isNotNull(claimsTable.submittedAt), lte(claimsTable.submittedAt, end)),
        and(isNull(claimsTable.submittedAt), lte(claimsTable.createdAt, end))
      )!
    );
  }

  if (filters.statuses.length > 0) {
    claimConds.push(inArray(claimsTable.status, filters.statuses));
  }

  if (filters.departments.length > 0) {
    const matchingEmployees = db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(inArray(usersTable.department, filters.departments))
      .all()
      .map((r) => r.id);
    if (matchingEmployees.length === 0) return [];
    claimConds.push(inArray(claimsTable.employeeId, matchingEmployees));
  }

  const matchingClaims = claimConds.length
    ? db.select().from(claimsTable).where(and(...claimConds)).all()
    : db.select().from(claimsTable).all();

  if (matchingClaims.length === 0) return [];

  // ----- line-item-level filtering (category) -----------------------------
  const claimIds = matchingClaims.map((c) => c.id);
  const lineConds = [inArray(claimLineItemsTable.claimId, claimIds)];
  if (filters.categoryIds.length > 0) {
    lineConds.push(inArray(claimLineItemsTable.categoryId, filters.categoryIds));
  }
  const matchingLines = db
    .select()
    .from(claimLineItemsTable)
    .where(and(...lineConds))
    .orderBy(asc(claimLineItemsTable.createdAt))
    .all();

  if (matchingLines.length === 0) return [];

  // ----- batched lookups (employees / categories / payments) --------------
  const employeeMap = new Map(
    db
      .select()
      .from(usersTable)
      .where(
        matchingClaims.length > 0
          ? inArray(
              usersTable.id,
              matchingClaims.map((c) => c.employeeId)
            )
          : eq(usersTable.id, "__none__")
      )
      .all()
      .map((u) => [u.id, u])
  );
  const categoryMap = new Map(
    db
      .select()
      .from(categoriesTable)
      .where(
        inArray(
          categoriesTable.id,
          matchingLines.map((l) => l.categoryId)
        )
      )
      .all()
      .map((c) => [c.id, c])
  );
  const paymentMap = new Map(
    db
      .select()
      .from(paymentsTable)
      .where(inArray(paymentsTable.claimId, claimIds))
      .all()
      .map((p) => [p.claimId, p])
  );

  const claimsById = new Map(matchingClaims.map((c) => [c.id, c]));

  // ----- assemble rows -----------------------------------------------------
  const rows: ReportRow[] = matchingLines.map((line) => {
    const claim = claimsById.get(line.claimId)!;
    const employee = employeeMap.get(claim.employeeId);
    const category = categoryMap.get(line.categoryId);
    const payment = paymentMap.get(claim.id);
    return {
      claimId: claim.id,
      reference: claim.reference,
      employeeId: claim.employeeId,
      employeeName: employee?.name ?? claim.employeeId,
      department: employee?.department ?? null,
      lineItemId: line.id,
      categoryId: line.categoryId,
      categoryName: category?.name ?? line.categoryId,
      description: line.description,
      date: line.date,
      amount: line.amount,
      currency: line.currency,
      status: claim.status,
      paymentReference: payment?.referenceNumber ?? null,
      submittedAt: effectiveSubmissionDate(claim),
    };
  });

  // Stable order: submission date → reference → line-item creation. Keeps the
  // CSV and JSON report byte-identical for the same filter set.
  rows.sort((a, b) => {
    const sa = a.submittedAt ?? "";
    const sb = b.submittedAt ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    if (a.reference !== b.reference) {
      return a.reference < b.reference ? -1 : 1;
    }
    return 0;
  });

  return rows;
}

/* ------------------------------------------------------------- totals ------ */

export function computeTotals(rows: ReportRow[]): ReportTotals {
  const byCurrency = new Map<string, CurrencyTotal>();
  const distinctClaims = new Set<string>();

  for (const row of rows) {
    distinctClaims.add(row.claimId);
    const entry = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      total: 0,
      count: 0,
    };
    entry.total += row.amount;
    entry.count += 1;
    byCurrency.set(row.currency, entry);
  }

  const totals = [...byCurrency.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency)
  );

  return { totals, claimCount: distinctClaims.size };
}

/* ----------------------------------------------------------- public API ---- */

/** Filtered report: rows + per-currency totals + distinct claim count. */
export function getReport(db: DB, filters: ReportFilters): ReportResult {
  const rows = collectReportRows(db, filters);
  const { totals, claimCount } = computeTotals(rows);
  return { rows, totals, claimCount };
}

/** Per-currency totals + distinct claim count for the filter set. */
export function getTotals(db: DB, filters: ReportFilters): ReportTotals {
  const rows = collectReportRows(db, filters);
  return computeTotals(rows);
}

/* ----------------------------------------------------------------- CSV ----- */

/**
 * RFC-4180 CSV column order (per ticket DoD — finance reconciliation feed).
 * Header cells use the logical field names so downstream tooling can map
 * columns by name regardless of locale.
 */
export const REPORT_CSV_COLUMNS = [
  "claim_id",
  "employee",
  "category",
  "amount",
  "currency",
  "status",
  "payment_reference",
  "submitted_at",
] as const;

/**
 * RFC-4180 escaping: a field is wrapped in double quotes when it contains a
 * comma, double-quote, CR, or LF; embedded double-quotes are doubled. Numbers
 * and the empty string pass through unchanged.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build the CSV body (CRLF-terminated header + one row per matching line item)
 * from the same rows the JSON report returns, so the export matches the query
 * result exactly.
 */
export function buildReportCsv(rows: ReportRow[]): string {
  const header = REPORT_CSV_COLUMNS.map(escapeCsvField).join(",");
  const lines = rows.map((r) =>
    [
      r.reference,
      r.employeeName,
      r.categoryName,
      r.amount,
      r.currency,
      r.status,
      r.paymentReference ?? "",
      r.submittedAt ?? "",
    ]
      .map(escapeCsvField)
      .join(",")
  );
  return [header, ...lines].join("\r\n");
}

/** Timestamped export filename, e.g. `spendflow-report-20260731-093015.csv`. */
export function reportCsvFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `spendflow-report-${stamp}.csv`;
}

/**
 * Validate (export mode — both dates required) + build the CSV body. Returns
 * the filename and full text body so the route layer only has to set headers.
 */
export function exportCsv(db: DB, filters: ReportFilters): CsvExport {
  validateReportFilters(db, filters, { requireDateRange: true });
  const rows = collectReportRows(db, filters);
  return {
    filename: reportCsvFilename(),
    content: buildReportCsv(rows),
  };
}

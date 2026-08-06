/* ============================================================================
 * SpendFlow — Reporting & CSV export HTTP client (ticket #23, FE wiring).
 *
 * Thin typed wrapper over `/api/reports*` (BE #16). Every call goes through
 * `apiFetch` (#17), which sends `credentials: "include"` (httpOnly session
 * cookie), resolves against `NEXT_PUBLIC_BE_URL`, and fires the global 401
 * handler. Non-2xx responses are thrown as `ReportingApiError` carrying the
 * backend's `code` + `message` so the reports page can surface them inline:
 *   - `empty_filter`         (400) — JSON report called with no filter at all
 *   - `date_range_required`  (400) — CSV export missing start or end
 *   - `invalid_start` / `invalid_end` (400) — malformed YYYY-MM-DD
 *   - `inverted_date_range`  (400) — end before start
 *   - `unknown_status` / `unknown_category` (400) — bad enum / unknown id
 *   - `forbidden`            (403) — caller is not a Finance Admin
 *
 * `ReportFilters` / the URL-state helpers are reused as-is from
 * `lib/mock/reportFilter` (pure, no dependency on the mock claims fixture) so
 * the query-string shape stays identical between the FE URL and the BE's
 * `start/end/dept/cat/status` params.
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";
import type { ClaimStatus } from "@/lib/types";
import { filtersToSearchParams, type ReportFilters } from "@/lib/utils/reportFilter";

/** Typed error carrying the backend's status + code + message. */
export class ReportingApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ReportingApiError";
    this.status = status;
    this.code = code;
  }
}

/* --------------------------------------------------------------- types --- */

/** `ReportRow` from `services/reporting.ts` — one row per matching line item. */
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
  date: string;
  amount: number;
  currency: string;
  status: ClaimStatus;
  paymentReference: string | null;
  submittedAt: string | null;
}

export interface ReportCurrencyTotal {
  currency: string;
  total: number;
  count: number;
}

export interface ReportResult {
  rows: ReportRow[];
  totals: ReportCurrencyTotal[];
  claimCount: number;
}

/* --------------------------------------------------------------- error helper */

async function readError(res: Response): Promise<never> {
  let code = "internal";
  let message = `Request failed (${res.status}).`;
  try {
    const body = await res.json();
    const err = body?.error;
    if (err && typeof err === "object") {
      if (typeof err.code === "string") code = err.code;
      if (typeof err.message === "string" && err.message.trim()) message = err.message;
    } else if (typeof err === "string" && err.trim()) {
      message = err;
    } else if (typeof body?.message === "string" && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // non-JSON body — keep the status-derived fallback
  }
  throw new ReportingApiError(res.status, code, message);
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) await readError(res);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ReportingApiError(res.status, "internal", "Invalid JSON response from backend.");
  }
}

function buildQuery(filters: ReportFilters): string {
  return filtersToSearchParams(filters).toString();
}

/* ----------------------------------------------------------------- public API */

/** `GET /api/reports`. 400 `empty_filter` when every dimension is unset. */
export async function getReport(filters: ReportFilters): Promise<ReportResult> {
  const qs = buildQuery(filters);
  const res = await apiFetch(`/api/reports${qs ? `?${qs}` : ""}`, { method: "GET" });
  return parseJson<ReportResult>(res);
}

/**
 * `GET /api/reports/export.csv`. Requires both `start` and `end` (400
 * `date_range_required` otherwise). Returns the raw CSV body as a `Blob` so
 * the caller can trigger a browser download without buffering text in JS.
 */
export async function exportCsv(filters: ReportFilters): Promise<Blob> {
  const qs = buildQuery(filters);
  const res = await apiFetch(`/api/reports/export.csv${qs ? `?${qs}` : ""}`, {
    method: "GET",
  });
  if (!res.ok) await readError(res);
  return res.blob();
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
 * Trigger a client-side file download from a `Blob` via a temporary anchor +
 * object URL. No page reload, so the caller's filter state (URL + component
 * state) survives.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

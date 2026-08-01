/* ============================================================================
 * SpendFlow — Reporting & CSV export HTTP routes (ticket #16, BE-reporting).
 *
 * GET /api/reports?start=&end=&dept=&cat=&status=
 *     → JSON { rows, totals, claimCount }   (per-line-item rows, per-currency)
 *
 * GET /api/reports/export.csv?start=&end=&dept=&cat=&status=
 *     → text/csv  (RFC-4180, Content-Disposition: attachment; filename=...)
 *
 * Both endpoints are read-only and restricted to Finance Admin callers (the
 * /reports surface is finance-scoped on the FE per ticket #9). CSV export
 * additionally requires both start AND end dates; the JSON report only rejects
 * a completely empty filter set.
 * ========================================================================== */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Auth } from "../auth/index.js";
import { AuthError, requireRole } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import { type ClaimStatus } from "../db/schema.js";
import {
  ReportingError,
  exportCsv,
  getReport,
  validateReportFilters,
  type ReportFilters,
} from "../services/reporting.js";
import { jsonError } from "./claims.js";

/** Split a comma-separated query param, trimming blanks. */
function splitParam(c: Context, key: string): string[] {
  const value = c.req.query(key);
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse the shared query-string filter shape into a typed ReportFilters. */
function parseFilters(c: Context): ReportFilters {
  const statuses = splitParam(c, "status") as ClaimStatus[];
  return {
    start: c.req.query("start") || undefined,
    end: c.req.query("end") || undefined,
    departments: splitParam(c, "dept"),
    categoryIds: splitParam(c, "cat"),
    statuses,
  };
}

export function reportingRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();

  router.get("/api/reports", async (c) => {
    await requireRole(deps.auth, c.req.raw.headers, "finance");
    const filters = parseFilters(c);
    validateReportFilters(deps.db, filters, { requireDateRange: false });
    const result = getReport(deps.db, filters);
    return c.json(result);
  });

  router.get("/api/reports/export.csv", async (c) => {
    await requireRole(deps.auth, c.req.raw.headers, "finance");
    const filters = parseFilters(c);
    const { filename, content } = exportCsv(deps.db, filters);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Cache-Control", "no-store");
    return c.body(content);
  });

  return router;
}

/** Map reporting service errors to JSON responses (mounted once on the app). */
export function reportingErrorHandler(err: unknown, c: Context) {
  if (err instanceof ReportingError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  if (err instanceof AuthError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  const msg = err instanceof Error ? err.message : "Internal error";
  return jsonError(c, 500, "internal", msg);
}


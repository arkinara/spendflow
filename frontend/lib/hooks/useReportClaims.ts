"use client";

import * as React from "react";
import {
  getReport,
  ReportingApiError,
  type ReportResult,
} from "@/lib/api/reporting";
import { hasActiveFilters, type ReportFilters } from "@/lib/utils/reportFilter";

/**
 * HTTP-backed reports hook (ticket #23, FE wiring). Reads the filtered report
 * from `getReport()` (BE #16); a BE 401 is handled globally by `apiFetch`.
 * The state-machine interface (`{ state, retry, refresh }`) mirrors the other
 * wired hooks (`useFinanceDashboard`, `useAdminStore`, …) — only the data
 * source moves from the mock claims fixture to the BE.
 *
 * The BE rejects a completely empty filter set with 400 `empty_filter` (the
 * JSON report always needs at least one dimension). Rather than let that
 * flash as a scary error on first mount, that specific BE response is surfaced
 * as `status: "unfiltered"` so the page can render a friendly prompt instead
 * of the generic error+retry card. Every other 400 (inverted date range,
 * unknown status/category, …) surfaces as `status: "invalid"` for an inline
 * filter-panel error; 403 surfaces as `status: "forbidden"`.
 */
export type ReportState =
  | { status: "loading" }
  | { status: "unfiltered" }
  | { status: "ready"; result: ReportResult }
  | { status: "invalid"; code: string; message: string }
  | { status: "forbidden" }
  | { status: "error"; message: string };

export interface UseReportClaims {
  state: ReportState;
  retry: () => void;
  /** Force a fresh read of the BE (e.g. after filters settle). */
  refresh: () => void;
}

export function useReportClaims(filters: ReportFilters): UseReportClaims {
  const [state, setState] = React.useState<ReportState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const filtersKey = filtersToKey(filters);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    getReport(filters)
      .then((result) => {
        if (!cancelled) setState({ status: "ready", result });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ReportingApiError) {
          if (err.status === 403) {
            setState({ status: "forbidden" });
          } else if (err.status === 400 && err.code === "empty_filter") {
            setState({ status: "unfiltered" });
          } else if (err.status === 400) {
            setState({ status: "invalid", code: err.code, message: err.message });
          } else {
            setState({ status: "error", message: err.message });
          }
          return;
        }
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load report data.",
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, attempt]);

  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  const refresh = retry;

  return { state, retry, refresh };
}

/** Stable dependency key for the filter object (order-normalized). */
function filtersToKey(filters: ReportFilters): string {
  return JSON.stringify({
    dateStart: filters.dateStart ?? null,
    dateEnd: filters.dateEnd ?? null,
    departments: [...filters.departments].sort(),
    categories: [...filters.categories].sort(),
    statuses: [...filters.statuses].sort(),
  });
}

// Re-export so callers that only imported the hook keep a single import site
// for the "does this filter set even qualify as filtered" check.
export { hasActiveFilters };

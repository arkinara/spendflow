"use client";

/* ============================================================================
 * SpendFlow — useFinanceDashboard (ticket #20, FE wiring).
 * HTTP-backed: reads the composed dashboard payload from `getDashboard()`,
 * which fans out to `GET /api/finance/exceptions` + `GET /api/finance/payments`
 * (BE #13). A BE 401 is handled globally by `apiFetch`; 403 / network / 5xx
 * failures surface as a retry-capable `error` state so the dashboard never
 * shows a silent blank or an infinite spinner.
 *
 * The state-machine interface (`{ state, retry, refresh }`) is unchanged from
 * the mock version so the dashboard page keeps its loading / error / ready
 * branching shape — only the data source moves from the mock store to the BE.
 * ========================================================================== */

import * as React from "react";
import {
  getDashboard,
  FinanceApiError,
  type FinanceDashboardData,
} from "@/lib/api/finance";

export type FinanceDashboardState =
  | { status: "loading" }
  | { status: "ready"; data: FinanceDashboardData }
  | { status: "error"; message: string; code?: string };

export interface UseFinanceDashboard {
  state: FinanceDashboardState;
  retry: () => void;
  /** Force a fresh read of the BE (e.g. after a decision action). */
  refresh: () => void;
}

export function useFinanceDashboard(): UseFinanceDashboard {
  const [state, setState] = React.useState<FinanceDashboardState>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const data = await getDashboard();
        if (!cancelled) setState({ status: "ready", data });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof FinanceApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load the finance dashboard.";
        const code =
          err instanceof FinanceApiError ? err.code : undefined;
        setState({ status: "error", message, code });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = React.useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry, refresh };
}

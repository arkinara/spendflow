"use client";

import * as React from "react";
import { loadFinanceDashboard, type FinanceDashboardData } from "@/lib/mock/financeDashboard";

/**
 * Simulated async fetch of the Finance dashboard payload. Mock data is
 * synchronous, but the dashboard still shows a brief loading skeleton and an
 * explicit, retry-capable error state — matching the negative acceptance
 * criteria (no silent blank dashboard, no infinite spinner, consistent totals
 * even when no claims are Processing or Paid).
 */
export type FinanceDashboardState =
  | { status: "loading" }
  | { status: "ready"; data: FinanceDashboardData }
  | { status: "error"; message: string };

export interface UseFinanceDashboard {
  state: FinanceDashboardState;
  retry: () => void;
  /** Force a fresh read of the live store (e.g. after a decision action). */
  refresh: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useFinanceDashboard(): UseFinanceDashboard {
  const [state, setState] = React.useState<FinanceDashboardState>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        const data = loadFinanceDashboard();
        if (!cancelled) setState({ status: "ready", data });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message:
              err instanceof Error
                ? err.message
                : "Failed to load the finance dashboard.",
          });
        }
      }
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = React.useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry, refresh };
}

"use client";

import * as React from "react";
import { claims, type Claim } from "@/lib/mock/mock_data";

/**
 * Simulated async fetch of the full claim fixture for the Finance report view
 * (ticket #9). Mirrors the other list hooks: mock data is synchronous but the
 * UI still shows a brief loading skeleton and an explicit, retry-capable error
 * state (never a blank section, never an infinite spinner). Reads the live
 * `claims` array on every (re)load so a finance action that mutates the store
 * is reflected on the next `refresh()` without keeping a duplicate local copy.
 *
 * Filtering / totals / CSV generation all happen client-side over the
 * returned set (see `lib/mock/reportFilter`).
 */
export type ReportListState =
  | { status: "loading" }
  | { status: "ready"; claims: Claim[] }
  | { status: "error"; message: string };

export interface UseReportClaims {
  state: ReportListState;
  retry: () => void;
  /** Force a fresh read of the live store. */
  refresh: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useReportClaims(): UseReportClaims {
  const [state, setState] = React.useState<ReportListState>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        if (!cancelled) setState({ status: "ready", claims: [...claims] });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to load report data.",
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

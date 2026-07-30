"use client";

import * as React from "react";
import {
  claimsForEmployee,
  type Claim,
} from "@/lib/mock/mock_data";

/**
 * Simulated async fetch of an employee's full claim set for the history list.
 *
 * Mock data is synchronous, but the list still shows a brief loading skeleton
 * and an explicit, retry-capable error state — matching ticket #4's negative
 * acceptance criteria (no blank list, no infinite spinner). Selectors read the
 * live `claims` array on every (re)load, so freshly created/resubmitted claims
 * appear immediately without a manual refresh of the whole app.
 */
export type ClaimsListState =
  | { status: "loading" }
  | { status: "ready"; claims: Claim[] }
  | { status: "error"; message: string };

export interface UseEmployeeClaims {
  state: ClaimsListState;
  retry: () => void;
  /** Force a fresh read of the live store (e.g. after navigating back). */
  refresh: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useEmployeeClaims(employeeId: string): UseEmployeeClaims {
  const [state, setState] = React.useState<ClaimsListState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        const claims = claimsForEmployee(employeeId);
        if (!cancelled) setState({ status: "ready", claims });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load your claims.",
          });
        }
      }
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [employeeId, attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = React.useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry, refresh };
}

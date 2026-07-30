"use client";

import * as React from "react";
import {
  openFinanceExceptions,
  claimsReadyToPay,
  claimsProcessing,
  claimsPaid,
  computeClaimTotal,
  type Claim,
} from "@/lib/mock/mock_data";

/**
 * Shared async hook for the three Finance screens. Mirrors the approver inbox
 * hook: mock data is synchronous but the UI still shows a brief loading
 * skeleton and an explicit, retry-capable error state (never a blank section,
 * never an infinite spinner). Selectors read the live `claims` array on every
 * (re)load, so a finance action that mutates the store is reflected on the
 * next `refresh()` without keeping a duplicate local copy.
 */
export type FinanceListState =
  | { status: "loading" }
  | { status: "ready"; claims: Claim[] }
  | { status: "error"; message: string };

export interface UseFinanceList {
  state: FinanceListState;
  retry: () => void;
  /** Force a fresh read of the live store (e.g. after a decision action). */
  refresh: () => void;
}

const SIMULATED_LATENCY_MS = 200;

function useFinanceList(load: () => Claim[]): UseFinanceList {
  const [state, setState] = React.useState<FinanceListState>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        const claims = load();
        if (!cancelled) setState({ status: "ready", claims });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to load finance data.",
          });
        }
      }
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = React.useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry, refresh };
}

/** Claims with an open policy flag that are in Finance's hands to resolve. */
export function useFinanceExceptions(): UseFinanceList {
  return useFinanceList(() => openFinanceExceptions());
}

/** Claims fully approved and ready for Finance to disburse. */
export function useFinanceReadyToPay(): UseFinanceList {
  return useFinanceList(() => claimsReadyToPay());
}

/** Claims whose reimbursement is currently in flight (Processing). */
export function useFinanceInFlight(): UseFinanceList {
  return useFinanceList(() => claimsProcessing());
}

/** Claims already reimbursed, newest-paid first. */
export function useFinancePaid(): UseFinanceList {
  return useFinanceList(() => claimsPaid());
}

export { computeClaimTotal };

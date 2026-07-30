"use client";

import * as React from "react";
import { claimsForApprover, type Claim } from "@/lib/mock/mock_data";

/**
 * Simulated async fetch of the claims awaiting the current approver's step.
 *
 * Mock data is synchronous, but the inbox still shows a brief loading skeleton
 * and an explicit, retry-capable error state — matching ticket #5's negative
 * acceptance criteria (no blank list, no infinite spinner, clear empty state).
 * Selectors read the live `claims` array on every (re)load, so a freshly
 * decided claim disappears immediately after a mock decision action mutates the
 * store.
 */
export type ApproverInboxState =
  | { status: "loading" }
  | { status: "ready"; claims: Claim[] }
  | { status: "error"; message: string };

export interface UseApproverInbox {
  state: ApproverInboxState;
  retry: () => void;
  /** Force a fresh read of the live store (e.g. after navigating back). */
  refresh: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useApproverInbox(approverId: string): UseApproverInbox {
  const [state, setState] = React.useState<ApproverInboxState>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        const claims = claimsForApprover(approverId);
        if (!cancelled) setState({ status: "ready", claims });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to load your inbox.",
          });
        }
      }
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [approverId, attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = React.useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry, refresh };
}

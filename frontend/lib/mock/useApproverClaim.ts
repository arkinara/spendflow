"use client";

import * as React from "react";
import { getClaim, type Claim } from "@/lib/mock/mock_data";

/**
 * Simulated async fetch of a single claim for the approver review view.
 *
 * Mirrors {@link useClaimDetail}: a brief loading skeleton plus explicit
 * not-found / error states, and a `reload()` that re-reads the live `claims`
 * array so the timeline re-renders immediately after a mock decision. Unlike
 * the employee hook, the approver may legitimately view any submitted claim
 * (there is a single approver in Phase 1), so there is no cross-employee
 * "denied" branch here — the page instead renders a clear "no longer awaiting
 * your decision" panel when the claim has already been decided or advanced.
 */
export type ApproverClaimState =
  | { status: "loading" }
  | { status: "ready"; claim: Claim }
  | { status: "notfound" }
  | { status: "error"; message: string };

export interface UseApproverClaim {
  state: ApproverClaimState;
  reload: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useApproverClaim(claimId: string): UseApproverClaim {
  const [version, setVersion] = React.useState(0);
  const [state, setState] = React.useState<ApproverClaimState>({
    status: "loading",
  });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const timer = window.setTimeout(() => {
      try {
        const claim = getClaim(claimId);
        if (cancelled) return;
        if (!claim) {
          setState({ status: "notfound" });
        } else {
          setState({ status: "ready", claim });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load this claim.",
          });
        }
      }
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [claimId, version]);

  const reload = React.useCallback(() => setVersion((v) => v + 1), []);
  return { state, reload };
}

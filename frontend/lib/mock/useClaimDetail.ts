"use client";

import * as React from "react";
import { getClaim } from "@/lib/mock/mock_data";

/**
 * Simulated async fetch of a single claim for the detail view.
 *
 * The mock store is synchronous, but the view still shows a loading skeleton
 * plus explicit not-found / access-denied / error states — matching ticket
 * #4's negative acceptance criteria (no crash on a bad id, no blank screen on a
 * cross-employee URL, no infinite spinner on failure). The hook re-reads the
 * live `claims` array whenever `reload()` bumps the version, so the timeline
 * re-renders immediately after a mock decision action mutates the claim.
 */
export type ClaimDetailStatus =
  | "loading"
  | "ready"
  | "notfound"
  | "denied"
  | "error";

export interface ClaimDetailState {
  status: ClaimDetailStatus;
  message?: string;
  claim?: ReturnType<typeof getClaim>;
}

export interface UseClaimDetail {
  state: ClaimDetailState;
  reload: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useClaimDetail(
  claimId: string,
  viewerId: string
): UseClaimDetail {
  const [version, setVersion] = React.useState(0);
  const [state, setState] = React.useState<ClaimDetailState>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const timer = window.setTimeout(() => {
      try {
        const claim = getClaim(claimId);
        if (cancelled) return;
        if (!claim) {
          setState({ status: "notfound" });
        } else if (claim.employeeId !== viewerId) {
          // Cross-employee access via URL manipulation → explicit block.
          setState({ status: "denied" });
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
  }, [claimId, viewerId, version]);

  const reload = React.useCallback(() => setVersion((v) => v + 1), []);
  return { state, reload };
}

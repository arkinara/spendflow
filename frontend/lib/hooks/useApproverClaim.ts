"use client";

/* ============================================================================
 * SpendFlow — useApproverClaim (ticket #19, FE wiring).
 * HTTP-backed: reads `GET /api/approver/claims/:id` and, best-effort, the
 * audit timeline so the review page can render the chronological status
 * panel. The BE rejects with 403 `forbidden` when the claim is no longer at
 * the caller's step (cross-approver access or already-decided claim) — that
 * maps to the `denied` state so the page shows the existing "no longer
 * awaiting your decision" / access-denied panel.
 *
 * The hook's state-machine interface (`{ state, reload }`) is unchanged from
 * the mock version; `audit` is exposed on the ready state (same pattern as
 * `useClaimDetail` in #18).
 * ========================================================================== */

import * as React from "react";
import {
  getClaimForReview,
  ApprovalApiError,
  type BackendRoutingStep,
} from "@/lib/api/approvals";
import {
  getClaimAudit,
  type BackendAuditEntry,
} from "@/lib/api/claims";
import type { Claim } from "@/lib/types";

export type ApproverClaimState =
  | { status: "loading" }
  | {
      status: "ready";
      claim: Claim;
      employeeName: string;
      steps: BackendRoutingStep[];
      currentStep: BackendRoutingStep | null;
      audit: BackendAuditEntry[];
    }
  | { status: "notfound" }
  | { status: "denied" }
  | { status: "error"; message: string };

export interface UseApproverClaim {
  state: ApproverClaimState;
  reload: () => void;
}

export function useApproverClaim(claimId: string): UseApproverClaim {
  const [version, setVersion] = React.useState(0);
  const [state, setState] = React.useState<ApproverClaimState>({
    status: "loading",
  });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const detail = await getClaimForReview(claimId);
        if (cancelled) return;
        // Audit is best-effort: the GET above already enforced approver-step
        // access, but a transient failure should not blank the whole page —
        // fall back to an empty timeline and keep the claim visible.
        let audit: BackendAuditEntry[] = [];
        try {
          audit = await getClaimAudit(claimId);
        } catch {
          audit = [];
        }
        if (!cancelled) setState({ status: "ready", audit, ...detail });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApprovalApiError) {
          if (err.status === 404) {
            setState({ status: "notfound" });
          } else if (err.status === 403) {
            setState({ status: "denied" });
          } else {
            setState({ status: "error", message: err.message });
          }
        } else {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load this claim.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [claimId, version]);

  const reload = React.useCallback(() => setVersion((v) => v + 1), []);
  return { state, reload };
}

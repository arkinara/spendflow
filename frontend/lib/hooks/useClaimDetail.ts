"use client";

/* ============================================================================
 * SpendFlow — useClaimDetail (ticket #18, FE wiring).
 * HTTP-backed: reads `GET /api/claims/:id` and `GET /api/claims/:id/audit`.
 * A BE 404 → `notfound`; a BE 403 (`forbidden`) → `denied` (cross-employee
 * access); other failures → retry-capable `error`. The hook's public
 * interface (`{ state, reload }`) is unchanged so the detail page keeps its
 * shape. The audit timeline entries are exposed on the ready state so the
 * page can render the BE-owned status timeline.
 * ========================================================================== */

import * as React from "react";
import {
  getClaim,
  getClaimAudit,
  ClaimApiError,
  type BackendAuditEntry,
} from "@/lib/api/claims";
import type { Claim } from "@/lib/types";

export type ClaimDetailStatus =
  | "loading"
  | "ready"
  | "notfound"
  | "denied"
  | "error";

export interface ClaimDetailState {
  status: ClaimDetailStatus;
  message?: string;
  claim?: Claim;
  /** BE audit timeline (oldest-first). Present only when `status === "ready"`. */
  audit?: BackendAuditEntry[];
}

export interface UseClaimDetail {
  state: ClaimDetailState;
  reload: () => void;
}

/**
 * Fetch a single claim + its audit timeline. `viewerId` is accepted for
 * signature compatibility; the BE authorises by session + ownership, and a
 * cross-employee access returns 403 which maps to the `denied` branch.
 */
export function useClaimDetail(
  claimId: string,
  _viewerId: string,
): UseClaimDetail {
  const [version, setVersion] = React.useState(0);
  const [state, setState] = React.useState<ClaimDetailState>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const claim = await getClaim(claimId);
        if (cancelled) return;
        // Audit is best-effort: a participant always has access (the GET
        // claim above already enforced ownership for employees), but a
        // transient failure should not blank the whole page — fall back to an
        // empty timeline and keep the claim visible.
        let audit: BackendAuditEntry[] = [];
        try {
          audit = await getClaimAudit(claimId);
        } catch {
          audit = [];
        }
        if (!cancelled) setState({ status: "ready", claim, audit });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ClaimApiError) {
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

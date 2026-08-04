"use client";

/* ============================================================================
 * SpendFlow — useClaimAudit (ticket #22, FE wiring).
 * HTTP-backed: reads `GET /api/claims/:id/audit` via `@/lib/api/audit`. The BE
 * gates the route to claim participants and rejects everyone else with 403
 * `forbidden`; a nonexistent claim 404s — those map to `denied` / `notfound`.
 * The audit trail is append-only and this hook only ever reads it, so the
 * viewer stays strictly read-only. Entries come back chronological (oldest
 * first) from the BE.
 *
 * The hook's public interface (`{ state, reload }`) is unchanged from the
 * mock version so the page keeps its shape.
 * ========================================================================== */

import * as React from "react";
import { getAudit, AuditApiError, type BackendAuditEntry } from "@/lib/api/audit";

export type AuditStatus = "loading" | "ready" | "notfound" | "denied" | "error";

export interface AuditState {
  status: AuditStatus;
  items: BackendAuditEntry[];
  message?: string;
}

export interface UseClaimAudit {
  state: AuditState;
  reload: () => void;
}

export function useClaimAudit(claimId: string): UseClaimAudit {
  const [version, setVersion] = React.useState(0);
  const [state, setState] = React.useState<AuditState>({
    status: "loading",
    items: [],
  });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", items: [] });

    (async () => {
      try {
        const entries = await getAudit(claimId);
        if (cancelled) return;
        setState({ status: "ready", items: entries });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuditApiError) {
          if (err.status === 404) {
            setState({ status: "notfound", items: [] });
          } else if (err.status === 403) {
            setState({ status: "denied", items: [] });
          } else {
            setState({ status: "error", items: [], message: err.message });
          }
        } else {
          setState({
            status: "error",
            items: [],
            message: err instanceof Error ? err.message : "Failed to load the audit trail.",
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

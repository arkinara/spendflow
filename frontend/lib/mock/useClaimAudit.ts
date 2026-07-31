"use client";

import * as React from "react";
import { auditForClaim, type AuditEntry } from "@/lib/mock/mock_data";

/**
 * Simulated async fetch of a claim's immutable audit trail. Audit rows are
 * append-only: this hook only ever reads them (never mutates), so the viewer
 * is strictly read-only. The trail is sorted ascending by timestamp
 * (oldest first) by {@link auditForClaim}.
 *
 * Mirrors {@link useClaimDetail}: a brief loading skeleton, an explicit error
 * state with retry, and a `reload()` that re-reads the live `auditLog`.
 */
export type AuditStatus = "loading" | "ready" | "error";

export interface AuditState {
  status: AuditStatus;
  items: AuditEntry[];
  message?: string;
}

export interface UseClaimAudit {
  state: AuditState;
  reload: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useClaimAudit(claimId: string): UseClaimAudit {
  const [version, setVersion] = React.useState(0);
  const [state, setState] = React.useState<AuditState>({
    status: "loading",
    items: [],
  });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", items: [] });
    const timer = window.setTimeout(() => {
      try {
        const items = auditForClaim(claimId);
        if (cancelled) return;
        setState({ status: "ready", items });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            items: [],
            message: err instanceof Error ? err.message : "Failed to load the audit trail.",
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

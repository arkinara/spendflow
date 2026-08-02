"use client";

/* ============================================================================
 * SpendFlow — useEmployeeDashboard (ticket #18, FE wiring).
 * HTTP-backed: reads the caller's claims from `GET /api/claims` and shapes
 * them via the pure `buildDashboard` selector. The mock-backed
 * `loadEmployeeDashboard` is retained in `dashboard.ts` as a fallback for the
 * other verticals (#19–#23). The hook's public interface (`{ state, retry }`)
 * is unchanged so the dashboard page does not change shape.
 * ========================================================================== */

import * as React from "react";
import { listClaims, ClaimApiError } from "@/lib/api/claims";
import { buildDashboard, type EmployeeDashboardData } from "@/lib/mock/dashboard";

export type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: EmployeeDashboardData }
  | { status: "error"; message: string };

export interface UseEmployeeDashboard {
  state: DashboardState;
  retry: () => void;
}

/**
 * Build the dashboard payload from the BE-backed claim list. `employeeId` is
 * accepted for signature compatibility; the BE infers identity from the
 * session cookie. There is no dedicated BE dashboard endpoint, so counts /
 * status summary / recently-paid are computed client-side from the claim rows
 * via the shared pure selector (`buildDashboard`).
 */
export function useEmployeeDashboard(employeeId: string): UseEmployeeDashboard {
  const [state, setState] = React.useState<DashboardState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const claims = await listClaims();
        if (cancelled) return;
        setState({ status: "ready", data: buildDashboard(employeeId, claims) });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ClaimApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load dashboard.";
        setState({ status: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [employeeId, attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}

"use client";

/* ============================================================================
 * SpendFlow — useEmployeeClaims (ticket #18, FE wiring).
 * HTTP-backed: reads the caller's claims from `GET /api/claims` via
 * `lib/api/claims.ts`. The mock `claimStore` is no longer the data source for
 * the Employee vertical (kept as fallback for #19–#23). The hook's public
 * interface (`{ state, retry, refresh }`) is unchanged so the list page does
 * not need to change shape.
 * ========================================================================== */

import * as React from "react";
import {
  listClaims,
  ClaimApiError,
  type ClaimListFilters,
} from "@/lib/api/claims";
import type { Claim } from "@/lib/types";

export type ClaimsListState =
  | { status: "loading" }
  | { status: "ready"; claims: Claim[] }
  | { status: "error"; message: string };

export interface UseEmployeeClaims {
  state: ClaimsListState;
  retry: () => void;
  /** Force a fresh read of the BE (e.g. after navigating back). */
  refresh: () => void;
}

/**
 * Fetch the signed-in employee's claims. `employeeId` is accepted for
 * signature compatibility with the prior mock-backed hook (and so existing
 * callers compile unchanged) but is NOT sent: the BE infers identity from the
 * session cookie. Optional `filters` map to the `?status=` query.
 */
export function useEmployeeClaims(
  _employeeId: string,
  filters?: ClaimListFilters,
): UseEmployeeClaims {
  const [state, setState] = React.useState<ClaimsListState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  const filterKey = filters?.status?.join(",") ?? "";

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    const filtersObj: ClaimListFilters | undefined = filterKey
      ? { status: filterKey.split(",") as ClaimListFilters["status"] }
      : undefined;

    (async () => {
      try {
        const claims = await listClaims(filtersObj);
        if (!cancelled) setState({ status: "ready", claims });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ClaimApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load your claims.";
        setState({ status: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = React.useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry, refresh };
}

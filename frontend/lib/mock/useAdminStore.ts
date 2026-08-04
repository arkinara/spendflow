"use client";

/* ============================================================================
 * SpendFlow — useAdminStore (ticket #21, FE wiring).
 * HTTP-backed: reads `GET /api/admin/categories|policies|routes` via
 * `lib/api/admin.ts`. The mock `adminStore`/`mock_data` collections are no
 * longer the data source for this vertical (kept as fallback for #22–#24).
 *
 * The hook's public interface (`{ state, retry, refresh }`) is unchanged so
 * `/finance/policies` doesn't need to change shape — only the row data type
 * moves from the FE mock `ExpenseCategory`/`Policy`/`RoutingRule` to the
 * BE-backed `AdminCategory`/`AdminPolicy`/`AdminRoute` (`lib/api/admin.ts`).
 * A BE 403 (caller lost Finance-Admin standing mid-session) maps to a
 * `denied` state so the page can render the same access-denied panel
 * `RouteGuard` shows for a role mismatch, instead of a bare error toast.
 * ========================================================================== */

import * as React from "react";
import {
  listCategories,
  listPolicies,
  listRoutes,
  AdminApiError,
  type AdminCategory,
  type AdminPolicy,
  type AdminRoute,
} from "@/lib/api/admin";

export type AdminListState<T> =
  | { status: "loading" }
  | { status: "ready"; rows: T[] }
  | { status: "error"; message: string }
  | { status: "denied" };

export interface UseAdminCollection<T> {
  state: AdminListState<T>;
  retry: () => void;
  /** Force a fresh read of the BE (e.g. after a CRUD action). */
  refresh: () => void;
}

function useAdminCollection<T>(load: () => Promise<T[]>): UseAdminCollection<T> {
  const [state, setState] = React.useState<AdminListState<T>>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const rows = await load();
        if (!cancelled) setState({ status: "ready", rows });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AdminApiError && err.status === 403) {
          setState({ status: "denied" });
        } else {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load admin data.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
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

/** Every expense category (active + inactive) — the Category admin list. */
export function useCategories(): UseAdminCollection<AdminCategory> {
  return useAdminCollection(() => listCategories());
}

/** Every spend policy (active + inactive) — the Policy admin list. */
export function usePolicies(): UseAdminCollection<AdminPolicy> {
  return useAdminCollection(() => listPolicies());
}

/** Every approval route (active + inactive, incl. fallback) — the Routing list. */
export function useRoutes(): UseAdminCollection<AdminRoute> {
  return useAdminCollection(() => listRoutes());
}

/**
 * Live preview of the categories surfaced in the employee claim builder.
 * Reflects create/deactivate mutations immediately so the Finance Admin can
 * see the employee-facing impact without leaving the console (DoD).
 */
export function useActiveCategoriesPreview(): UseAdminCollection<AdminCategory> {
  return useAdminCollection(async () => (await listCategories()).filter((c) => c.active));
}

"use client";

/* ============================================================================
 * SpendFlow — useUsers (ticket #30, FE wiring).
 *
 * HTTP-backed: reads `GET /api/admin/users` via `lib/api/users.ts`. The hook's
 * public surface (`{ state, retry, refresh }`) mirrors `useAdminStore` (#21) so
 * the page follows the same shape. A BE 403 (caller lost Finance-Admin
 * standing mid-session) maps to a `denied` state so the page can render the
 * same access-denied panel `RouteGuard` shows for a role mismatch, instead of
 * a bare error toast. 401 is handled globally by `apiFetch` — not re-handled
 * here.
 *
 * `bulkChangeRole` (#32) wraps the sequential `lib/api/users.ts` loop: on
 * success it re-reads the directory via `refresh()`; on a partial failure it
 * rethrows `BulkPartialFailureError` untouched so the dialog can show the
 * failing user ids, and leaves the local cache as-is (the partially-updated
 * list stays visible until the user retries or refreshes).
 * ========================================================================== */

import * as React from "react";
import {
  bulkChangeRole as bulkChangeRoleApi,
  listUsers,
  UsersApiError,
  type BackendUser,
} from "@/lib/api/users";
import type { Role } from "@/lib/types";

export type UsersListState =
  | { status: "loading" }
  | { status: "ready"; rows: BackendUser[] }
  | { status: "error"; message: string }
  | { status: "denied" };

export interface UseUsers {
  state: UsersListState;
  retry: () => void;
  /** Force a fresh read of the BE (e.g. after a role/manager mutation). */
  refresh: () => void;
  /** Bulk-change the role of many users (#32). Re-reads the directory on
   *  success; rethrows `BulkPartialFailureError` on a partial failure without
   *  touching the cache. */
  bulkChangeRole: (userIds: string[], newRole: Role) => Promise<BackendUser[]>;
}

export function useUsers(): UseUsers {
  const [state, setState] = React.useState<UsersListState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const rows = await listUsers();
        if (!cancelled) setState({ status: "ready", rows });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UsersApiError && err.status === 403) {
          setState({ status: "denied" });
        } else {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load the user directory.",
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

  const bulkChangeRole = React.useCallback(
    async (userIds: string[], newRole: Role): Promise<BackendUser[]> => {
      const rows = await bulkChangeRoleApi(userIds, newRole);
      refresh();
      return rows;
    },
    [refresh],
  );

  return { state, retry, refresh, bulkChangeRole };
}

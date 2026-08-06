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
 *
 * `deactivate`/`reactivate` (#33) update the cache optimistically — the status
 * chip flips without a refetch — and reconcile on success; on failure the row
 * rolls back to its prior status and the error rethrows so the confirm dialog
 * can surface it inline. NOTE: the BE does not persist `status` yet, so a
 * later `refresh()` will drop the optimistic flip (documented caveat).
 * ========================================================================== */

import * as React from "react";
import {
  bulkChangeRole as bulkChangeRoleApi,
  deactivate as deactivateApi,
  listUsers,
  reactivate as reactivateApi,
  UsersApiError,
  type BackendUser,
} from "@/lib/api/users";
import type { Role, UserStatus } from "@/lib/types";

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
  /** Soft-deactivate a user (#33): flips the row's `status` to `"disabled"`
   *  optimistically (chip updates without a refetch), keeps it on API success,
   *  rolls back and rethrows on failure so the dialog can show the inline
   *  error. */
  deactivate: (userId: string) => Promise<BackendUser>;
  /** Soft-reactivate a user (#33): mirror of {@link deactivate} → `"active"`. */
  reactivate: (userId: string) => Promise<BackendUser>;
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

  /**
   * Optimistic status flip shared by `deactivate`/`reactivate` (#33). The row's
   * `status` is set immediately (no refetch — the chip flips in place); on API
   * success the returned user reconciles the cache; on failure the row rolls
   * back to its prior status and the error is rethrown.
   */
  const setStatus = React.useCallback(
    async (userId: string, next: UserStatus): Promise<BackendUser> => {
      const rows = state.status === "ready" ? state.rows : [];
      const target = rows.find((u) => u.id === userId);
      const prior = target?.status;

      if (state.status === "ready") {
        setState({
          status: "ready",
          rows: rows.map((u) =>
            u.id === userId ? { ...u, status: next } : u,
          ),
        });
      }

      try {
        const updated =
          next === "disabled"
            ? await deactivateApi(userId)
            : await reactivateApi(userId);
        setState((prev) =>
          prev.status === "ready"
            ? {
                status: "ready",
                rows: prev.rows.map((u) => (u.id === userId ? updated : u)),
              }
            : prev,
        );
        return updated;
      } catch (err) {
        if (prior !== undefined) {
          setState((prev) =>
            prev.status === "ready"
              ? {
                  status: "ready",
                  rows: prev.rows.map((u) =>
                    u.id === userId ? { ...u, status: prior } : u,
                  ),
                }
              : prev,
          );
        }
        throw err;
      }
    },
    [state],
  );

  const deactivate = React.useCallback(
    (userId: string) => setStatus(userId, "disabled"),
    [setStatus],
  );
  const reactivate = React.useCallback(
    (userId: string) => setStatus(userId, "active"),
    [setStatus],
  );

  return { state, retry, refresh, bulkChangeRole, deactivate, reactivate };
}

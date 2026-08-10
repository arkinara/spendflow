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
 *
 * `deleteUser` (#43) is non-optimistic: the row is removed from the cache only
 * after the BE confirms the hard delete (204), so a cancelled/mistyped
 * password never blanks a row that still exists server-side. On failure the
 * error rethrows untouched for the dialog's inline message.
 * ========================================================================== */

import * as React from "react";
import {
  bulkChangeRole as bulkChangeRoleApi,
  createUser as createUserApi,
  deactivate as deactivateApi,
  deleteUser as deleteUserApi,
  getUserAudit as getUserAuditApi,
  listUsers,
  reactivate as reactivateApi,
  UsersApiError,
  type BackendUser,
  type CreateUserInput,
  type CreateUserResult,
  type UserAuditFilters,
} from "@/lib/api/users";
import type { Role, UserStatus, UserAuditEntry } from "@/lib/types";

export type UsersListState =
  | { status: "loading" }
  | { status: "ready"; rows: BackendUser[] }
  | { status: "error"; message: string }
  | { status: "denied" };

/** State machine for `useUserAudit` (#34): same shape as `UsersListState`. */
export type UserAuditState =
  | { status: "loading" }
  | { status: "ready"; entries: UserAuditEntry[] }
  | { status: "error"; message: string }
  | { status: "denied" };

export interface UseUserAudit {
  state: UserAuditState;
  /** Force a fresh fan-out read of the BE (the "Refresh" button). */
  refresh: () => void;
}

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
  /** Create a pending user + invite (#36): POSTs `createUser`, then prepends
   *  the new `status: "pending"` row to the local cache so it appears without a
   *  refetch. Returns the full BE envelope (incl. `devHint` when in
   *  dev/sandbox mode, #57b) so the AddUser toast can surface the invite URL.
   *  On failure the cache stays unchanged and the error rethrows so the dialog
   *  can surface it inline (e.g. 409 `email_exists`). */
  createUser: (input: CreateUserInput) => Promise<CreateUserResult>;
  /** Hard-delete a user (#43): POSTs the actor's password via `deleteUser`,
   *  then removes the row from the cache so the table re-renders without a
   *  refetch. On failure the cache is untouched and the error rethrows so the
   *  confirmation dialog can show it inline (401 `invalid_password`, 409
   *  `cannot_delete_active_user`, …). */
  deleteUser: (userId: string, password: string) => Promise<void>;
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

  /** #36: on success prepend the new pending row to the cache (no refetch); on
   *  failure leave the cache untouched and rethrow for the dialog's inline
   *  error. */
  const createUser = React.useCallback(
    async (input: CreateUserInput): Promise<CreateUserResult> => {
      const result = await createUserApi(input);
      setState((prev) =>
        prev.status === "ready"
          ? { status: "ready", rows: [result.user, ...prev.rows] }
          : prev,
      );
      return result;
    },
    [],
  );

  /** #43: on success remove the deleted row from the cache (the table re-renders
   *  without a refetch); on failure leave the cache untouched and rethrow so the
   *  dialog can surface the inline error (401 `invalid_password`, …). */
  const deleteUser = React.useCallback(
    async (userId: string, password: string): Promise<void> => {
      await deleteUserApi(userId, password);
      setState((prev) =>
        prev.status === "ready"
          ? {
              status: "ready",
              rows: prev.rows.filter((u) => u.id !== userId),
            }
          : prev,
      );
    },
    [],
  );

  return {
    state,
    retry,
    refresh,
    bulkChangeRole,
    deactivate,
    reactivate,
    createUser,
    deleteUser,
  };
}

/* =========================================================================== */

/** `useUserAudit` (#34) — reads the admin audit trail for a set of user ids.
 *  Same state machine as `useUsers` (loading | ready | error | denied), wired
 *  to the collapsible "Recent activity" section on `/finance/users`. When
 *  `filters` is `null` the hook sits `ready` with empty entries and makes no
 *  network calls (the collapsed-by-default path). Passing filters fans out one
 *  `GET /api/admin/users/:id/audit` per id; the fetch re-runs when the
 *  `userIds` array reference changes. A BE 403 maps to `denied`; anything else
 *  to `error` with the BE message. 401 is handled globally by `apiFetch`. */
export function useUserAudit(filters: UserAuditFilters | null): UseUserAudit {
  const [state, setState] = React.useState<UserAuditState>({ status: "loading" });
  const [version, setVersion] = React.useState(0);
  // Serialize the array reference so callers that pass a fresh `userIds`
  // literal every render don't trigger an effect loop (and an OOM). The id
  // list is stable for a given directory + filter state, so a sorted join is
  // a safe identity.
  const userIdsKey = filters?.userIds ? [...filters.userIds].sort().join("|") : null;
  const limit = filters?.limit;

  React.useEffect(() => {
    if (userIdsKey === null) {
      setState({ status: "ready", entries: [] });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const entries = await getUserAuditApi({
          userIds: userIdsKey.split("|"),
          limit,
        });
        if (!cancelled) setState({ status: "ready", entries });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UsersApiError && err.status === 403) {
          setState({ status: "denied" });
        } else {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load the audit trail.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
      }, [userIdsKey, limit, version]);

  const refresh = React.useCallback(() => setVersion((v) => v + 1), []);
  return { state, refresh };
}

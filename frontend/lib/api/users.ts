/* ============================================================================
 * SpendFlow — User-directory admin HTTP client (ticket #30, FE wiring).
 *
 * Thin typed wrapper over the finance-only user endpoints (BE #14, mounted in
 * `backend/src/app.ts`):
 *   - GET   /api/admin/users          → list every user
 *   - PATCH /api/admin/users/:id/role   → change a user's role
 *   - PATCH /api/admin/users/:id/manager → set or clear a user's manager
 *
 * Every call goes through `apiFetch` (#17): `credentials: "include"` session
 * cookie, `NEXT_PUBLIC_BE_URL` resolution, and the global 401 handler. Non-2xx
 * responses are thrown as `UsersApiError` carrying the backend's `code` +
 * `message` so the UI can branch on the typed error code. Actual codes the BE
 * emits (see `services/users.ts` + `app.ts`):
 *
 * Bulk role change (#32): the BE has no `/api/admin/users/bulk/role` endpoint
 * yet, so `bulkChangeRole` falls back to a sequential loop over
 * `changeUserRole` — one `PATCH` per user, one audit entry each (N entries,
 * not one batch). Any failure surfaces as `BulkPartialFailureError` with a
 * `details` list of the failing user ids.
 *   - `forbidden`       (403) — caller is not a Finance Admin
 *   - `not_found`       (404) — unknown user id
 *   - `invalid_role`    (400) — role is not one of employee/approver/finance
 *   - `invalid_manager` (400) — manager id does not exist
 *   - `self_manager`    (400) — a user cannot be their own manager
 *   - `cycle`           (400) — assignment would create a circular reporting line
 *   - `invalid_body`    (400) — body failed zod parse
 *
 * Soft deactivation (#33): the BE has no `/api/admin/users/:id/deactivate` or
 * `/reactivate` endpoints yet, so `deactivate`/`reactivate` PATCH the user's
 * `status` field through the existing role endpoint (`changeUserRole` with a
 * same-role body). **The BE does not persist `status`** — the returned row is
 * reconciled to the requested status client-side so the optimistic cache stays
 * truthful. The BE will reject with one of the codes below once it lands:
 *   - `cannot_deactivate_self`        (400) — a user cannot deactivate themselves
 *   - `cannot_deactivate_last_finance` (400) — the last active Finance Admin
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";
import type { Role, UserStatus } from "@/lib/types";

/** `PublicUser` from `backend/src/types.ts` — ISO date strings over the wire,
 *  never includes the password hash. `status` is the soft-activation flag
 *  (#33): the FE sends it in PATCH bodies as a forward-compatible placeholder,
 *  but the BE does not persist it yet — treat the field as client-side state
 *  until a real deactivate endpoint lands. */
export interface BackendUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: Role;
  managerId: string | null;
  department: string | null;
  costCenter: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

/** Typed error carrying the backend's status + code + message. */
export class UsersApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "UsersApiError";
    this.status = status;
    this.code = code;
  }
}

/** One failing user inside a `BulkPartialFailureError` (code `partial_failure`). */
export interface BulkFailureDetail {
  userId: string;
  error: UsersApiError;
}

/** Thrown by `bulkChangeRole` when at least one user in the batch fails. */
export class BulkPartialFailureError extends UsersApiError {
  readonly details: BulkFailureDetail[];
  constructor(details: BulkFailureDetail[], succeeded: number, total: number) {
    super(
      0,
      "partial_failure",
      `${succeeded} of ${total} users updated; ${details.length} failed.`,
    );
    this.name = "BulkPartialFailureError";
    this.details = details;
  }
}

/* --------------------------------------------------------------- error helper */

async function readError(res: Response): Promise<never> {
  let code = "internal";
  let message = `Request failed (${res.status}).`;
  try {
    const body = await res.json();
    const err = body?.error;
    if (err && typeof err === "object") {
      if (typeof err.code === "string") code = err.code;
      if (typeof err.message === "string" && err.message.trim()) message = err.message;
    } else if (typeof err === "string" && err.trim()) {
      message = err;
    } else if (typeof body?.message === "string" && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // non-JSON body — keep the status-derived fallback
  }
  throw new UsersApiError(res.status, code, message);
}

/** Read + parse a JSON envelope, throwing `UsersApiError` on non-2xx. */
async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) await readError(res);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UsersApiError(res.status, "internal", "Invalid JSON response from backend.");
  }
}

/* ========================================================================= */

/** `GET /api/admin/users` — every user in the directory, ordered by name. */
export async function listUsers(): Promise<BackendUser[]> {
  const body = await parseJson<{ users: BackendUser[] }>(
    await apiFetch(`/api/admin/users`, { method: "GET" }),
  );
  return body.users;
}

/** `PATCH /api/admin/users/:id/role`. 400 `invalid_role`/`not_found`. `status`
 *  is sent along with the role as a forward-compatible placeholder (#33); it
 *  defaults to `"active"` for callers (bulk/plain role change) that don't track
 *  per-user activation. */
export async function changeUserRole(
  userId: string,
  newRole: Role,
  status: UserStatus = "active",
): Promise<BackendUser> {
  const body = await parseJson<{ user: BackendUser }>(
    await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: newRole, status }),
    }),
  );
  return body.user;
}

/** Current row for a user (used by `deactivate`/`reactivate` to re-send the
 *  same role the user already holds — the status rides along on the role PATCH). */
async function requireUser(userId: string): Promise<BackendUser> {
  const users = await listUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new UsersApiError(404, "not_found", "User not found.");
  return user;
}

/** Soft-deactivate a user (#33): PATCH `status: "disabled"` through the role
 *  endpoint, keeping their existing role. Returns the row reconciled to
 *  `status: "disabled"` (the BE doesn't persist the flag yet). */
export async function deactivate(userId: string): Promise<BackendUser> {
  const user = await requireUser(userId);
  const updated = await changeUserRole(userId, user.role, "disabled");
  return { ...updated, status: "disabled" };
}

/** Soft-reactivate a user (#33): inverse of {@link deactivate}. */
export async function reactivate(userId: string): Promise<BackendUser> {
  const user = await requireUser(userId);
  const updated = await changeUserRole(userId, user.role, "active");
  return { ...updated, status: "active" };
}

/** `PATCH /api/admin/users/:id/manager` — pass `null` to clear the manager.
 *  400 `self_manager`/`cycle`/`invalid_manager`, 404 `not_found`. */
export async function setUserManager(
  userId: string,
  managerId: string | null,
): Promise<BackendUser> {
  const body = await parseJson<{ user: BackendUser }>(
    await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/manager`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ managerId }),
    }),
  );
  return body.user;
}

/** Bulk role change (#32) — sequential `PATCH /api/admin/users/:id/role` per
 *  user (the BE has no bulk endpoint yet). Returns every updated user on a
 *  fully-clean run; throws `BulkPartialFailureError` (`code:
 *  "partial_failure"`) as soon as any user fails, with `details` listing each
 *  failing user id + error so the UI can show them inline. An empty input
 *  short-circuits to `[]` with no network calls. */
export async function bulkChangeRole(
  userIds: string[],
  newRole: Role,
): Promise<BackendUser[]> {
  if (userIds.length === 0) return [];
  const updated: BackendUser[] = [];
  const details: BulkFailureDetail[] = [];
  for (const userId of userIds) {
    try {
      updated.push(await changeUserRole(userId, newRole));
    } catch (err) {
      details.push({
        userId,
        error:
          err instanceof UsersApiError
            ? err
            : new UsersApiError(0, "network", err instanceof Error ? err.message : String(err)),
      });
    }
  }
  if (details.length > 0) {
    throw new BulkPartialFailureError(details, updated.length, userIds.length);
  }
  return updated;
}

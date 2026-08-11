/* ============================================================================
 * SpendFlow — User-directory admin HTTP client (ticket #30, FE wiring).
 *
 * Thin typed wrapper over the finance-only user endpoints (BE #14, mounted in
 * `backend/src/app.ts`):
 *   - GET   /api/admin/users          → list every user
 *   - GET   /api/admin/users/:id/audit → audit entries for one user (#34)
 *   - PATCH /api/admin/users/:id/role   → change a user's role
 *   - PATCH /api/admin/users/:id/manager → set or clear a user's manager
 *   - POST  /api/admin/users          → create a pending user + invite (#36)
 *   - GET   /api/admin/invites/:token (public) → invite details (#36)
 *   - POST  /api/admin/invites/:token/accept (public) → set password + activate (#36)
 *   - POST  /api/admin/users/:id/delete → hard-delete a pending/disabled user (#43)
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
 *
 * Invite flow (#36): `createUser` emits `email_exists` (409, duplicate email),
 * `invalid_email` (400, bad email format), `forbidden` (403, not a Finance
 * Admin), or `validation` (400, other body errors). `getInvite` emits
 * `invite_invalid` (404, unknown token), `invite_expired` (410), or
 * `invite_consumed` (410). `acceptInvite` emits `invalid_password` (400, below
 * the BE password policy) plus the invite codes above.
 *
 * Hard delete (#43): `deleteUser` POSTs the actor's own password as
 * re-authentication (BE #41/#42) and resolves on 204. Errors: 401
 * `invalid_password` (actor's password did not verify), 409
 * `cannot_delete_active_user` (target is still active — deactivate first), 403
 * `forbidden` (not a Finance Admin), 404 `not_found`. Unlike every other call
 * in this module, `deleteUser` does NOT ride `apiFetch`'s global 401 handler:
 * a 401 here means "wrong password" or an idle-session re-auth failure — both
 * must surface inline in the confirmation dialog rather than force a login
 * redirect (see the method doc for rationale).
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";
import { BE_URL } from "@/lib/auth/apiClient";
import type { Role, UserStatus, UserAuditEntry } from "@/lib/types";

export type { UserAuditEntry };

/** `PublicUser` from `backend/src/types.ts` — ISO date strings over the wire,
 *  never includes the password hash. `status` is the soft-activation flag
 *  (#33): the FE sends it in PATCH bodies as a forward-compatible placeholder,
 *  but the BE does not persist it yet — treat the field as client-side state
 *  until a real deactivate endpoint lands.
 *
 *  `roles`/`primaryRole` mirror the BE `PublicUser` from #44 onward; optional
 *  on the FE wire type so the admin client tolerates partial test mocks and
 *  any BE drift. Callers that need the multi-role view should default missing
 *  fields from `role` (the single-role compat field the BE still emits). */
export interface BackendUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: Role;
  roles?: Role[];
  primaryRole?: Role;
  managerId: string | null;
  department: string | null;
  costCenter: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

/** Payload for `POST /api/admin/users` (#36, multi-role #53) — a Finance
 *  Admin provisions a new user who must still accept their invite before
 *  signing in. Exactly one of `role` (legacy single-role) or `roles`
 *  (multi-role) must be present; the BE rejects both-or-neither with 400
 *  `invalid_body`. */
export interface CreateUserInput {
  email: string;
  name: string;
  role?: Role;
  roles?: Role[];
  managerId?: string;
  department?: string;
  jobTitle?: string;
}

/** Invite envelope returned by `POST /api/admin/users` (#36). */
export interface InviteToken {
  token: string;
  sentAt: string;
  expiresAt: string;
}

/** Dev/sandbox delivery hint returned by `POST /api/admin/users` when the BE
 *  fell back to writing the invite URL to `backend/logs/invites.log` (#57b) —
 *  i.e. `RESEND_API_KEY` is unset or the delivery raised `EmailConfigError`.
 *  Absent in production: real email sends carry no hint. */
export interface DevHint {
  sandbox: boolean;
  inviteUrl: string;
}

/** Full envelope from `POST /api/admin/users` (#36, #57b). `devHint` is only
 *  present in dev/sandbox mode. */
export interface CreateUserResult {
  user: BackendUser;
  invite: InviteToken;
  devHint?: DevHint;
}

/** Invite details from `GET /api/admin/invites/:token` (public, #36). The BE
 *  returns `costCenter` (the DB column the create flow persists); `jobTitle`
 *  is kept for the mock-era surface and is `null` from the real BE. */
export interface InviteDetails {
  email: string;
  name: string;
  role: Role;
  managerId: string | null;
  department: string | null;
  jobTitle: string | null;
  costCenter: string | null;
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

/** `PATCH /api/admin/users/:id/role` — multi-role variant (#53). Accepts a
 *  full `roles` array (the BE replaces the role set). 400 `invalid_body` on
 *  an empty/unknown-role array, 400 `cannot_demote_last_finance` if the
 *  change would strip the last active Finance Admin, 400
 *  `cannot_remove_only_approver_with_reports` if it would strip `approver`
 *  from a user with direct reports. `status` rides along as a
 *  forward-compatible placeholder (#33).
 *
 *  `password` (#64) is the actor's own password — the BE verifies it via
 *  `requirePasswordReauth` before mutating anything (401 `invalid_password`
 *  on mismatch). Optional here so non-destructive delegates (bulk, soft
 *  deactivate) keep their current signatures; the RoleChangeDialog always
 *  passes it and refuses to submit until it is non-empty. */
export async function changeUserRoles(
  userId: string,
  newRoles: Role[],
  status: UserStatus = "active",
  password?: string,
): Promise<BackendUser> {
  const body = await parseJson<{ user: BackendUser }>(
    await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roles: newRoles,
        status,
        ...(password ? { password } : {}),
      }),
    }),
  );
  return body.user;
}

/** `PATCH /api/admin/users/:id/role` — legacy single-role variant (#53
 *  back-compat). Wraps {@link changeUserRoles} with a one-element array.
 *  400 `invalid_role`/`not_found`. `status` is sent along with the role as a
 *  forward-compatible placeholder (#33); it defaults to `"active"` for
 *  callers (bulk/plain role change) that don't track per-user activation.
 *  `password` (#64) forwards to {@link changeUserRoles} — see its doc. */
export async function changeUserRole(
  userId: string,
  newRole: Role,
  status: UserStatus = "active",
  password?: string,
): Promise<BackendUser> {
  return changeUserRoles(userId, [newRole], status, password);
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

/** Hard-delete a user (#43): `POST /api/admin/users/:id/delete` with the
 *  actor's own password as re-authentication (BE #41/#42). Only offered for
 *  `status: "pending"` or `"disabled"` rows — the BE rejects a delete of an
 *  `"active"` user with 409 `cannot_delete_active_user`. Success is `204` with
 *  no body. Errors: 401 `invalid_password`, 403 `forbidden`, 404 `not_found`,
 *  409 `cannot_delete_active_user`.
 *
 *  NOTE: deliberately bypasses `apiFetch`'s global 401 handler. A 401 here
 *  means the actor mistyped their own password or the session expired since the
 *  dialog opened — both must surface inline in the confirmation dialog, not
 *  hard-redirect to `/login`. The request is otherwise identical to `apiFetch`
 *  (`credentials: "include"`, `BE_URL` resolution). */
export async function deleteUser(userId: string, password: string): Promise<void> {
  const res = await fetch(
    `${BE_URL}/api/admin/users/${encodeURIComponent(userId)}/delete`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }
  );
  if (!res.ok) await readError(res);
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

/* --------------------------------------------------------------- audit (#34) */

/** Filters the admin audit view composes from (#34). `userIds` is the
 *  directory subset whose per-user audit trails get fanned out. */
export interface UserAuditFilters {
  userIds: string[];
  limit?: number;
}

/** `GET /api/admin/users/:id/audit` fan-out (#34). The BE only exposes the
 *  per-user audit endpoint — no directory-wide batch on the wire — so this
 *  makes one request per user via `Promise.all`, merges the results, sorts
 *  newest-first, and caps at `limit` (default 50). An empty `userIds`
 *  short-circuits to `[]` with no network calls. Any single fetch failure
 *  aborts the whole call with a `UsersApiError` coded `audit_unavailable`. */
export async function getUserAudit({
  userIds,
  limit = 50,
}: UserAuditFilters): Promise<UserAuditEntry[]> {
  if (userIds.length === 0) return [];
  try {
    const perUser = await Promise.all(
      userIds.map(async (userId) => {
        const body = await parseJson<{ entries: UserAuditEntry[] }>(
          await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/audit`, {
            method: "GET",
          }),
        );
        return body.entries ?? [];
      }),
    );
    const merged = perUser.flat();
    merged.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return merged.slice(0, limit);
  } catch (err) {
    throw new UsersApiError(
      0,
      "audit_unavailable",
      err instanceof Error ? err.message : "Failed to load the audit trail.",
    );
  }
}

/* ----------------------------------------------- global audit (#71) */

/** Filters for the directory-wide audit view (#71). Mirrors the BE's
 *  `AuditAllFilters` (`backend/src/services/audit.ts`). `from`/`to` are
 *  unix-seconds bounds against `audit_logs.created_at` (inclusive). */
export interface AuditAllFilters {
  action?: string;
  from?: number;
  to?: number;
  actorId?: string;
  targetUserId?: string;
  limit?: number;
}

/** `GET /api/admin/audit` (#71) — directory-wide audit view filtered by action,
 *  actor, target user, and/or date range. Returns entries newest-first,
 *  capped at `limit` (default 100, max 500). Finance role only (403 otherwise).
 *  Errors: 403 `forbidden`, 401 (handled globally by `apiFetch`). */
export async function getGlobalAudit(
  filters: AuditAllFilters = {},
): Promise<UserAuditEntry[]> {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.actorId) params.set("actor_id", filters.actorId);
  if (filters.targetUserId) params.set("target_user_id", filters.targetUserId);
  if (filters.from !== undefined) params.set("from", String(filters.from));
  if (filters.to !== undefined) params.set("to", String(filters.to));
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  const path = qs ? `/api/admin/audit?${qs}` : "/api/admin/audit";
  const body = await parseJson<{ entries: UserAuditEntry[] }>(
    await apiFetch(path, { method: "GET" }),
  );
  return body.entries;
}

/* ----------------------------------------------- invite flow (#36) */

/** `POST /api/admin/users` (#36) — create a `status: "pending"` user + invite.
 *  Finance Admin only (BE enforces with 403 `forbidden`). Returns the pending
 *  user plus the single-use invite envelope (`token`, `sentAt`, `expiresAt`).
 *  In dev/sandbox mode the BE also returns `devHint` (#57b) with the invite
 *  URL for the log fallback — surfaced by the AddUser dialog toast.
 *  Errors: 409 `email_exists`, 400 `invalid_body`/`invalid_role`/`not_found`
 *  (bad manager id). */
export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  return parseJson<CreateUserResult>(
    await apiFetch(`/api/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

/** `GET /api/admin/invites/:token` (#36, public) — validate an invite token and
 *  return the invitee's details. Errors: 404 `invite_invalid`, 410
 *  `invite_expired`, 410 `invite_consumed`. */
export async function getInvite(token: string): Promise<InviteDetails> {
  return parseJson<InviteDetails>(
    await apiFetch(`/api/admin/invites/${encodeURIComponent(token)}`, {
      method: "GET",
    }),
  );
}

/** `POST /api/admin/invites/:token/accept` (#36, public) — set the password,
 *  activate the user, and mint a real session cookie (the browser stores it as
 *  httpOnly; the FE never reads it). Errors: 400 `invalid_password` (BE-enforced
 *  password policy), 404 `invite_invalid`, 410 `invite_consumed`/`invite_expired`. */
export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ user: BackendUser }> {
  return parseJson<{ user: BackendUser }>(
    await apiFetch(`/api/admin/invites/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );
}

import type { Auth } from "./index.js";
import type { Role } from "../types.js";
import { derivePrimaryRole, parseRoles } from "../services/roles.js";

/**
 * Shared server-side authorization helpers (ticket #10 — "Server-Side
 * Permission Enforcement Middleware", extended for multi-role in #44).
 *
 * Every role-restricted route handler / server action calls one of these
 * BEFORE touching data, and every dashboard/inbox query is additionally
 * filtered at the query layer via {@link dataScopeFor} — never by hiding things
 * client-side.
 */

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: "unauthenticated" | "forbidden",
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  /** Derived single role (finance > approver > employee) — compat view. */
  role: Role;
  roles: Role[];
  primaryRole: Role;
  managerId: string | null;
  department: string | null;
  costCenter: string | null;
  status: string;
};

export interface AuthContext {
  user: SessionUser;
  session: { id: string; token: string; userId: string; expiresAt: Date };
}

/** Pure: does the caller's role set intersect the allowed set? */
export function hasAnyRole(roles: Role[], allowed: Role[]): boolean {
  return allowed.some((r) => roles.includes(r));
}

/** Resolve the authenticated user + session, or null if none/invalid. */
export async function getCurrentUser(
  auth: Auth,
  headers: Headers
): Promise<AuthContext | null> {
  const res = await auth.api.getSession({ headers });
  if (!res?.session || !res?.user) return null;
  const u = res.user as unknown as SessionUser;
  const roles = parseRoles(u.roles);
  const primaryRole = derivePrimaryRole(roles);
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: primaryRole,
      roles,
      primaryRole,
      managerId: u.managerId ?? null,
      department: u.department ?? null,
      costCenter: u.costCenter ?? null,
      status: u.status ?? "active",
    },
    session: {
      id: res.session.id,
      token: res.session.token,
      userId: res.session.userId,
      expiresAt: res.session.expiresAt,
    },
  };
}

/** Require an authenticated session; throw AuthError(401) otherwise. */
export async function requireUser(
  auth: Auth,
  headers: Headers
): Promise<AuthContext> {
  const ctx = await getCurrentUser(auth, headers);
  if (!ctx) {
    throw new AuthError(401, "unauthenticated", "Authentication required");
  }
  return ctx;
}

/** Require the caller to hold any one of the allowed roles; throw 401/403. */
export async function requireAnyRole(
  auth: Auth,
  headers: Headers,
  allowed: Role[]
): Promise<AuthContext> {
  const ctx = await requireUser(auth, headers);
  if (!hasAnyRole(ctx.user.roles, allowed)) {
    throw new AuthError(
      403,
      "forbidden",
      `This action requires one of: ${allowed.join(", ")}`
    );
  }
  return ctx;
}

/**
 * Single-role back-compat wrapper over {@link requireAnyRole} (#44). Existing
 * finance-guarded call sites keep working unchanged; multi-role call sites use
 * {@link requireAnyRole} directly.
 */
export async function requireRole(
  auth: Auth,
  headers: Headers,
  allowed: Role | Role[]
): Promise<AuthContext> {
  return requireAnyRole(auth, headers, Array.isArray(allowed) ? allowed : [allowed]);
}

/**
 * Translate the caller's roles into a server-side data filter used by
 * dashboard/inbox queries. Employees see only their own rows; approvers see
 * rows for users in their reporting line; finance sees everything. Scoping is
 * keyed off the derived primary role (finance > approver > employee). Consumers
 * apply this filter in their WHERE clauses — it is never optional.
 */
export function dataScopeFor(user: SessionUser): {
  ownOnly: boolean;
  userId: string;
  managerId: string | null;
  allData: boolean;
} {
  switch (user.primaryRole) {
    case "employee":
      return { ownOnly: true, userId: user.id, managerId: null, allData: false };
    case "approver":
      return { ownOnly: false, userId: user.id, managerId: user.id, allData: false };
    case "finance":
      return { ownOnly: false, userId: user.id, managerId: null, allData: true };
  }
}

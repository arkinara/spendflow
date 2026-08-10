import { eq } from "drizzle-orm";
import {
  accountsTable,
  sessionsTable,
  userInvitationsTable,
  usersTable,
} from "../db/schema.js";
import type { DB } from "../db/index.js";
import { ROLES, type PublicUser, type Role, type UserStatus } from "../types.js";
import { derivePrimaryRole, parseRoles, serializeRoles } from "./roles.js";
import { writeAudit } from "./audit.js";

export class UserServiceError extends Error {
  constructor(
    public code:
      | "not_found"
      | "invalid_role"
      | "invalid_manager"
      | "self_manager"
      | "cycle"
      | "cannot_delete_active_user"
      | "invalid_password"
      | "cannot_demote_last_finance"
      | "cannot_remove_only_approver_with_reports"
      | "cannot_demote_self_sole_finance",
    message: string,
    /** Optional explicit HTTP status; defaults per-code otherwise (400/404). */
    public status?: number
  ) {
    super(message);
    this.name = "UserServiceError";
  }
}

const MAX_CHAIN_DEPTH = 100;

function toPublic(row: typeof usersTable.$inferSelect): PublicUser {
  const roles = parseRoles(row.roles);
  const primaryRole = row.primaryRole as Role;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    role: primaryRole,
    roles,
    primaryRole,
    managerId: row.managerId,
    department: row.department,
    costCenter: row.costCenter,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listUsers(db: DB): PublicUser[] {
  return db.select().from(usersTable).orderBy(usersTable.name).all().map(toPublic);
}

export function getUser(db: DB, id: string): PublicUser | null {
  const row = db.select().from(usersTable).where(eq(usersTable.id, id)).get();
  return row ? toPublic(row) : null;
}

function loadOrFail(db: DB, id: string) {
  const row = db.select().from(usersTable).where(eq(usersTable.id, id)).get();
  if (!row) throw new UserServiceError("not_found", `User ${id} not found`);
  return row;
}

/** Count active users whose derived primary role is `finance`. Multi-role
 *  users with `finance` in their `roles` array always have `primaryRole =
 *  "finance"` (derivePrimaryRole precedence), so this filter catches them. */
function countActiveFinanceAdmins(db: DB): number {
  return db
    .select({ id: usersTable.id, status: usersTable.status, primaryRole: usersTable.primaryRole })
    .from(usersTable)
    .where(eq(usersTable.primaryRole, "finance"))
    .all()
    .filter((r) => r.status === "active").length;
}

/** Validate a `roles` payload: non-empty array, every entry a known Role.
 *  Throws `invalid_role` on failure. Returns the deduped array. */
function normalizeRoles(roles: unknown): Role[] {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new UserServiceError("invalid_role", "Roles must be a non-empty array");
  }
  const seen = new Set<Role>();
  for (const r of roles) {
    if (!ROLES.includes(r as Role)) {
      throw new UserServiceError("invalid_role", `Role must be one of: ${ROLES.join(", ")}`);
    }
    seen.add(r as Role);
  }
  return Array.from(seen);
}

/**
 * Replace a user's role set with `newRoles`, enforcing the multi-role
 * invariants (#53): never empty, never drop the last Finance Admin, never
 * strip `approver` from a user who still has direct reports, and never let
 * the sole Finance Admin demote themselves. Audits `role.change` with
 * before/after `{ roles, primaryRole }` so the multi-role diff is visible.
 *
 * Guards fire before any write; a failed guard leaves the row untouched.
 */
export function changeRoles(
  db: DB,
  targetId: string,
  newRoles: Role[],
  actorId: string
): { user: PublicUser; audit: ReturnType<typeof writeAudit> } {
  const dedupedRoles = normalizeRoles(newRoles);
  const before = loadOrFail(db, targetId);
  const beforeRoles = parseRoles(before.roles);
  const beforePrimary = before.primaryRole as Role;
  const afterPrimary = derivePrimaryRole(dedupedRoles);

  // Guard: cannot strip `approver` from a user who still has direct reports —
  // their reports' submitter_manager routing would have nowhere to go.
  if (beforeRoles.includes("approver") && !dedupedRoles.includes("approver")) {
    const reports = db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.managerId, targetId))
      .all();
    if (reports.length > 0) {
      throw new UserServiceError(
        "cannot_remove_only_approver_with_reports",
        `Cannot remove the approver role from a user with ${reports.length} direct report${reports.length === 1 ? "" : "s"}`,
      );
    }
  }

  // Guard: cannot drop `finance` from the last active Finance Admin. When the
  // actor is the sole admin demoting themselves this is also the path that
  // fires (actor must hold the finance role to reach this route, so the only
  // reachable "last finance" case is a self-demotion).
  if (
    beforeRoles.includes("finance") &&
    !dedupedRoles.includes("finance") &&
    countActiveFinanceAdmins(db) <= 1
  ) {
    throw new UserServiceError(
      "cannot_demote_last_finance",
      "Cannot remove the finance role from the last active Finance Admin",
    );
  }

  // Idempotent no-op: same role set (order-independent) → return the row
  // without writing a no-op audit entry.
  const same =
    beforeRoles.length === dedupedRoles.length &&
    beforeRoles.every((r) => dedupedRoles.includes(r));
  if (same) {
    return { user: toPublic(before), audit: noopAudit() };
  }

  const now = new Date();
  db.update(usersTable)
    .set({
      roles: serializeRoles(dedupedRoles),
      primaryRole: afterPrimary,
      updatedAt: now,
    })
    .where(eq(usersTable.id, targetId))
    .run();
  const afterRow = db.select().from(usersTable).where(eq(usersTable.id, targetId)).get()!;
  const audit = writeAudit(db, {
    actorId,
    action: "role.change",
    entityType: "user",
    entityId: targetId,
    before: { roles: beforeRoles, primaryRole: beforePrimary },
    after: { roles: dedupedRoles, primaryRole: afterPrimary },
  });
  return { user: toPublic(afterRow), audit };
}

/** Legacy single-role wrapper around {@link changeRoles} (#53 back-compat). */
export function changeRole(
  db: DB,
  targetId: string,
  newRole: Role,
  actorId: string
): { user: PublicUser; audit: ReturnType<typeof writeAudit> } {
  if (!ROLES.includes(newRole)) {
    throw new UserServiceError("invalid_role", `Role must be one of: ${ROLES.join(", ")}`);
  }
  return changeRoles(db, targetId, [newRole], actorId);
}

/**
 * Detect whether assigning `managerId` as the manager of `userId` would close a
 * loop in the reporting line. Walks the candidate manager's chain upward; if it
 * passes through `userId`, the assignment is cyclic.
 */
export function wouldCreateCycle(
  db: DB,
  userId: string,
  managerId: string
): boolean {
  let current: string | null = managerId;
  let depth = 0;
  while (current !== null) {
    if (current === userId) return true;
    if (++depth > MAX_CHAIN_DEPTH) return true;
    const row = db
      .select({ managerId: usersTable.managerId })
      .from(usersTable)
      .where(eq(usersTable.id, current))
      .get();
    current = row?.managerId ?? null;
  }
  return false;
}

/** Set (or clear, with null) a user's manager and record an audit entry. */
export function setManager(
  db: DB,
  targetId: string,
  newManagerId: string | null,
  actorId: string
): { user: PublicUser; audit: ReturnType<typeof writeAudit> } {
  const before = loadOrFail(db, targetId);

  if (newManagerId === null) {
    if (before.managerId === null) {
      return { user: toPublic(before), audit: noopAudit() };
    }
    const now = new Date();
    db.update(usersTable)
      .set({ managerId: null, updatedAt: now })
      .where(eq(usersTable.id, targetId))
      .run();
    const afterRow = db.select().from(usersTable).where(eq(usersTable.id, targetId)).get()!;
    const audit = writeAudit(db, {
      actorId,
      action: "manager.change",
      entityType: "user",
      entityId: targetId,
      before: { managerId: before.managerId },
      after: { managerId: null },
    });
    return { user: toPublic(afterRow), audit };
  }

  if (newManagerId === targetId) {
    throw new UserServiceError("self_manager", "A user cannot be their own manager");
  }
  const manager = db
    .select({ id: usersTable.id, roles: usersTable.roles })
    .from(usersTable)
    .where(eq(usersTable.id, newManagerId))
    .get();
  if (!manager) {
    throw new UserServiceError("invalid_manager", `Manager ${newManagerId} does not exist`);
  }
  const managerRoles = parseRoles(manager.roles);
  if (!managerRoles.includes("approver")) {
    throw new UserServiceError(
      "invalid_manager",
      `Manager must be an Approver; user has role '${derivePrimaryRole(managerRoles)}'`,
      400
    );
  }
  if (wouldCreateCycle(db, targetId, newManagerId)) {
    throw new UserServiceError("cycle", "Setting that manager would create a circular reporting line");
  }
  if (before.managerId === newManagerId) {
    return { user: toPublic(before), audit: noopAudit() };
  }

  const now = new Date();
  db.update(usersTable)
    .set({ managerId: newManagerId, updatedAt: now })
    .where(eq(usersTable.id, targetId))
    .run();
  const afterRow = db.select().from(usersTable).where(eq(usersTable.id, targetId)).get()!;
  const audit = writeAudit(db, {
    actorId,
    action: "manager.change",
    entityType: "user",
    entityId: targetId,
    before: { managerId: before.managerId },
    after: { managerId: newManagerId },
  });
  return { user: toPublic(afterRow), audit };
}

/** Sentinel audit value when no mutation occurred (idempotent no-op). */
function noopAudit(): ReturnType<typeof writeAudit> {
  return {
    id: "",
    actorId: "",
    action: "noop",
    entityType: "",
    entityId: "",
    before: null,
    after: null,
    createdAt: new Date(),
  };
}

/** Narrow an unknown value to a valid Role, else null. */
export function asRole(value: unknown): Role | null {
  if (typeof value === "string" && (ROLES as readonly string[]).includes(value)) {
    return value as Role;
  }
  return null;
}

export function asUserStatus(value: unknown): UserStatus | null {
  if (value === "active" || value === "disabled" || value === "pending") return value;
  return null;
}

/**
 * Hard-delete a user (pending or disabled only) (#42). Active users are
 * protected; the cascade delete (invitations → sessions → accounts → user) and
 * the audit entry commit or roll back together.
 *
 * Password re-authentication was previously inlined here using
 * `verifyPassword`; #64 hoisted that step into the shared
 * `requirePasswordReauth` helper so role change, claim unblock, and hard
 * delete all share one step-up auth path. The route handler must call the
 * helper before invoking this service — the service itself no longer takes a
 * password.
 */
export async function hardDeleteUser(
  db: DB,
  targetId: string,
  actorId: string
): Promise<{ deletedUserId: string }> {
  const target = loadOrFail(db, targetId);
  if (target.status === "active") {
    throw new UserServiceError(
      "cannot_delete_active_user",
      "Active users cannot be deleted",
      409
    );
  }

  const before = {
    id: target.id,
    email: target.email,
    name: target.name,
    role: target.primaryRole,
    status: target.status,
  };
  db.transaction((tx) => {
    tx.delete(userInvitationsTable)
      .where(eq(userInvitationsTable.userId, targetId))
      .run();
    tx.delete(sessionsTable).where(eq(sessionsTable.userId, targetId)).run();
    tx.delete(accountsTable).where(eq(accountsTable.userId, targetId)).run();
    tx.delete(usersTable).where(eq(usersTable.id, targetId)).run();
    writeAudit(tx, {
      actorId,
      action: "user.delete",
      entityType: "user",
      entityId: targetId,
      before,
    });
  });
  return { deletedUserId: targetId };
}

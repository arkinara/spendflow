import { eq } from "drizzle-orm";
import { usersTable } from "../db/schema.js";
import type { DB } from "../db/index.js";
import { ROLES, type PublicUser, type Role, type UserStatus } from "../types.js";
import { writeAudit } from "./audit.js";

export class UserServiceError extends Error {
  constructor(
    public code:
      | "not_found"
      | "invalid_role"
      | "invalid_manager"
      | "self_manager"
      | "cycle",
    message: string
  ) {
    super(message);
    this.name = "UserServiceError";
  }
}

const MAX_CHAIN_DEPTH = 100;

function toPublic(row: typeof usersTable.$inferSelect): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    role: row.role,
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

/** Change a user's role and record the before/after in the audit log. */
export function changeRole(
  db: DB,
  targetId: string,
  newRole: Role,
  actorId: string
): { user: PublicUser; audit: ReturnType<typeof writeAudit> } {
  if (!ROLES.includes(newRole)) {
    throw new UserServiceError("invalid_role", `Role must be one of: ${ROLES.join(", ")}`);
  }
  const before = loadOrFail(db, targetId);
  if (before.role === newRole) {
    const user = toPublic(before);
    return { user, audit: noopAudit() };
  }
  const now = new Date();
  db.update(usersTable)
    .set({ role: newRole, updatedAt: now })
    .where(eq(usersTable.id, targetId))
    .run();
  const afterRow = db.select().from(usersTable).where(eq(usersTable.id, targetId)).get()!;
  const audit = writeAudit(db, {
    actorId,
    action: "role.change",
    entityType: "user",
    entityId: targetId,
    before: { role: before.role },
    after: { role: newRole },
  });
  return { user: toPublic(afterRow), audit };
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
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, newManagerId))
    .get();
  if (!manager) {
    throw new UserServiceError("invalid_manager", `Manager ${newManagerId} does not exist`);
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

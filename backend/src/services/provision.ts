import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { accountsTable, usersTable } from "../db/schema.js";
import type { DB } from "../db/index.js";
import type { Role, UserStatus } from "../types.js";

export interface ProvisionUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  /** Optional deterministic id (used by the seed). Defaults to a random UUID. */
  id?: string;
  managerId?: string | null;
  department?: string | null;
  costCenter?: string | null;
  status?: UserStatus;
  emailVerified?: boolean;
}

/**
 * Provision a user with an email/password credential, mirroring the hash into
 * both `users.password_hash` (PRD schema column) and `accounts.password` (the
 * credential Better Auth's email/password verifier checks). Both derive from a
 * single hash so the two stores can never drift.
 *
 * Throws `ProvisionError` for known validation failures (duplicate email); DB
 * constraint violations bubble up otherwise.
 */
export class ProvisionError extends Error {
  constructor(
    public code: "duplicate_email" | "invalid_manager",
    message: string
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

export async function provisionUser(
  db: DB,
  input: ProvisionUserInput
): Promise<{ id: string }> {
  const id = input.id ?? crypto.randomUUID();
  const now = new Date();
  const hash = await hashPassword(input.password);

  // Resolve the manager id once (null is valid — no reporting line).
  const managerId = input.managerId ?? null;
  if (managerId !== null) {
    const manager = db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, managerId))
      .get();
    if (!manager) throw new ProvisionError("invalid_manager", `Manager ${managerId} does not exist`);
  }

  try {
    db.transaction((tx) => {
      tx.insert(usersTable)
        .values({
          id,
          name: input.name,
          email: input.email.toLowerCase(),
          emailVerified: input.emailVerified ?? false,
          image: null,
          role: input.role,
          managerId,
          department: input.department ?? null,
          costCenter: input.costCenter ?? null,
          status: input.status ?? "active",
          passwordHash: hash,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(accountsTable)
        .values({
          id: crypto.randomUUID(),
          userId: id,
          accountId: id,
          providerId: "credential",
          password: hash,
          accessToken: null,
          refreshToken: null,
          scope: null,
          idToken: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique/i.test(msg)) {
      throw new ProvisionError("duplicate_email", `A user with email ${input.email} already exists`);
    }
    throw err;
  }

  return { id };
}

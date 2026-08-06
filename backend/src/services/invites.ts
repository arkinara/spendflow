import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { serializeSignedCookie } from "better-call";
import { hashPassword } from "better-auth/crypto";
import { accountsTable, userInvitationsTable, usersTable } from "../db/schema.js";
import type { DB } from "../db/index.js";
import type { Auth } from "../auth/index.js";
import type { Env } from "../config.js";
import { EmailConfigError, sendInviteEmail } from "../email/resend.js";
import { ROLES, type PublicUser, type Role } from "../types.js";
import { writeAudit } from "./audit.js";

/**
 * User invitation lifecycle (#38).
 *
 * Finance Admin creates a pending user + single-use invite token via
 * `createInviteForUser`; the invite is validated by `getInviteDetails` on the
 * public acceptance page; `acceptInvite` sets the user's password (directly on
 * the `accounts` credential row — Better Auth's own `setPassword` requires a
 * signed-in session, which a pending user does not have), flips the user to
 * `active`, marks the token consumed and issues a real session cookie.
 *
 * Email delivery goes through the Resend sandbox (#40). The invite URL is also
 * always appended to `backend/logs/invites.log` as a best-effort fallback so
 * the invite is never silently lost — devs without a `RESEND_API_KEY` (and
 * callers after a Resend API failure) can still retrieve it from the log.
 */

export class InviteError extends Error {
  constructor(
    public status: number,
    public code:
      | "invite_invalid"
      | "invite_expired"
      | "invite_consumed"
      | "invalid_password"
      | "email_exists"
      | "invalid_role"
      | "not_found",
    message: string
  ) {
    super(message);
    this.name = "InviteError";
  }
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Absolute path to the invite-log fallback (repo: backend/logs/invites.log). */
const INVITE_LOG = new URL("../../logs/invites.log", import.meta.url);

function logInviteEmail(email: string, token: string, url: string) {
  try {
    mkdirSync(dirname(INVITE_LOG.pathname), { recursive: true });
  } catch {
    // Logging is best-effort; a failure must never break user creation.
  }
  try {
    appendFileSync(
      INVITE_LOG.pathname,
      `[${new Date().toISOString()}] email=${email} token=${token} url=${url}\n`
    );
  } catch {
    // Ignore write failures — the invite is already persisted in the DB.
  }
}

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

export interface CreateInviteInput {
  email: string;
  name: string;
  role: Role;
  managerId?: string | null;
  department?: string | null;
  costCenter?: string | null;
}

/**
 * Create a `status = "pending"` user row + a single-use invite token, then
 * deliver the invitation email through Resend (falling back to the invite log
 * when email isn't configured or the API call fails). Returns the public user
 * plus the invite envelope; the token is only ever returned once, to the caller.
 */
export async function createInviteForUser(
  db: DB,
  input: CreateInviteInput,
  actorId: string,
  inviteUrlBase = process.env.FE_URL ?? "http://localhost:3000"
): Promise<{ user: PublicUser; invite: { token: string; sentAt: Date; expiresAt: Date } }> {
  const email = input.email.toLowerCase();
  const role = input.role;

  if (!ROLES.includes(role)) {
    throw new InviteError(400, "invalid_role", `Role must be one of: ${ROLES.join(", ")}`);
  }
  const existing = db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .get();
  if (existing) {
    throw new InviteError(409, "email_exists", `A user with email ${input.email} already exists`);
  }
  const managerId = input.managerId ?? null;
  if (managerId !== null) {
    const manager = db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, managerId))
      .get();
    if (!manager) {
      throw new InviteError(400, "not_found", `Manager ${managerId} does not exist`);
    }
  }

  const now = new Date();
  const userId = crypto.randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  db.transaction((tx) => {
    tx.insert(usersTable)
      .values({
        id: userId,
        name: input.name,
        email,
        emailVerified: false,
        image: null,
        role,
        managerId,
        department: input.department ?? null,
        costCenter: input.costCenter ?? null,
        status: "pending",
        passwordHash: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    // Better Auth resolves credentials from `accounts`; create the (passwordless)
    // credential row up front so `acceptInvite` only needs to set `password`.
    tx.insert(accountsTable)
      .values({
        id: crypto.randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: null,
        accessToken: null,
        refreshToken: null,
        scope: null,
        idToken: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(userInvitationsTable)
      .values({
        id: crypto.randomUUID(),
        userId,
        token,
        expiresAt: expiresAt.getTime(),
        consumedAt: null,
        consumedByIp: null,
        createdAt: now.getTime(),
      })
      .run();
    writeAudit(tx, {
      actorId,
      action: "user.create",
      entityType: "user",
      entityId: userId,
      after: { email, role, status: "pending" },
    });
  });

  const inviteUrl = `${inviteUrlBase.replace(/\/$/, "")}/invite/${token}`;

  if (process.env.RESEND_API_KEY) {
    try {
      await sendInviteEmail({
        to: email,
        name: input.name,
        role,
        inviteUrl,
        expiresInDays: INVITE_TTL_MS / (24 * 60 * 60 * 1000),
      });
    } catch (err) {
      // The invite URL must never be silently lost — the log fallback runs on
      // every failure path before deciding whether to surface the error.
      logInviteEmail(email, token, inviteUrl);
      if (err instanceof EmailConfigError) {
        console.warn("email not configured; invite URL logged instead");
      } else {
        console.error("Resend delivery failed; invite URL logged instead", err);
        throw err;
      }
    }
  }
  // Best-effort log on every path (success or fallback) preserves the pre-#40
  // behavior where the invite URL is always recorded for dev / troubleshooting.
  logInviteEmail(email, token, inviteUrl);

  const user = db.select().from(usersTable).where(eq(usersTable.id, userId)).get()!;
  return { user: toPublic(user), invite: { token, sentAt: now, expiresAt } };
}

export interface InviteDetails {
  email: string;
  name: string;
  role: Role;
  managerId: string | null;
  department: string | null;
  costCenter: string | null;
}

/** Validate a token and resolve the invitee's public details (public route). */
export function getInviteDetails(db: DB, token: string): InviteDetails {
  const invite = db
    .select()
    .from(userInvitationsTable)
    .where(eq(userInvitationsTable.token, token))
    .get();
  if (!invite) {
    throw new InviteError(404, "invite_invalid", "Invitation not found. Please request a new invite.");
  }
  if (invite.consumedAt !== null) {
    throw new InviteError(410, "invite_consumed", "This invitation has already been used.");
  }
  if (invite.expiresAt < Date.now()) {
    throw new InviteError(410, "invite_expired", "This invitation has expired. Please request a new invite.");
  }
  const user = db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, invite.userId))
    .get();
  if (!user) {
    throw new InviteError(404, "invite_invalid", "Invitation not found. Please request a new invite.");
  }
  return {
    email: user.email,
    name: user.name,
    role: user.role,
    managerId: user.managerId,
    department: user.department,
    costCenter: user.costCenter,
  };
}

function loadInviteForAccept(db: DB, token: string) {
  const invite = db
    .select()
    .from(userInvitationsTable)
    .where(eq(userInvitationsTable.token, token))
    .get();
  if (!invite) {
    throw new InviteError(404, "invite_invalid", "Invitation not found. Please request a new invite.");
  }
  if (invite.consumedAt !== null) {
    throw new InviteError(410, "invite_consumed", "This invitation has already been used.");
  }
  if (invite.expiresAt < Date.now()) {
    throw new InviteError(410, "invite_expired", "This invitation has expired. Please request a new invite.");
  }
  return invite;
}

/**
 * Accept an invitation: validate token, set the password on the Better Auth
 * `accounts` credential row, activate the user, mark the token consumed, write
 * an audit entry and mint a real session cookie (so the FE skips manual
 * sign-in).
 */
export async function acceptInvite(
  deps: { db: DB; auth: Auth; env: Env },
  token: string,
  password: string,
  ip: string | null
): Promise<{ user: PublicUser; cookie: string }> {
  const { db, auth } = deps;
  const invite = loadInviteForAccept(db, token);
  const user = db.select().from(usersTable).where(eq(usersTable.id, invite.userId)).get();
  if (!user) {
    throw new InviteError(404, "invite_invalid", "Invitation not found. Please request a new invite.");
  }

  const hash = await hashPassword(password);
  const now = new Date();
  db.transaction((tx) => {
    tx.update(usersTable)
      .set({ passwordHash: hash, status: "active", updatedAt: now })
      .where(eq(usersTable.id, user.id))
      .run();
    tx.update(accountsTable)
      .set({ password: hash, updatedAt: now })
      .where(eq(accountsTable.userId, user.id))
      .run();
    tx.update(userInvitationsTable)
      .set({ consumedAt: now.getTime(), consumedByIp: ip })
      .where(eq(userInvitationsTable.id, invite.id))
      .run();
    writeAudit(tx, {
      actorId: user.id,
      action: "user.activate",
      entityType: "user",
      entityId: user.id,
      before: { status: "pending" },
      after: { status: "active" },
    });
  });

  const activated = db.select().from(usersTable).where(eq(usersTable.id, user.id)).get()!;
  const cookie = await issueSessionCookie(auth, user.id);
  return { user: toPublic(activated), cookie };
}

/** Create a Better Auth session row and return its signed `Set-Cookie` value. */
async function issueSessionCookie(auth: Auth, userId: string) {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  const name = ctx.authCookies.sessionToken.name;
  const attributes = ctx.authCookies.sessionToken.attributes;
  return serializeSignedCookie(name, session.token, ctx.secret, attributes);
}

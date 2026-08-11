import { eq } from "drizzle-orm";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hashPassword } from "better-auth/crypto";
import {
  accountsTable,
  passwordResetsTable,
  sessionsTable,
  usersTable,
} from "../../db/schema.js";
import type { DB } from "../../db/index.js";
import {
  EmailConfigError,
  isResendSandbox,
  sendPasswordResetEmail,
} from "../../email/resend.js";
import { writeAudit } from "../audit.js";

/**
 * Password-reset lifecycle (#69).
 *
 * `requestReset(db, { email }, actor?)` — generates a single-use token with a
 * 1-hour TTL and dispatches the reset email through the Resend pipeline
 * (falling back to the password-resets log when email isn't configured). The
 * function returns `null` for an unknown/inactive user so the route handler
 * can render the SAME 200 envelope either way (no email enumeration).
 *
 * `consumeReset(db, { token, password })` — verifies the token, hashes the
 * new password, updates `users.passwordHash` + `accounts.password`, marks the
 * token row consumed, invalidates every existing session for the user, and
 * writes a `user.password_reset` audit entry.
 *
 * Token entropy is `crypto.randomUUID()` v4 (122 bits) — single-use + 1h TTL
 * is sufficient for the Phase 1 threat model (no SMS / 2FA yet).
 */

export class PasswordResetError extends Error {
  constructor(
    public status: number,
    public code:
      | "invalid_token"
      | "expired_token"
      | "already_used"
      | "weak_password",
    message: string
  ) {
    super(message);
    this.name = "PasswordResetError";
  }
}

/** Token lifetime: 1 hour (matches the email copy). */
export const RESET_TTL_MS = 60 * 60 * 1000;
/** Same copy the email template renders — exported for tests + callers. */
export const RESET_TTL_MINUTES = RESET_TTL_MS / (60 * 1000);

/** Absolute path to the password-reset log fallback (mirrors invites.log). */
const RESET_LOG = new URL("../../logs/password-resets.log", import.meta.url);

function logResetEmail(email: string, token: string, url: string) {
  try {
    mkdirSync(dirname(RESET_LOG.pathname), { recursive: true });
  } catch {
    // Logging is best-effort.
  }
  try {
    appendFileSync(
      RESET_LOG.pathname,
      `[${new Date().toISOString()}] email=${email} token=${token} url=${url}\n`
    );
  } catch {
    // Ignore write failures — the reset row is already persisted in the DB.
  }
}

export interface RequestResetInput {
  email: string;
}

export interface RequestResetResult {
  /** Always present when a token was actually generated; absent otherwise. */
  token: string;
  /** Best-effort dev hint — surfaced to the caller only in sandbox mode. */
  devHint?: { sandbox: boolean; resetUrl: string };
}

/**
 * Generate + persist a reset token for the user matching `email`, then dispatch
 * the email. Returns `null` if no `active` user matches, so the route can keep
 * the response shape identical and avoid email enumeration.
 */
export async function requestReset(
  db: DB,
  input: RequestResetInput,
  resetUrlBase = process.env.FE_URL ?? "http://localhost:3000"
): Promise<RequestResetResult | null> {
  const email = input.email.trim().toLowerCase();
  const user = db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .get();
  if (!user || user.status !== "active") {
    return null;
  }

  const token = crypto.randomUUID();
  const now = Date.now();
  db.insert(passwordResetsTable)
    .values({
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt: now + RESET_TTL_MS,
      consumedAt: null,
      createdAt: now,
    })
    .run();

  const resetUrl = `${resetUrlBase.replace(/\/$/, "")}/reset-password/${token}`;

  let devHint: { sandbox: boolean; resetUrl: string } | undefined;
  if (process.env.RESEND_API_KEY) {
    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
        expiresInMinutes: RESET_TTL_MINUTES,
      });
    } catch (err) {
      // Always preserve the URL on the failure path before deciding.
      logResetEmail(user.email, token, resetUrl);
      if (err instanceof EmailConfigError) {
        console.warn("email not configured; reset URL logged instead");
        devHint = { sandbox: isResendSandbox(), resetUrl };
      } else {
        console.error("Resend delivery failed; reset URL logged instead", err);
        throw err;
      }
    }
  } else {
    devHint = { sandbox: isResendSandbox(), resetUrl };
  }
  logResetEmail(user.email, token, resetUrl);

  return { token, ...(devHint ? { devHint } : {}) };
}

export interface ConsumeResetInput {
  token: string;
  password: string;
}

/**
 * Validate the token, set the new password, consume the row, and invalidate
 * every existing session for the user. Throws {@link PasswordResetError} with
 * the typed `code` documented in the route contract.
 */
export async function consumeReset(
  db: DB,
  input: ConsumeResetInput
): Promise<{ userId: string }> {
  if (typeof input.password !== "string" || input.password.length < 8) {
    throw new PasswordResetError(
      422,
      "weak_password",
      "Password must be at least 8 characters"
    );
  }

  const row = db
    .select()
    .from(passwordResetsTable)
    .where(eq(passwordResetsTable.token, input.token))
    .get();
  if (!row) {
    throw new PasswordResetError(
      401,
      "invalid_token",
      "This reset link is invalid or has expired."
    );
  }
  if (row.consumedAt !== null) {
    throw new PasswordResetError(
      410,
      "already_used",
      "This reset link has already been used."
    );
  }
  if (row.expiresAt < Date.now()) {
    throw new PasswordResetError(
      401,
      "invalid_token",
      "This reset link is invalid or has expired."
    );
  }

  const hash = await hashPassword(input.password);
  const now = new Date();
  db.transaction((tx) => {
    tx.update(usersTable)
      .set({ passwordHash: hash, updatedAt: now })
      .where(eq(usersTable.id, row.userId))
      .run();
    // Mirror the credential hash on the primary credential row (Better Auth
    // owns the verifier; `users.password_hash` is the audited mirror).
    tx.update(accountsTable)
      .set({ password: hash, updatedAt: now })
      .where(eq(accountsTable.userId, row.userId))
      .run();
    tx.update(passwordResetsTable)
      .set({ consumedAt: now.getTime() })
      .where(eq(passwordResetsTable.id, row.id))
      .run();
    // Invalidate every existing session for the user — forces a fresh sign-in
    // on every device after a reset (security hygiene, #69 positive AC).
    tx.delete(sessionsTable)
      .where(eq(sessionsTable.userId, row.userId))
      .run();
    writeAudit(tx, {
      actorId: row.userId,
      action: "user.password_reset",
      entityType: "user",
      entityId: row.userId,
      before: null,
      after: { token_id: row.id },
    });
  });

  return { userId: row.userId };
}

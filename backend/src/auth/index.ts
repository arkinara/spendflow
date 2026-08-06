import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Env } from "../config.js";
import { schema } from "../db/schema.js";
import type { DB } from "../db/index.js";

/**
 * Build a Better Auth instance bound to a specific Drizzle handle.
 *
 * Factory form (rather than a module singleton) so integration tests can stand
 * up an isolated SQLite database per run and point auth + the Hono app at it.
 */
export function createAuth(db: DB, env: Env) {
  const trustedOrigins = env.frontendOrigin
    ? env.frontendOrigin.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return betterAuth({
    secret: env.betterAuthSecret,
    baseURL: env.betterAuthUrl,
    ...(trustedOrigins.length ? { trustedOrigins } : {}),
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
      usePlural: true,
    }),
    emailAndPassword: {
      enabled: true,
      // Phase 1: email verification is out of scope; login works once provisioned.
      requireEmailVerification: false,
      autoSignIn: false,
    },
    session: {
      expiresIn: env.sessionExpiresIn,
      updateAge: 60 * 60 * 24, // refresh once per day
      // Cookie cache intentionally disabled: the ticket requires that logout
      // immediately invalidates the session so a follow-up request with the old
      // token is rejected. With cookieCache on, a revoked session stays valid
      // in the signed cookie until maxAge elapses.
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        role: {
          type: ["employee", "approver", "finance"],
          required: false,
          defaultValue: "employee",
          input: false, // server-owned — set only via admin API / provisioning
          returned: true,
        },
        managerId: {
          type: "string",
          required: false,
          input: false,
          returned: true,
        },
        department: {
          type: "string",
          required: false,
          input: false,
          returned: true,
        },
        costCenter: {
          type: "string",
          required: false,
          input: false,
          returned: true,
        },
        status: {
          type: ["active", "disabled", "pending"],
          required: false,
          defaultValue: "active",
          input: false,
          returned: true,
        },
        // Present on the users table for the PRD schema; never exposed.
        passwordHash: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

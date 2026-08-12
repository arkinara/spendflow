/* ============================================================================
 * SpendFlow — Auth HTTP routes (#69): forgot-password + reset-password.
 *
 *   POST /api/auth/forgot-password   public, rate-limited 5/req-ip/hour
 *   POST /api/auth/reset-password    public, validates token + new password
 *
 * Both endpoints deliberately live OUTSIDE Better Auth's own `/api/auth/*`
 * handler (mounted as `app.on(["POST", "GET"], "/api/auth/*", ...)` in
 * app.ts): Better Auth has no first-class password-reset primitive in our
 * Phase 1 config, so this pair adds it on top of the same `accounts.password`
 * column Better Auth's email/password verifier reads.
 *
 * `forgot-password` is intentionally constant-time in its response body: the
 * JSON envelope is the SAME whether the email matches an active user or not,
 * so a caller cannot enumerate which addresses are registered. The reset
 * email is only dispatched on a hit; on a miss, the request still costs the
 * caller a rate-limit token so address-guessing stays throttled.
 * ========================================================================== */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Auth } from "../auth/index.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { jsonError } from "./claims.js";
import {
  PasswordResetError,
  consumeReset,
  requestReset,
} from "../services/auth/password-reset.js";

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

/** Body returned for every `forgot-password` response (success or miss). */
const FORGOT_OK_BODY = {
  message: "If an account exists for that email, a reset link has been sent.",
};

export function authRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();

  // 5 requests per IP per hour — generous for a forgetful user, tight enough
  // to throttle enumeration / spam. State is per-process (Phase 1 caveat).
  const forgotLimiter = rateLimit({
    limit: 5,
    windowMs: 60 * 60 * 1000,
    blockMessage:
      "Too many password-reset requests. Please try again later.",
  });

  // #70 — reset-password is a public endpoint that takes a token + password;
  // throttle token-guessing at 10/IP/15min. (Login itself goes through Better
  // Auth's own handler mounted at /api/auth/* and relies on Better Auth's
  // built-in brute-force protection — see app.ts. We cannot wrap it from
  // Hono without proxying the request, which is out of scope for Phase 1.)
  const resetLimiter = rateLimit({
    limit: 10,
    windowMs: 15 * 60 * 1000,
    blockMessage:
      "Too many password-reset attempts. Please try again later.",
  });

  router.post("/api/auth/forgot-password", forgotLimiter.middleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      // Same envelope as a success — never reveal that the email was malformed
      // vs. simply not on file. Still consume a rate-limit token (the
      // middleware already counted this hit).
      return c.json(FORGOT_OK_BODY, 200);
    }
    await requestReset(deps.db, { email: parsed.data.email }, deps.env.feUrl);
    return c.json(FORGOT_OK_BODY, 200);
  });

  router.post("/api/auth/reset-password", resetLimiter.middleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      // Distinguish the two failure modes so the FE can branch:
      //   - missing/short password → 422 weak_password (inline form error)
      //   - missing token / wrong shape → 400 invalid_body
      const issue = parsed.error.issues[0];
      const isPasswordIssue = issue?.path[0] === "password";
      if (isPasswordIssue) {
        return jsonError(
          c,
          422,
          "weak_password",
          "Password must be at least 8 characters",
        );
      }
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    try {
      await consumeReset(deps.db, parsed.data);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof PasswordResetError) {
        return jsonError(
          c,
          err.status as ContentfulStatusCode,
          err.code,
          err.message,
        );
      }
      throw err;
    }
  });

  return router;
}

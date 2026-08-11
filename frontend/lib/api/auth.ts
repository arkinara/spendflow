/* ============================================================================
 * SpendFlow — Password-reset FE API client (#69).
 *
 * Mirrors the `apiFetch` + typed-error convention used by the rest of the FE
 * (`lib/api/users.ts`, `lib/api/claims.ts`, …). Both endpoints live under
 * `/api/auth/*` but are SpendFlow-owned (see `backend/src/routes/auth.ts`):
 *   - POST /api/auth/forgot-password  (public, rate-limited 5/IP/hour)
 *   - POST /api/auth/reset-password   (public, validates token + new password)
 *
 * Errors are thrown as `AuthApiError` so the page can branch on the typed
 * `code`. The backend emits:
 *   - `rate_limited`      (429, only on forgot-password)
 *   - `invalid_token`     (401, unknown or expired token)
 *   - `already_used`      (410, token consumed)
 *   - `weak_password`     (422, password < 8 chars)
 *   - `invalid_body`      (400, malformed payload)
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";

/** Typed error carrying the backend's status + code + message. */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Present on `rate_limited` (429) — seconds until the bucket resets. */
  readonly retryAfterSeconds?: number;
  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface BackendErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retry_after_seconds?: number;
  };
}

async function readError(res: Response): Promise<never> {
  let code = "internal";
  let message = `Request failed (${res.status}).`;
  let retryAfterSeconds: number | undefined;
  try {
    const body = (await res.json()) as BackendErrorEnvelope | undefined;
    const err = body?.error;
    if (err && typeof err === "object") {
      if (typeof err.code === "string") code = err.code;
      if (typeof err.message === "string" && err.message.trim()) message = err.message;
      if (typeof err.retry_after_seconds === "number") {
        retryAfterSeconds = err.retry_after_seconds;
      }
    }
  } catch {
    // non-JSON body — keep the status-derived fallback
  }
  throw new AuthApiError(res.status, code, message, retryAfterSeconds);
}

/**
 * `POST /api/auth/forgot-password`. Always resolves on a 2xx with the same
 * message the BE returns for known + unknown emails (no enumeration). A 429
 * rejects with `AuthApiError(code: "rate_limited")` carrying
 * `retryAfterSeconds`; the caller surfaces that copy inline.
 */
export async function forgotPassword(email: string): Promise<{ message: string }> {
  const res = await apiFetch(`/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) await readError(res);
  return res.json() as Promise<{ message: string }>;
}

/**
 * `POST /api/auth/reset-password`. Resolves to `{ ok: true }` on success (the
 * BE returns a tiny envelope — there is no user payload to leak). Rejects with
 * one of: `invalid_token` (401), `already_used` (410), `weak_password` (422),
 * `invalid_body` (400).
 */
export async function resetPassword(
  token: string,
  password: string,
): Promise<{ ok: true }> {
  const res = await apiFetch(`/api/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) await readError(res);
  return { ok: true as const };
}

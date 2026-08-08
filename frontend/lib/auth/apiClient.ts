import type { Role } from "@/lib/types";

/**
 * HTTP client for the Better Auth + Drizzle backend (ticket #17).
 *
 * The backend owns all auth state; the FE just calls these REST endpoints with
 * `credentials: "include"` so the httpOnly session cookie travels on every
 * request. A thin typed wrapper is used (rather than `better-auth/client` or
 * `@better-auth/react`) because the BE exposes plain REST endpoints and this
 * keeps the request/response shapes fully under our control and trivially
 * testable by mocking `global.fetch`. See README "Auth wiring" for the
 * rationale.
 */

export const BE_URL =
  process.env.NEXT_PUBLIC_BE_URL || "http://localhost:8787";

/** Typed error carrying the backend's status + message so the UI can show it. */
export class AuthError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

/** Authenticated user shape returned by the backend (`GET /api/me`).
 *  `roles`/`primaryRole` land from #44 onward; kept optional on the wire so
 *  the hydrator (`session.applyUser`) can default them from `role` when an
 *  older BE or a partial test mock omits them. Production BE always sends both. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  roles?: Role[];
  primaryRole?: Role;
  jobTitle?: string | null;
  department?: string | null;
  managerId?: string | null;
}

function beUrl(path: string): string {
  return `${BE_URL}${path}`;
}

/**
 * Best-effort extraction of a human-readable message from a non-2xx response.
 * Better Auth's error envelope is `{ error: { message, code, status } }`; we
 * also tolerate `{ message }` / `{ error: "string" }` / a plain string.
 */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const err =
      body && typeof body === "object" && "error" in body
        ? (body as { error: unknown }).error
        : body;
    if (err && typeof err === "object") {
      const e = err as { message?: unknown; code?: unknown };
      const msg = e.message ?? e.code;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
    if (typeof err === "string" && err.trim()) return err;
  } catch {
    // non-JSON body — fall through to the status-text fallback below
  }
  return `Authentication request failed (${res.status}).`;
}

/**
 * POST credentials to the Better Auth login endpoint. Resolves to the
 * authenticated user (with `role`) and lets the browser store the session
 * cookie via `credentials: "include"`. Throws `AuthError` on any non-2xx.
 */
export async function signIn(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(beUrl("/api/auth/sign-in/email"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new AuthError(res.status, await readErrorMessage(res));
  const body = (await res.json().catch(() => ({}))) as { user?: AuthUser } & Record<string, unknown>;
  const user = body.user ?? (body as unknown as AuthUser);
  if (!user || typeof user !== "object" || !user.id || !user.role) {
    throw new AuthError(res.status, "Sign-in response did not include a user.");
  }
  return user;
}

/**
 * Invalidate the server-side session. Always resolves (even on network/BE
 * errors) so the caller can clear the FE state unconditionally — a stranded
 * cookie is harmless once the FE has dropped its session and routed to /login.
 */
export async function signOut(): Promise<void> {
  try {
    await fetch(beUrl("/api/auth/sign-out"), {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // BE unreachable or already signed out — FE state is cleared upstream.
  }
}

/**
 * Read the current authenticated user from `GET /api/me`. Returns `null` on
 * 401 (no/invalid session — not an exceptional condition); throws `AuthError`
 * on other non-2xx responses so unexpected failures surface rather than
 * silently signing the user out.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch(beUrl("/api/me"), {
    method: "GET",
    credentials: "include",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new AuthError(res.status, await readErrorMessage(res));
  const body = (await res.json().catch(() => null)) as { user?: AuthUser } | null;
  if (!body) return null;
  return body.user ?? null;
}

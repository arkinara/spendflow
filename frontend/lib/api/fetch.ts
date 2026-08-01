import { BE_URL } from "@/lib/auth/apiClient";

/**
 * Global 401 handler for non-auth API calls (claims, approvals, finance, …).
 *
 * Auth endpoints under `/api/auth/*` are handled directly by `apiClient.ts`;
 * every other domain call should go through `apiFetch()` so that an expired
 * session is caught once, in one place, and the FE is reset to the login
 * screen. The reset itself is delegated to a registered callback
 * (`registerUnauthorizedHandler`) so this module stays free of React/router
 * imports; `SessionProvider` wires the callback on mount.
 */

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Register (or clear, with `null`) the single global 401 callback. Called by
 * `SessionProvider` on mount and torn down on unmount.
 */
export function registerUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  unauthorizedHandler = fn;
}

/**
 * Fetch wrapper that targets the backend base URL, always sends credentials,
 * and fires the global 401 handler when any response comes back unauthorized.
 * Returns the raw `Response` so callers can read status/body as needed.
 *
 * Relative paths are resolved against `BE_URL`; absolute URLs (e.g. a future
 * CDN) pass through untouched.
 */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = /^https?:\/\//.test(input) ? input : `${BE_URL}${input}`;
  return fetch(url, { credentials: "include", ...init }).then((res) => {
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
    return res;
  });
}

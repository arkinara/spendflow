/* ============================================================================
 * SpendFlow — Notification HTTP client (ticket #22, FE wiring).
 *
 * Thin typed wrapper over `/api/notifications*` (BE #15). Every call goes
 * through `apiFetch` (#17), which sends `credentials: "include"` (httpOnly
 * session cookie) and resolves against `NEXT_PUBLIC_BE_URL`. Non-2xx
 * responses are thrown as `NotificationApiError` carrying the backend's
 * `code` + `message` so the UI can surface them inline.
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";

/** Typed error carrying the backend's status + code + message. */
export class NotificationApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "NotificationApiError";
    this.status = status;
    this.code = code;
  }
}

/** JSON shape returned by the backend's `NotificationRow` serialiser. */
export interface BackendNotification {
  id: string;
  recipientId: string;
  category: "approval" | "action" | "payment" | "system";
  title: string;
  body: string;
  claimId?: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListFilters {
  unreadOnly?: boolean;
}

/* --------------------------------------------------------------- error helper */

async function readError(res: Response): Promise<never> {
  let code = "internal";
  let message = `Request failed (${res.status}).`;
  try {
    const body = await res.json();
    const err = body?.error;
    if (err && typeof err === "object") {
      if (typeof err.code === "string") code = err.code;
      if (typeof err.message === "string" && err.message.trim()) message = err.message;
    } else if (typeof err === "string" && err.trim()) {
      message = err;
    } else if (typeof body?.message === "string" && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // non-JSON body — keep the status-derived fallback
  }
  throw new NotificationApiError(res.status, code, message);
}

/** Read + parse a JSON envelope, throwing `NotificationApiError` on non-2xx. */
async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) await readError(res);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NotificationApiError(res.status, "internal", "Invalid JSON response from backend.");
  }
}

/* ----------------------------------------------------------------- methods */

/** `GET /api/notifications?unread=true` — the caller's own notifications, newest first. */
export async function list(filters: NotificationListFilters = {}): Promise<BackendNotification[]> {
  const qs = filters.unreadOnly ? "?unread=true" : "";
  const body = await parseJson<{ notifications: BackendNotification[] }>(
    await apiFetch(`/api/notifications${qs}`, { method: "GET" }),
  );
  return body.notifications;
}

/** `POST /api/notifications/:id/read` — mark one notification read. */
export async function markRead(id: string): Promise<BackendNotification> {
  const body = await parseJson<{ notification: BackendNotification }>(
    await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
    }),
  );
  return body.notification;
}

/** `GET /api/notifications/unread-count` — unread count for the caller. */
export async function unreadCount(): Promise<number> {
  const body = await parseJson<{ count: number }>(
    await apiFetch(`/api/notifications/unread-count`, { method: "GET" }),
  );
  return body.count;
}

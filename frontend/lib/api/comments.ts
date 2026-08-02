/* ============================================================================
 * SpendFlow — Claim comments HTTP client (ticket #19, FE wiring).
 *
 * Thin typed wrapper over `/api/claims/:id/comments` (BE #15). Used by both
 * the employee comments page (#18) and the approver review page's comment
 * composer (#19). Both verticals share the same BE route; the session
 * determines the author. Non-2xx responses are thrown as `CommentApiError`
 * carrying the backend's `code` + `message` so the UI can surface them inline
 * (empty-body 400s, cross-claim 403s, …).
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";

/** Typed error carrying the backend's status + code + message. */
export class CommentApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CommentApiError";
    this.status = status;
    this.code = code;
  }
}

/** JSON shape returned by the backend's `CommentRow` serialiser. */
export interface BackendComment {
  id: string;
  claimId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
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
  throw new CommentApiError(res.status, code, message);
}

/** Read + parse a JSON envelope, throwing `CommentApiError` on non-2xx. */
async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) await readError(res);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CommentApiError(res.status, "internal", "Invalid JSON response from backend.");
  }
}

/* ----------------------------------------------------------------- methods */

/** `GET /api/claims/:id/comments` — chronological list (oldest first). */
export async function listComments(claimId: string): Promise<BackendComment[]> {
  const body = await parseJson<{ comments: BackendComment[] }>(
    await apiFetch(`/api/claims/${encodeURIComponent(claimId)}/comments`, {
      method: "GET",
    }),
  );
  return body.comments;
}

/**
 * `POST /api/claims/:id/comments` — add a comment. The BE rejects empty bodies
 * with a 400 (`invalid_body`); participants-only access is enforced with a
 * 403 (`forbidden`). Resolves to the stored comment row.
 */
export async function addComment(claimId: string, body: string): Promise<BackendComment> {
  const res = await apiFetch(`/api/claims/${encodeURIComponent(claimId)}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  const parsed = await parseJson<{ comment: BackendComment }>(res);
  return parsed.comment;
}

/* ============================================================================
 * SpendFlow — claim comments + audit history HTTP routes (ticket #15).
 *
 * GET  /api/claims/:id/comments — list comments, oldest first
 * POST /api/claims/:id/comments — add a comment
 * GET  /api/claims/:id/audit    — full audit timeline, oldest first
 *
 * All routes require an authenticated session and are scoped to claim
 * participants (submitter, current/former approver, finance admin); a caller
 * with no access is rejected with 403.
 * ========================================================================== */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Auth } from "../auth/index.js";
import { AuthError, requireUser } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import { ClaimError, loadClaimOrThrow } from "../services/claims.js";
import {
  CommentError,
  addComment,
  listComments,
  listCommentAuthors,
} from "../services/comments.js";
import { isClaimParticipant } from "../services/participants.js";
import { listAuditForClaim } from "../services/audit.js";
import { jsonError } from "./claims.js";

const addCommentSchema = z.object({
  body: z.string().min(1),
});

export function commentRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();

  router.get("/api/claims/:id/comments", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const comments = listComments(deps.db, c.req.param("id"), ctx.user.id);
    return c.json({ comments });
  });

  router.post("/api/claims/:id/comments", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => ({}));
    const parsed = addCommentSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", "Comment body is required");
    }
    const comment = addComment(
      deps.db,
      c.req.param("id"),
      ctx.user.id,
      ctx.user.name,
      parsed.data.body
    );
    return c.json({ comment }, 201);
  });

  router.get("/api/claims/:id/comment-authors", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const participants = listCommentAuthors(deps.db, c.req.param("id"), ctx.user.id);
    return c.json({ participants });
  });

  router.get("/api/claims/:id/audit", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const claimId = c.req.param("id");
    const claim = loadClaimOrThrow(deps.db, claimId);
    if (!isClaimParticipant(deps.db, claim, ctx.user.id)) {
      return jsonError(c, 403, "forbidden", "You do not have access to this claim");
    }
    const entries = listAuditForClaim(deps.db, claimId);
    return c.json({ entries });
  });

  return router;
}

/** Map comment/claim/auth errors to JSON responses (mounted once on the app). */
export function commentErrorHandler(err: unknown, c: Context) {
  if (err instanceof CommentError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  if (err instanceof ClaimError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  if (err instanceof AuthError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  const msg = err instanceof Error ? err.message : "Internal error";
  return jsonError(c, 500, "internal", msg);
}

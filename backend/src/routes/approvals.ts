/* ============================================================================
 * SpendFlow — Approver inbox + decisioning HTTP routes (ticket #12).
 *
 * GET /api/approver/inbox                  — claims at the caller's step
 * GET /api/approver/claims/:id             — claim detail for review
 * POST /api/approver/claims/:id/decisions  — approve/reject/request_changes
 *
 * All routes require an authenticated session; the inbox + decision paths are
 * additionally scoped server-side so an approver only ever sees/acts on claims
 * currently sitting at their step.
 * ========================================================================== */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Auth } from "../auth/index.js";
import { AuthError, requireUser } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import {
  ApprovalError,
  approverInbox,
  getApproverClaimDetail,
  recordDecision,
} from "../services/approvals.js";
import { jsonError } from "./claims.js";

const decisionSchema = z.object({
  action: z.enum(["approve", "reject", "request_changes"]),
  comment: z.string().optional(),
});

export function approvalRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();

  router.get("/api/approver/inbox", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const sortBy = (c.req.query("sort_by") as "submitted_at" | "amount" | undefined) ?? "submitted_at";
    const sortDir = (c.req.query("sort_dir") as "asc" | "desc" | undefined) ?? "desc";
    const items = approverInbox(deps.db, ctx.user.id, ctx.user.role, { sortBy, sortDir });
    return c.json({ items });
  });

  router.get("/api/approver/claims/:id", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const detail = getApproverClaimDetail(
      deps.db,
      ctx.user.id,
      ctx.user.role,
      c.req.param("id")
    );
    return c.json({ claim: detail });
  });

  router.post("/api/approver/claims/:id/decisions", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => ({}));
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    const result = recordDecision(
      deps.db,
      ctx.user.id,
      ctx.user.role,
      c.req.param("id"),
      parsed.data
    );
    return c.json(result);
  });

  return router;
}

/** Map approval service errors to JSON responses. */
export function approvalErrorHandler(err: unknown, c: Context) {
  if (err instanceof ApprovalError) {
    return jsonError(
      c,
      err.status as ContentfulStatusCode,
      err.code,
      err.message
    );
  }
  if (err instanceof AuthError) {
    return jsonError(
      c,
      err.status as ContentfulStatusCode,
      err.code,
      err.message
    );
  }
  const msg = err instanceof Error ? err.message : "Internal error";
  return jsonError(c, 500, "internal", msg);
}

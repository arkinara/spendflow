/* ============================================================================
 * SpendFlow — Finance exception + payment lifecycle HTTP routes (ticket #13).
 *
 * GET  /api/finance/exceptions                    — open-flag exception queue
 * POST /api/finance/exceptions/:claimId/resolve    — override | reject
 * GET  /api/finance/payments                       — Approved/Processing/Paid
 * POST /api/finance/payments/:claimId/processing    — capture method+reference
 * POST /api/finance/payments/:claimId/paid          — mark paid
 *
 * Every route requires an authenticated session with role `finance` (Finance
 * Admin) — enforced via the shared `requireRole` middleware (#10).
 * ========================================================================== */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Auth } from "../auth/index.js";
import { AuthError, requireRole } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import { PAYMENT_METHODS } from "../db/schema.js";
import {
  FinanceError,
  getFinanceExceptions,
  getFinancePayments,
  markClaimPaid,
  markClaimProcessing,
  resolveException,
} from "../services/finance.js";
import { jsonError } from "./claims.js";

const resolveSchema = z.object({
  action: z.enum(["override", "reject"]),
  lineItemId: z.string().optional(),
  comment: z.string().optional(),
});

const processingSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().min(1),
});

export function financeRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();

  router.get("/api/finance/exceptions", async (c) => {
    await requireRole(deps.auth, c.req.raw.headers, "finance");
    const items = getFinanceExceptions(deps.db);
    return c.json({ items });
  });

  router.post("/api/finance/exceptions/:claimId/resolve", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = resolveSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    const result = resolveException(deps.db, ctx.user.id, c.req.param("claimId"), {
      action: parsed.data.action,
      lineItemId: parsed.data.lineItemId,
      comment: parsed.data.comment ?? "",
    });
    return c.json(result);
  });

  router.get("/api/finance/payments", async (c) => {
    await requireRole(deps.auth, c.req.raw.headers, "finance");
    const groups = getFinancePayments(deps.db);
    return c.json(groups);
  });

  router.post("/api/finance/payments/:claimId/processing", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = processingSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    const result = markClaimProcessing(deps.db, ctx.user.id, c.req.param("claimId"), parsed.data);
    return c.json(result);
  });

  router.post("/api/finance/payments/:claimId/paid", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    // #75 — markClaimPaid is async so the post-tx webhook fan-out can complete
    // before the response is sent; missing `await` serialises the unresolved
    // Promise into an empty object (`{claim:undefined, payment:undefined}`).
    const result = await markClaimPaid(deps.db, ctx.user.id, c.req.param("claimId"));
    return c.json(result);
  });

  return router;
}

/** Map finance service errors to JSON responses (mounted once on the app). */
export function financeErrorHandler(err: unknown, c: Context) {
  if (err instanceof FinanceError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  if (err instanceof AuthError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  const msg = err instanceof Error ? err.message : "Internal error";
  return jsonError(c, 500, "internal", msg);
}

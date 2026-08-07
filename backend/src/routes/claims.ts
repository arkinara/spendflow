/* ============================================================================
 * SpendFlow — Claim & line-item HTTP routes (ticket #11).
 *
 * All routes require an authenticated session (requireUser). Mutations are
 * scoped to the owning employee at the service layer; reads are scoped by
 * identity (employees see only their own claims; finance sees all).
 * ========================================================================== */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Auth } from "../auth/index.js";
import { AuthError, requireUser } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import {
  ClaimError,
  addLineItem,
  createClaim,
  deleteClaim,
  getClaim,
  getOwnedClaim,
  listClaimsForEmployee,
  removeLineItem,
  resubmitClaim,
  submitClaim,
  updateClaim,
  updateLineItem,
  withdrawClaim,
  type LineItemInput,
} from "../services/claims.js";

export function jsonError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string
) {
  return c.json({ error: { code, message } }, status);
}

const lineItemSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().min(1),
  description: z.string().optional().default(""),
  date: z.string().min(1),
  amount: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  quantity: z.number().nonnegative().optional(),
  unitLabel: z.string().optional(),
  note: z.string().optional(),
});

const createClaimSchema = z.object({
  title: z.string().min(1),
  purpose: z.string().optional().default(""),
  currency: z.string().optional(),
  tripStart: z.string().optional(),
  tripEnd: z.string().optional(),
  destination: z.string().optional(),
  lineItems: z.array(lineItemSchema).optional(),
});

const updateClaimSchema = z.object({
  title: z.string().min(1).optional(),
  purpose: z.string().optional(),
  currency: z.string().optional(),
  tripStart: z.string().nullable().optional(),
  tripEnd: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
});

const updateLineItemSchema = z.object({
  categoryId: z.string().min(1),
  description: z.string().optional(),
  date: z.string().min(1),
  quantity: z.number().nonnegative().optional(),
  unitLabel: z.string().optional(),
  note: z.string().optional(),
  currency: z.string().optional(),
  amount: z.number().nonnegative().optional(),
});

export function claimsRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();

  /* ------------------------------------------------------- list + create -- */

  router.get("/api/claims", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const status = c.req.query("status")?.split(",").filter(Boolean);
    const claims = listClaimsForEmployee(
      deps.db,
      ctx.user.id,
      status ? { status: status as never } : undefined
    );
    return c.json({ claims });
  });

  router.post("/api/claims", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => ({}));
    const parsed = createClaimSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    const claim = createClaim(deps.db, ctx.user.id, parsed.data);
    return c.json({ claim }, 201);
  });

  /* --------------------------------------------------------- read + edit -- */

  router.get("/api/claims/:id", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const claim = getClaim(deps.db, c.req.param("id"));
    if (!claim) return jsonError(c, 404, "not_found", "Claim not found");
    const allowed =
      claim.employeeId === ctx.user.id || ctx.user.roles.includes("finance");
    if (!allowed) {
      return jsonError(c, 403, "forbidden", "Not allowed to view this claim");
    }
    return c.json({ claim });
  });

  router.patch("/api/claims/:id", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => ({}));
    const parsed = updateClaimSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    const claim = updateClaim(
      deps.db,
      c.req.param("id"),
      ctx.user.id,
      parsed.data
    );
    return c.json({ claim });
  });

  router.delete("/api/claims/:id", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    deleteClaim(deps.db, c.req.param("id"), ctx.user.id);
    return c.json({ ok: true });
  });

  /* ------------------------------------------------------- submit/etc ---- */

  router.post("/api/claims/:id/submit", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const result = submitClaim(deps.db, c.req.param("id"), ctx.user.id);
    return c.json(result);
  });

  router.post("/api/claims/:id/resubmit", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const result = resubmitClaim(deps.db, c.req.param("id"), ctx.user.id);
    return c.json(result);
  });

  router.post("/api/claims/:id/withdraw", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => ({}));
    const comment =
      typeof body?.comment === "string" ? body.comment : undefined;
    const claim = withdrawClaim(
      deps.db,
      c.req.param("id"),
      ctx.user.id,
      comment
    );
    return c.json({ claim });
  });

  /* ----------------------------------------------------------- line items */

  router.post("/api/claims/:id/line-items", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => ({}));
    const parsed = lineItemSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    const line = addLineItem(
      deps.db,
      c.req.param("id"),
      ctx.user.id,
      parsed.data satisfies LineItemInput
    );
    return c.json({ lineItem: line }, 201);
  });

  router.patch("/api/claims/:id/line-items/:lineId", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const body = await c.req.json().catch(() => ({}));
    const parsed = updateLineItemSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    const line = updateLineItem(
      deps.db,
      c.req.param("id"),
      c.req.param("lineId"),
      ctx.user.id,
      parsed.data
    );
    return c.json({ lineItem: line });
  });

  router.delete("/api/claims/:id/line-items/:lineId", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    removeLineItem(
      deps.db,
      c.req.param("id"),
      c.req.param("lineId"),
      ctx.user.id
    );
    return c.json({ ok: true });
  });

  /* ----------------------------------------------------- preview own claim */
  // Owner snapshot used by the wizard before submit; only succeeds when the
  // caller owns the claim.
  router.get("/api/claims/:id/owned", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const claim = getOwnedClaim(deps.db, c.req.param("id"), ctx.user.id);
    return c.json({ claim });
  });

  return router;
}

/** Map service-layer errors to JSON responses (mounted once on the app). */
export function claimErrorHandler(err: unknown, c: Context) {
  if (err instanceof ClaimError) {
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

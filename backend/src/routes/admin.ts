/* ============================================================================
 * SpendFlow — Policy, Category & Approval Routing Administration HTTP routes
 * (ticket #14).
 *
 * GET/POST/PATCH/DELETE /api/admin/categories[/:id]
 * GET/POST/PATCH/DELETE /api/admin/policies[/:id]
 * GET/POST/PATCH        /api/admin/routes[/:id]
 * POST                  /api/admin/routes/:id/reorder
 * DELETE                /api/admin/routes/:id
 *
 * Every route requires an authenticated session with role `finance` (Finance
 * Admin) — enforced via the shared `requireRole` middleware (#10). DELETE
 * never removes a row: it deactivates (soft delete), same as every other
 * admin mutation in this codebase.
 * ========================================================================== */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Auth } from "../auth/index.js";
import { AuthError, requireRole } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import { APPROVER_TYPES } from "../db/schema.js";
import {
  AdminError,
  addCategory,
  addPolicy,
  addRoute,
  deactivateCategory,
  deactivatePolicy,
  deactivateRoute,
  editCategory,
  editPolicy,
  editRoute,
  listCategories,
  listPolicies,
  listRoutes,
  reorderRouteSteps,
} from "../services/admin.js";
import { jsonError } from "./claims.js";

const categoryCreateSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  requiresReceipt: z.boolean().optional(),
  receiptThreshold: z.number().int().min(0).optional(),
  perItemCap: z.number().int().min(1).nullable().optional(),
  mileageRate: z.number().int().min(1).nullable().optional(),
});
const categoryEditSchema = categoryCreateSchema.partial();

const policyCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().min(1),
  limitAmount: z.number(),
  period: z.enum(["per_item", "per_day", "per_trip", "per_month"]).optional(),
  currency: z.string().min(1),
  receiptRequired: z.boolean().optional(),
  receiptRequiredAbove: z.number().int().min(0).optional(),
  justificationRequiredAbove: z.number().int().min(0).optional(),
  effectiveDate: z.string().min(1),
});
const policyEditSchema = policyCreateSchema.partial();

const routeStepSchema = z.object({
  approverType: z.enum(APPROVER_TYPES),
  approverId: z.string().min(1).nullable().optional(),
  label: z.string().min(1),
});
const routeCreateSchema = z.object({
  name: z.string().min(1),
  matchMinAmount: z.number().int().nullable().optional(),
  matchMaxAmount: z.number().int().nullable().optional(),
  matchCategoryId: z.string().min(1).nullable().optional(),
  matchDepartment: z.string().min(1).nullable().optional(),
  isFallback: z.boolean().optional(),
  steps: z.array(routeStepSchema),
});
const routeEditSchema = routeCreateSchema.partial();
const reorderSchema = z.object({
  stepIds: z.array(z.string().min(1)).min(1),
});

export function adminRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();

  /* ------------------------------------------------------------ categories -- */

  router.get("/api/admin/categories", async (c) => {
    await requireRole(deps.auth, c.req.raw.headers, "finance");
    return c.json({ categories: listCategories(deps.db) });
  });

  router.post("/api/admin/categories", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = categoryCreateSchema.safeParse(body);
    if (!parsed.success) return jsonError(c, 400, "invalid_body", parsed.error.message);
    const category = addCategory(deps.db, ctx.user.id, parsed.data);
    return c.json({ category });
  });

  router.patch("/api/admin/categories/:id", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = categoryEditSchema.safeParse(body);
    if (!parsed.success) return jsonError(c, 400, "invalid_body", parsed.error.message);
    const category = editCategory(deps.db, ctx.user.id, c.req.param("id"), parsed.data);
    return c.json({ category });
  });

  router.delete("/api/admin/categories/:id", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const category = deactivateCategory(deps.db, ctx.user.id, c.req.param("id"));
    return c.json({ category });
  });

  /* --------------------------------------------------------------- policies -- */

  router.get("/api/admin/policies", async (c) => {
    await requireRole(deps.auth, c.req.raw.headers, "finance");
    return c.json({ policies: listPolicies(deps.db) });
  });

  router.post("/api/admin/policies", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = policyCreateSchema.safeParse(body);
    if (!parsed.success) return jsonError(c, 400, "invalid_body", parsed.error.message);
    const policy = addPolicy(deps.db, ctx.user.id, parsed.data);
    return c.json({ policy });
  });

  router.patch("/api/admin/policies/:id", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = policyEditSchema.safeParse(body);
    if (!parsed.success) return jsonError(c, 400, "invalid_body", parsed.error.message);
    const policy = editPolicy(deps.db, ctx.user.id, c.req.param("id"), parsed.data);
    return c.json({ policy });
  });

  router.delete("/api/admin/policies/:id", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const policy = deactivatePolicy(deps.db, ctx.user.id, c.req.param("id"));
    return c.json({ policy });
  });

  /* ----------------------------------------------------------------- routes -- */

  router.get("/api/admin/routes", async (c) => {
    await requireRole(deps.auth, c.req.raw.headers, "finance");
    return c.json({ routes: listRoutes(deps.db) });
  });

  router.post("/api/admin/routes", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = routeCreateSchema.safeParse(body);
    if (!parsed.success) return jsonError(c, 400, "invalid_body", parsed.error.message);
    const route = addRoute(deps.db, ctx.user.id, parsed.data);
    return c.json({ route });
  });

  router.patch("/api/admin/routes/:id", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = routeEditSchema.safeParse(body);
    if (!parsed.success) return jsonError(c, 400, "invalid_body", parsed.error.message);
    const route = editRoute(deps.db, ctx.user.id, c.req.param("id"), parsed.data);
    return c.json({ route });
  });

  router.post("/api/admin/routes/:id/reorder", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) return jsonError(c, 400, "invalid_body", parsed.error.message);
    const route = reorderRouteSteps(deps.db, ctx.user.id, c.req.param("id"), parsed.data.stepIds);
    return c.json({ route });
  });

  router.delete("/api/admin/routes/:id", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const route = deactivateRoute(deps.db, ctx.user.id, c.req.param("id"));
    return c.json({ route });
  });

  return router;
}

/** Map admin service errors to JSON responses. */
export function adminErrorHandler(err: unknown, c: Context) {
  if (err instanceof AdminError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  if (err instanceof AuthError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  const msg = err instanceof Error ? err.message : "Internal error";
  return jsonError(c, 500, "internal", msg);
}

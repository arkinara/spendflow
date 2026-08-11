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
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { Auth } from "../auth/index.js";
import { AuthError, requirePasswordReauth, requireRole } from "../auth/permissions.js";
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
import { hardDeleteUser } from "../services/users.js";
import { unblockClaim } from "../services/claims.js";
import { auditAll, type AuditAllFilters } from "../services/audit.js";
import { jsonError } from "./claims.js";

const userDeleteSchema = z.object({
  password: z.string().min(1, "Password is required for this action"),
});

/**
 * #48 — Finance Admin unblocks a `blocked_sod` claim. Body is refined per
 * action: `assign_manager` requires `managerId`; `reassign_step` requires
 * `stepId` + `newApproverId`. `resolution` is a required free-text
 * justification recorded on the audit entry (never empty).
 *
 * `password` (#64) is the actor's own password — verified against the stored
 * hash via `requirePasswordReauth` before the service mutates anything.
 */
const unblockSchema = z
  .object({
    resolution: z.string().min(1, "Resolution is required for audit"),
    action: z.enum(["assign_manager", "reassign_step"]),
    managerId: z.string().optional(),
    stepId: z.string().optional(),
    newApproverId: z.string().optional(),
    password: z.string().min(1, "Password is required for this action"),
  })
  .refine(
    (d) =>
      d.action === "assign_manager"
        ? !!d.managerId
        : !!d.stepId && !!d.newApproverId,
    {
      message:
        "assign_manager requires managerId; reassign_step requires stepId + newApproverId",
    }
  );

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

/* ------------------------------------------- dev invite log parsing (#66) --- */

/** Absolute path to the invite-log fallback (repo: backend/logs/invites.log).
 *  Overridable via `SPENDFLOW_INVITE_LOG` so tests point at a temp file. */
const DEFAULT_INVITE_LOG_PATH = new URL("../../logs/invites.log", import.meta.url).pathname;

/** Cap the tail read at 5KB so a huge log never blows up a dev request (#66). */
const INVITE_LOG_TAIL_BYTES = 5120;

/** One parsed `invites.log` line (see `logInviteEmail` in services/invites.ts). */
export interface DevInviteEntry {
  email: string;
  inviteUrl: string;
  sentAt: string;
}

const INVITE_LOG_LINE_RE = /^\[([^\]]+)\]\s+email=(\S+)\s+token=\S+\s+url=(\S+)\s*$/;

function parseInviteLogLine(line: string): DevInviteEntry | null {
  const m = INVITE_LOG_LINE_RE.exec(line.trim());
  if (!m) return null;
  return { email: m[2], inviteUrl: m[3], sentAt: m[1] };
}

/**
 * Read the last 5 lines of `invites.log`, parsed to `{ email, inviteUrl,
 * sentAt }`, newest first. Returns `null` when the log file doesn't exist
 * (the route maps that to 404). The tail is capped at `INVITE_LOG_TAIL_BYTES`;
 * if the read starts mid-line the partial first line is dropped.
 */
export function readRecentInviteEntries(): DevInviteEntry[] | null {
  const path = process.env.SPENDFLOW_INVITE_LOG ?? DEFAULT_INVITE_LOG_PATH;
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    const readFrom = Math.max(0, stat.size - INVITE_LOG_TAIL_BYTES);
    const buf = Buffer.alloc(stat.size - readFrom);
    readSync(fd, buf, 0, buf.length, readFrom);
    const lines = buf.toString("utf8").split("\n").filter((l) => l.trim() !== "");
    // A tail read that starts past byte 0 may split a line — drop that fragment.
    const start = readFrom === 0 ? 0 : 1;
    return lines
      .slice(start)
      .map(parseInviteLogLine)
      .filter((e): e is DevInviteEntry => e !== null)
      .slice(-5)
      .reverse();
  } finally {
    closeSync(fd);
  }
}

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

  /* ------------------------------------------------- user hard delete (#42, #64) */

  router.post("/api/admin/users/:id/delete", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = userDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", "Body must be { password: string }");
    }
    // #64: verify the actor's password through the shared step-up helper
    // (previously verified inside hardDeleteUser). AuthError(401,
    // missing_password|invalid_password) bubbles up via the global onError.
    await requirePasswordReauth(
      deps.auth,
      deps.db,
      c.req.raw.headers,
      parsed.data.password,
      ctx.user.id,
    );
    await hardDeleteUser(deps.db, c.req.param("id"), ctx.user.id);
    return c.body(null, 204);
  });

  /* ------------------------------------------- claim SoD unblock (#48, #64) */

  router.patch("/api/admin/claims/:id/unblock", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = unblockSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    // #64: step-up auth — verify the actor's password before unblocking.
    await requirePasswordReauth(
      deps.auth,
      deps.db,
      c.req.raw.headers,
      parsed.data.password,
      ctx.user.id,
    );
    const result = unblockClaim(deps.db, c.req.param("id"), ctx.user.id, parsed.data);
    return c.json({ claim: result.claim });
  });

  /* -------------------------- dev-only recent invite log (#66/#57b) ---------- */

  router.get("/api/admin/dev/recent-invites", async (c) => {
    await requireRole(deps.auth, c.req.raw.headers, "finance");
    const entries = readRecentInviteEntries();
    if (entries === null) {
      return jsonError(c, 404, "not_found", "Invite log not found.");
    }
    return c.json({ entries });
  });

  /* --------------------------- global audit viewer (#71) -------------------- */

  router.get("/api/admin/audit", async (c) => {
    await requireRole(deps.auth, c.req.raw.headers, "finance");
    const q = c.req.query();
    const filters: AuditAllFilters = {};
    if (typeof q.action === "string" && q.action.length > 0) filters.action = q.action;
    if (typeof q.actor_id === "string" && q.actor_id.length > 0) filters.actorId = q.actor_id;
    if (typeof q.target_user_id === "string" && q.target_user_id.length > 0) {
      filters.targetUserId = q.target_user_id;
    }
    const fromNum = q.from !== undefined ? Number(q.from) : NaN;
    if (Number.isFinite(fromNum)) filters.from = fromNum;
    const toNum = q.to !== undefined ? Number(q.to) : NaN;
    if (Number.isFinite(toNum)) filters.to = toNum;
    const limitNum = q.limit !== undefined ? Number(q.limit) : NaN;
    if (Number.isFinite(limitNum)) filters.limit = limitNum;
    const entries = auditAll(deps.db, filters);
    return c.json({ entries });
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

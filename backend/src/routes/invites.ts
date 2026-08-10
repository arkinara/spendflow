/* ============================================================================
 * SpendFlow — User invitation HTTP routes (#38).
 *
 * POST /api/admin/users              create a pending user + invite token
 *                                     (Finance Admin only — requireRole)
 * GET  /api/admin/invites/:token      public invite validation / details
 * POST /api/admin/invites/:token/accept   public accept (set password, activate)
 *
 * The two invite routes are intentionally public: the opaque token is the
 * authentication, so no session/role check applies (mirrors the FE acceptance
 * flow). Errors surface as typed InviteError values handled by app.onError.
 * ========================================================================== */

import { Hono } from "hono";
import { z } from "zod";
import type { Auth } from "../auth/index.js";
import { requireRole } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import { ROLES } from "../types.js";
import {
  acceptInvite,
  createInviteForUser,
  getInviteDetails,
} from "../services/invites.js";
import { jsonError } from "./claims.js";

const createUserSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1),
    role: z.enum(ROLES).optional(),
    roles: z.array(z.enum(ROLES)).optional(),
    managerId: z.string().min(1).nullable().optional(),
    department: z.string().nullable().optional(),
    costCenter: z.string().nullable().optional(),
    jobTitle: z.string().nullable().optional(),
  })
  // Exactly one of the legacy single-role field or the new roles[] array.
  .refine(
    (d) => (d.role !== undefined ? 1 : 0) + (d.roles !== undefined ? 1 : 0) === 1,
    { message: "Provide exactly one of `role` or `roles`" },
  )
  .refine((d) => d.roles === undefined || d.roles.length > 0, {
    message: "`roles` must be a non-empty array",
    path: ["roles"],
  });

const acceptInviteSchema = z.object({
  password: z.string().min(8),
});

export function invitesRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();

  router.post("/api/admin/users", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    // Normalize the role/roles payload: legacy single-role callers send `role`,
    // new multi-role callers send `roles[]`. `createInviteForUser` reads both
    // (role is required for the audit + email label, roles overrides the set).
    const role = parsed.data.role ?? parsed.data.roles![0];
    const { user, invite, devHint } = await createInviteForUser(
      deps.db,
      { ...parsed.data, role, roles: parsed.data.roles },
      ctx.user.id,
      deps.env.feUrl,
    );
    return c.json({ user, invite, ...(devHint ? { devHint } : {}) }, 201);
  });

  router.get("/api/admin/invites/:token", (c) => {
    const details = getInviteDetails(deps.db, c.req.param("token"));
    return c.json(details);
  });

  router.post("/api/admin/invites/:token/accept", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = acceptInviteSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_password", "Password must be at least 8 characters");
    }
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("cf-connecting-ip") ??
      null;
    const { user, cookie } = await acceptInvite(
      deps,
      c.req.param("token"),
      parsed.data.password,
      ip
    );
    c.header("set-cookie", cookie);
    return c.json({ user });
  });

  return router;
}

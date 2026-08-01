import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Auth } from "./auth/index.js";
import { AuthError, dataScopeFor, requireRole, requireUser } from "./auth/permissions.js";
import type { DB } from "./db/index.js";
import type { Env } from "./config.js";
import {
  changeRole,
  asRole,
  listUsers,
  setManager,
  UserServiceError,
} from "./services/users.js";
import { auditForEntity } from "./services/audit.js";

export interface AppDeps {
  auth: Auth;
  db: DB;
  env: Env;
}

const roleSchema = z.enum(["employee", "approver", "finance"]);
const setManagerSchema = z.object({
  managerId: z.string().min(1).nullable(),
});

function jsonError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

/**
 * Build the Hono application wired to a specific auth + db pair. Factory form
 * so tests compose a fresh app against an isolated database.
 */
export function createApp({ auth, db, env }: AppDeps): Hono {
  const app = new Hono();

  const origins = env.frontendOrigin
    ? env.frontendOrigin.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  app.use(
    "/api/*",
    cors({
      origin: origins.length ? origins : "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
      maxAge: 600,
    })
  );

  // Better Auth owns all credential/session endpoints under /api/auth/*:
  //   POST /api/auth/sign-in/email   → login (issues session cookie)
  //   POST /api/auth/sign-out        → logout (invalidates the session)
  //   GET  /api/auth/get-session     → current session / "me" auth check
  //   POST /api/auth/sign-up/email   → create a credential user
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.onError((err, c) => {
    if (err instanceof AuthError) {
      return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
    }
    if (err instanceof UserServiceError) {
      const status: ContentfulStatusCode =
        err.code === "not_found" ? 404 : 400;
      return jsonError(c, status, err.code, err.message);
    }
    const msg = err instanceof Error ? err.message : "Internal error";
    return jsonError(c, 500, "internal", msg);
  });

  /* ----------------------------------------------------------- /api/me ---- */

  app.get("/api/me", async (c) => {
    const ctx = await requireUser(auth, c.req.raw.headers);
    return c.json({ user: ctx.user });
  });

  /* ------------------------------------------------- role-scoped demo ----- */
  // Proves dashboard/inbox queries filter by role + identity at the query layer
  // (not by hiding data client-side). Downstream domains consume the same
  // dataScopeFor() helper to build their WHERE clauses.

  app.get("/api/dashboard/inbox", async (c) => {
    const ctx = await requireUser(auth, c.req.raw.headers);
    const scope = dataScopeFor(ctx.user);
    const users = listUsers(db);
    const visible =
      scope.allData
        ? users
        : scope.ownOnly
          ? users.filter((u) => u.id === scope.userId)
          : users.filter(
              (u) => u.id === scope.userId || u.managerId === scope.managerId
            );
    return c.json({ scope, items: visible });
  });

  /* ---------------------------------------------------- admin: users ------ */

  app.get("/api/admin/users", async (c) => {
    await requireRole(auth, c.req.raw.headers, "finance");
    return c.json({ users: listUsers(db) });
  });

  app.patch("/api/admin/users/:id/role", async (c) => {
    const actor = await requireRole(auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = roleSchema.safeParse(body.role ?? body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_role", "Role must be one of: employee, approver, finance");
    }
    const role = asRole(parsed.data)!;
    const { user, audit } = changeRole(db, c.req.param("id"), role, actor.user.id);
    return c.json({ user, audit });
  });

  app.patch("/api/admin/users/:id/manager", async (c) => {
    const actor = await requireRole(auth, c.req.raw.headers, "finance");
    const body = await c.req.json().catch(() => ({}));
    const parsed = setManagerSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", "Body must be { managerId: string | null }");
    }
    const { user, audit } = setManager(
      db,
      c.req.param("id"),
      parsed.data.managerId,
      actor.user.id
    );
    return c.json({ user, audit });
  });

  app.get("/api/admin/users/:id/audit", async (c) => {
    await requireRole(auth, c.req.raw.headers, "finance");
    const entries = auditForEntity(db, "user", c.req.param("id"));
    return c.json({ entries });
  });

  return app;
}

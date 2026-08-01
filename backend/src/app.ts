import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Auth } from "./auth/index.js";
import { dataScopeFor, requireRole, requireUser } from "./auth/permissions.js";
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
import { AttachmentError } from "./services/attachments.js";
import { ApprovalError } from "./services/approvals.js";
import { FinanceError } from "./services/finance.js";
import { AdminError } from "./services/admin.js";
import { CommentError } from "./services/comments.js";
import { NotificationError } from "./services/notifications.js";
import { ReportingError } from "./services/reporting.js";
import {
  claimErrorHandler,
  claimsRoutes,
  jsonError,
} from "./routes/claims.js";
import { attachmentRoutes, attachmentErrorHandler } from "./routes/attachments.js";
import { approvalErrorHandler, approvalRoutes } from "./routes/approvals.js";
import { financeErrorHandler, financeRoutes } from "./routes/finance.js";
import { adminErrorHandler, adminRoutes } from "./routes/admin.js";
import { commentErrorHandler, commentRoutes } from "./routes/comments.js";
import { notificationErrorHandler, notificationRoutes } from "./routes/notifications.js";
import { reportingErrorHandler, reportingRoutes } from "./routes/reporting.js";

export interface AppDeps {
  auth: Auth;
  db: DB;
  env: Env;
}

const roleSchema = z.enum(["employee", "approver", "finance"]);
const setManagerSchema = z.object({
  managerId: z.string().min(1).nullable(),
});

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

  // Centralised error → JSON envelope. Each domain service has its own typed
  // error class; we route the error to its handler and fall back to the claim
  // handler (which covers ClaimError + AuthError + a generic 500).
  app.onError((err, c) => {
    if (err instanceof UserServiceError) {
      const status: ContentfulStatusCode =
        err.code === "not_found" ? 404 : 400;
      return jsonError(c, status, err.code, err.message);
    }
    if (err instanceof AttachmentError) {
      return attachmentErrorHandler(err, c);
    }
    if (err instanceof ApprovalError) {
      return approvalErrorHandler(err, c);
    }
    if (err instanceof FinanceError) {
      return financeErrorHandler(err, c);
    }
    if (err instanceof AdminError) {
      return adminErrorHandler(err, c);
    }
    if (err instanceof CommentError) {
      return commentErrorHandler(err, c);
    }
    if (err instanceof NotificationError) {
      return notificationErrorHandler(err, c);
    }
    if (err instanceof ReportingError) {
      return reportingErrorHandler(err, c);
    }
    return claimErrorHandler(err, c);
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
    const visible = scope.allData
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
      return jsonError(
        c,
        400,
        "invalid_role",
        "Role must be one of: employee, approver, finance"
      );
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
      return jsonError(
        c,
        400,
        "invalid_body",
        "Body must be { managerId: string | null }"
      );
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

  /* ------------------------------------------- #11 claims + attachments ---- */
  app.route("/", claimsRoutes({ auth, db, env }));
  app.route("/", attachmentRoutes({ auth, db, env }));

  /* ----------------------------------------------- #12 approver decisions -- */
  app.route("/", approvalRoutes({ auth, db, env }));

  /* ------------------------------------- #13 finance exceptions + payments -- */
  app.route("/", financeRoutes({ auth, db, env }));

  /* --------------------------------- #14 policy/category/routing admin API -- */
  app.route("/", adminRoutes({ auth, db, env }));

  /* --------------------------- #15 comments + notifications + audit query -- */
  app.route("/", commentRoutes({ auth, db, env }));
  app.route("/", notificationRoutes({ auth, db, env }));

  /* --------------------------- #16 reporting query + CSV export API ------- */
  app.route("/", reportingRoutes({ auth, db, env }));

  return app;
}

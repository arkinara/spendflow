import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Auth } from "./auth/index.js";
import { dataScopeFor, requireAnyRole, requirePasswordReauth, requireUser } from "./auth/permissions.js";
import type { DB } from "./db/index.js";
import type { Env } from "./config.js";
import {
  changeRoles,
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
import { invitesRoutes } from "./routes/invites.js";
import { authRoutes } from "./routes/auth.js";
import { InviteError } from "./services/invites.js";
import { PasswordResetError } from "./services/auth/password-reset.js";

export interface AppDeps {
  auth: Auth;
  db: DB;
  env: Env;
}

const roleSchema = z.enum(["employee", "approver", "finance"]);
// #64: password re-auth is required for the destructive role-change mutation.
// min(1) so an empty body fails at the schema layer with 400 invalid_body
// (defense in depth — `requirePasswordReauth` also guards `!password` itself).
const roleChangeSchema = z
  .object({
    role: roleSchema.optional(),
    roles: z.array(roleSchema).optional(),
    // Forward-compat placeholder (#33 status ride-along); ignored by the service.
    status: z.enum(["active", "disabled", "pending"]).optional(),
    password: z.string().min(1, "Password is required for this action"),
  })
  .refine(
    (d) => (d.role !== undefined ? 1 : 0) + (d.roles !== undefined ? 1 : 0) === 1,
    { message: "Provide exactly one of `role` or `roles`" },
  )
  .refine((d) => d.roles === undefined || d.roles.length > 0, {
    message: "`roles` must be a non-empty array",
    path: ["roles"],
  });
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

  // SpendFlow-owned public auth endpoints (#69): password reset / forgot
  // password. Mounted BEFORE the Better Auth catch-all below so the wildcard
  // handler doesn't swallow them — Better Auth returns 404 for unknown paths
  // under /api/auth/* and Hono does not fall through after a matched handler.
  app.route("/", authRoutes({ auth, db, env }));

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
      const status: ContentfulStatusCode = (err.status ??
        (err.code === "not_found" ? 404 : 400)) as ContentfulStatusCode;
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
    if (err instanceof InviteError) {
      return jsonError(
        c,
        err.status as ContentfulStatusCode,
        err.code,
        err.message
      );
    }
    if (err instanceof PasswordResetError) {
      return jsonError(
        c,
        err.status as ContentfulStatusCode,
        err.code,
        err.message
      );
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
    await requireAnyRole(auth, c.req.raw.headers, ["finance"]);
    return c.json({ users: listUsers(db) });
  });

  app.patch("/api/admin/users/:id/role", async (c) => {
    const actor = await requireAnyRole(auth, c.req.raw.headers, ["finance"]);
    const body = await c.req.json().catch(() => ({}));
    const parsed = roleChangeSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        "invalid_body",
        parsed.error.message,
      );
    }
    // #64: step-up auth — verify the actor's own password before mutating
    // roles. AuthError(401, missing_password|invalid_password) bubbles up to
    // the global onError → JSON envelope.
    await requirePasswordReauth(
      auth,
      db,
      c.req.raw.headers,
      parsed.data.password,
      actor.user.id,
    );
    const roles = parsed.data.roles ?? [parsed.data.role!];
    const { user, audit } = changeRoles(db, c.req.param("id"), roles, actor.user.id);
    return c.json({ user, audit });
  });

  app.patch("/api/admin/users/:id/manager", async (c) => {
    const actor = await requireAnyRole(auth, c.req.raw.headers, ["finance"]);
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
    await requireAnyRole(auth, c.req.raw.headers, ["finance"]);
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

  /* --------------------------- #38 user invites + acceptance ------------- */
  app.route("/", invitesRoutes({ auth, db, env }));

  return app;
}

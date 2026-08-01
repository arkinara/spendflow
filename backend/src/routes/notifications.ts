/* ============================================================================
 * SpendFlow — notification query HTTP routes (ticket #15).
 *
 * GET  /api/notifications             — list the caller's notifications
 * POST /api/notifications/:id/read    — mark one read
 * GET  /api/notifications/unread-count — unread count for the caller
 * ========================================================================== */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Auth } from "../auth/index.js";
import { AuthError, requireUser } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import {
  NotificationError,
  listNotifications,
  markRead,
  unreadCount,
} from "../services/notifications.js";
import { jsonError } from "./claims.js";

export function notificationRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();

  router.get("/api/notifications", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const unreadOnly = c.req.query("unread") === "true";
    const notifications = listNotifications(deps.db, ctx.user.id, { unreadOnly });
    return c.json({ notifications });
  });

  router.post("/api/notifications/:id/read", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const notification = markRead(deps.db, c.req.param("id"), ctx.user.id);
    return c.json({ notification });
  });

  router.get("/api/notifications/unread-count", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const count = unreadCount(deps.db, ctx.user.id);
    return c.json({ count });
  });

  return router;
}

/** Map notification/auth errors to JSON responses (mounted once on the app). */
export function notificationErrorHandler(err: unknown, c: Context) {
  if (err instanceof NotificationError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  if (err instanceof AuthError) {
    return jsonError(c, err.status as ContentfulStatusCode, err.code, err.message);
  }
  const msg = err instanceof Error ? err.message : "Internal error";
  return jsonError(c, 500, "internal", msg);
}

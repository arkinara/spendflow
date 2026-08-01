/* ============================================================================
 * SpendFlow — notification write + query service (ticket #10-#13, extended
 * #15 with the query/mark-read API).
 * ========================================================================== */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { notificationsTable, type NotificationCategory } from "../db/schema.js";
import type { DB } from "../db/index.js";

export class NotificationError extends Error {
  constructor(
    public status: number,
    public code: "not_found" | "forbidden",
    message: string
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export interface NotificationRow {
  id: string;
  recipientId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  claimId?: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Write a single notification row. Notification *delivery* mechanics beyond
 * row creation (email, push, Telegram) are out of scope for Phase 1; this
 * only stamps the row so the inbox/UI can surface it.
 */
export function writeNotification(
  db: DB,
  args: {
    recipientId: string;
    category: NotificationCategory;
    title: string;
    body: string;
    claimId?: string | null;
  }
): NotificationRow {
  const row: NotificationRow = {
    id: crypto.randomUUID(),
    recipientId: args.recipientId,
    category: args.category,
    title: args.title,
    body: args.body,
    claimId: args.claimId ?? null,
    readAt: null,
    createdAt: new Date(),
  };
  db.insert(notificationsTable)
    .values({
      id: row.id,
      recipientId: row.recipientId,
      category: row.category,
      title: row.title,
      body: row.body,
      claimId: row.claimId,
      readAt: null,
      createdAt: row.createdAt,
    })
    .run();
  return row;
}

/** A user's notifications, newest first; `unreadOnly` filters to unread. */
export function listNotifications(
  db: DB,
  userId: string,
  opts: { unreadOnly?: boolean } = {}
): NotificationRow[] {
  const where = opts.unreadOnly
    ? and(eq(notificationsTable.recipientId, userId), isNull(notificationsTable.readAt))
    : eq(notificationsTable.recipientId, userId);
  // Tiebreak on the implicit SQLite rowid so notifications written within the
  // same millisecond (e.g. a batched submit/decide/pay fan-out) still come back
  // in insertion order — newest insert has the highest rowid.
  return db
    .select()
    .from(notificationsTable)
    .where(where)
    .orderBy(desc(notificationsTable.createdAt), sql`rowid DESC`)
    .all();
}

/** Notifications addressed to a user, newest first (alias of listNotifications). */
export function notificationsFor(db: DB, recipientId: string): NotificationRow[] {
  return listNotifications(db, recipientId);
}

/** Count of unread notifications for a user. */
export function unreadCount(db: DB, userId: string): number {
  return db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.recipientId, userId), isNull(notificationsTable.readAt)))
    .all().length;
}

/**
 * Mark a notification read. Rejects a nonexistent id as not-found (never a
 * silent success) and rejects marking another user's notification as
 * forbidden.
 */
export function markRead(db: DB, notificationId: string, userId: string): NotificationRow {
  const row = db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.id, notificationId))
    .get();
  if (!row) {
    throw new NotificationError(404, "not_found", `Notification ${notificationId} not found`);
  }
  if (row.recipientId !== userId) {
    throw new NotificationError(403, "forbidden", "This notification does not belong to you");
  }
  const now = new Date();
  db.update(notificationsTable)
    .set({ readAt: now })
    .where(eq(notificationsTable.id, notificationId))
    .run();
  return { ...row, readAt: now };
}

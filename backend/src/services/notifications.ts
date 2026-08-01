import { desc, eq } from "drizzle-orm";
import { notificationsTable, type NotificationCategory } from "../db/schema.js";
import type { DB } from "../db/index.js";

export interface NotificationRow {
  id: string;
  recipientId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  claimId?: string | null;
  read: boolean;
  createdAt: Date;
}

/**
 * Write a single notification row. Notification *delivery* mechanics beyond
 * row creation (email, push, Telegram) are BE-notifications; this ticket only
 * stamps the row so the inbox/UI can surface it.
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
    read: false,
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
      read: row.read,
      createdAt: row.createdAt,
    })
    .run();
  return row;
}

/** Notifications addressed to a user, newest first. */
export function notificationsFor(db: DB, recipientId: string): NotificationRow[] {
  return db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.recipientId, recipientId))
    .orderBy(desc(notificationsTable.createdAt))
    .all();
}

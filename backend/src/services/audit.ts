import { desc, eq } from "drizzle-orm";
import { auditLogsTable } from "../db/schema.js";
import type { DB } from "../db/index.js";
import type { AuditEntry } from "../types.js";

/**
 * Append an immutable audit_log row capturing the actor and the before/after
 * state of a mutation. Snapshots are JSON-stringified for SQLite portability.
 */
export function writeAudit(
  db: DB,
  args: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  }
): AuditEntry {
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    actorId: args.actorId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    before: args.before ?? null,
    after: args.after ?? null,
    createdAt: new Date(),
  };
  db.insert(auditLogsTable)
    .values({
      id: entry.id,
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before === null || entry.before === undefined ? null : JSON.stringify(entry.before),
      after: entry.after === null || entry.after === undefined ? null : JSON.stringify(entry.after),
      createdAt: entry.createdAt,
    })
    .run();
  return entry;
}

export function auditForEntity(db: DB, entityType: string, entityId: string): AuditEntry[] {
  return db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.entityType, entityType))
    .orderBy(desc(auditLogsTable.createdAt))
    .all()
    .filter((row) => row.entityId === entityId)
    .map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.before ? JSON.parse(row.before) : null,
      after: row.after ? JSON.parse(row.after) : null,
      createdAt: row.createdAt,
    }));
}

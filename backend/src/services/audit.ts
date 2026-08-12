import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { auditLogsTable } from "../db/schema.js";
import type { DB } from "../db/index.js";
import type { AuditEntry } from "../types.js";
import { redactPII, redactSnapshot } from "./audit-redaction.js";

/**
 * #71 — filters accepted by `auditAll` and the `GET /api/admin/audit` route.
 * `from`/`to` are unix-seconds bounds against `audit_logs.created_at` (drizzle
 * `timestamp` mode stores the column as a unix-seconds integer, so the comparison
 * is a direct integer range). `limit` defaults to 100 and is clamped to 500.
 */
export interface AuditAllFilters {
  action?: string;
  from?: number;
  to?: number;
  actorId?: string;
  targetUserId?: string;
  limit?: number;
}

/** Hard cap on `auditAll` — guards against unbounded result sets (#71). */
export const AUDIT_ALL_MAX_LIMIT = 500;
export const AUDIT_ALL_DEFAULT_LIMIT = 100;

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
  // #77 — scrub PII / secrets before the snapshot is serialised. Snapshot is
  // also normalised so any embedded Date is rendered as ISO (JSON.stringify
  // would otherwise emit `{}-shaped` `{}` for Date instances stored inside
  // plain objects). Legacy rows written before this ticket are left as-is.
  const beforeRedacted = redactSnapshot(args.before);
  const afterRedacted = redactSnapshot(args.after);
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    actorId: args.actorId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    before: beforeRedacted ?? null,
    after: afterRedacted ?? null,
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
      before: redactPII(row.before ? JSON.parse(row.before) : null),
      after: redactPII(row.after ? JSON.parse(row.after) : null),
      createdAt: row.createdAt,
    }));
}

/**
 * Full audit timeline for a claim, chronological (ascending) order. There is
 * no update/delete path on `audit_logs` — this is a read-only projection over
 * the append-only table.
 */
export function listAuditForClaim(db: DB, claimId: string): AuditEntry[] {
  return db
    .select()
    .from(auditLogsTable)
    .where(
      and(eq(auditLogsTable.entityType, "claim"), eq(auditLogsTable.entityId, claimId))
    )
    .orderBy(asc(auditLogsTable.createdAt), sql`rowid ASC`)
    .all()
    .map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: redactPII(row.before ? JSON.parse(row.before) : null),
      after: redactPII(row.after ? JSON.parse(row.after) : null),
      createdAt: row.createdAt,
    }));
}

/**
 * #71 — Finance-Admin-wide audit view across every entity. Returns entries
 * newest-first, filtered by the optional {@link AuditAllFilters}. `limit`
 * defaults to {@link AUDIT_ALL_DEFAULT_LIMIT} and is clamped to
 * {@link AUDIT_ALL_MAX_LIMIT}. `from`/`to` are unix-seconds bounds (inclusive).
 *
 * Filters AND together: providing both `action` and `from` returns only rows
 * matching that action *and* created on/after `from`. No `userIds[]` fan-out
 * here — this is a single SELECT against `audit_logs`. Read-only.
 */
export function auditAll(db: DB, filters: AuditAllFilters = {}): AuditEntry[] {
  const requested = filters.limit ?? AUDIT_ALL_DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(requested, AUDIT_ALL_MAX_LIMIT));

  const conds = [];
  if (filters.action) conds.push(eq(auditLogsTable.action, filters.action));
  if (filters.actorId) conds.push(eq(auditLogsTable.actorId, filters.actorId));
  if (filters.targetUserId) conds.push(eq(auditLogsTable.entityId, filters.targetUserId));
  if (filters.from !== undefined) {
    conds.push(gte(auditLogsTable.createdAt, new Date(filters.from * 1000)));
  }
  if (filters.to !== undefined) {
    conds.push(lte(auditLogsTable.createdAt, new Date(filters.to * 1000)));
  }

  return db
    .select()
    .from(auditLogsTable)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(auditLogsTable.createdAt), sql`rowid DESC`)
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: redactPII(row.before ? JSON.parse(row.before) : null),
      after: redactPII(row.after ? JSON.parse(row.after) : null),
      createdAt: row.createdAt,
    }));
}

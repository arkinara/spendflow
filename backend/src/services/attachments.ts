/* ============================================================================
 * SpendFlow — Attachment storage service (ticket #11).
 *
 * Manual receipt attachments only — NO OCR, NO auto-extraction. The caller
 * supplies the file plus manually-entered merchant/amount/date/currency
 * metadata; this service persists both the bytes (local disk under
 * backend/uploads/) and the metadata row, and keeps the parent line item's
 * denormalised `has_receipt` flag in sync.
 * ========================================================================== */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import {
  approvalStepsTable,
  attachmentsTable,
  claimLineItemsTable,
  claimsTable,
  usersTable,
} from "../db/schema.js";
import type { DB } from "../db/index.js";
import type { Role } from "../types.js";
import { writeAudit } from "./audit.js";
import { getOwnedClaim, ClaimError } from "./claims.js";
import {
  LocalReceiptStorage,
  type ReceiptStorage,
  type StoredReceipt,
} from "./storage.js";

export class AttachmentError extends Error {
  constructor(
    public status: number,
    public code:
      | "not_found"
      | "forbidden"
      | "wrong_status"
      | "invalid_file"
      | "file_too_large"
      | "storage_failed",
    message: string
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

/** Allowed upload MIME types (images + PDF only, per ticket). */
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

/** Phase 1 soft cap: 10 MiB per file. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface StoredAttachment {
  id: string;
  lineItemId: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  sizeBytes: number;
  merchant: string | null;
  amount: number | null;
  currency: string | null;
  transactionDate: string | null;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface AttachmentMetadata {
  merchant?: string;
  amount?: number;
  currency?: string;
  transactionDate?: string;
}

/**
 * Resolve the on-disk uploads directory. Defaults to `backend/uploads/`
 * (relative to process.cwd) but can be overridden via env (`UPLOADS_DIR`) or
 * the per-call override (tests).
 */
export function uploadsDir(override?: string | null): string {
  if (override) return resolve(override);
  const envDir = process.env.UPLOADS_DIR;
  if (envDir) return resolve(envDir);
  return resolve(process.cwd(), "uploads");
}

/** Sanitise a client filename into a safe on-disk basename (no path traversal). */
function sanitiseFileName(original: string): string {
  const base = original.replace(/[\\/]/g, "_").replace(/[^.\w-]+/g, "_");
  const ext = extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length) || "receipt";
  // Append a short hash so repeated uploads of the same name never collide.
  const tag = createHash("sha1")
    .update(`${stem}:${Date.now()}`)
    .digest("hex")
    .slice(0, 8);
  return `${stem}-${tag}${ext}`;
}

/**
 * Resolve the storage driver to use for this call. The route passes an
 * explicit `storage` (built from env by the factory); direct callers fall back
 * to the historical local-disk behavior.
 */
function resolveStorage(opts: {
  uploadsDirOverride?: string | null;
  storage?: ReceiptStorage;
}): ReceiptStorage {
  return (
    opts.storage ?? new LocalReceiptStorage(uploadsDir(opts.uploadsDirOverride))
  );
}

/**
 * Store an uploaded receipt against a line item. The caller must have already
 * authenticated; this function re-checks ownership (the line item must belong
 * to a Draft/Action Required claim owned by `actorId`) before writing anything.
 *
 * `bytes` + `mimeType` come from the multipart parser in the route layer; the
 * manual `metadata` fields are user-entered (never auto-extracted). File bytes
 * are delegated to the active `ReceiptStorage` driver (#76).
 */
export async function storeAttachment(
  db: DB,
  args: {
    claimId: string;
    lineItemId: string;
    actorId: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    metadata: AttachmentMetadata;
  },
  opts: { uploadsDirOverride?: string | null; storage?: ReceiptStorage } = {}
): Promise<StoredAttachment> {
  const { claimId, lineItemId, actorId } = args;
  const storage = resolveStorage(opts);

  // Ownership + mutability check: claim must be owned by the caller and in a
  // status where line items can still be edited.
  const claim = getOwnedClaim(db, claimId, actorId);
  if (claim.status !== "draft" && claim.status !== "action_required") {
    throw new AttachmentError(
      409,
      "wrong_status",
      `Cannot attach to a ${claim.status} claim`
    );
  }
  const line = claim.lineItems.find((l) => l.id === lineItemId);
  if (!line) {
    throw new AttachmentError(
      404,
      "not_found",
      `Line item ${lineItemId} not found on claim ${claimId}`
    );
  }

  const mime = args.mimeType.toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw new AttachmentError(
      415,
      "invalid_file",
      `Unsupported file type ${args.mimeType}. Allowed: image/*, application/pdf.`
    );
  }
  if (args.bytes.byteLength > MAX_FILE_BYTES) {
    throw new AttachmentError(
      413,
      "file_too_large",
      `File is ${args.bytes.byteLength} bytes; max is ${MAX_FILE_BYTES}.`
    );
  }

  const baseName = sanitiseFileName(args.fileName);
  const relPath = `${lineItemId}/${baseName}`;

  let stored: StoredReceipt;
  try {
    stored = await storage.store(args.bytes, {
      filename: relPath,
      contentType: mime,
      sizeBytes: args.bytes.byteLength,
    });
  } catch (err) {
    throw new AttachmentError(
      500,
      "storage_failed",
      `Failed to store attachment: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const id = `att-${crypto.randomUUID()}`;
  const now = new Date();
  // Client-facing `fileUrl` is the storage driver's public URL; the DB row
  // persists the storage key (`stored.key`, still the relative path) so local
  // reads / S3 redirects / deletes can all recover the object.
  const row: StoredAttachment = {
    id,
    lineItemId,
    fileName: args.fileName,
    fileUrl: stored.publicUrl,
    mimeType: mime,
    sizeBytes: args.bytes.byteLength,
    merchant: args.metadata.merchant?.trim() || null,
    amount:
      args.metadata.amount != null && Number.isFinite(args.metadata.amount)
        ? Math.round(args.metadata.amount)
        : null,
    currency: args.metadata.currency?.trim() || null,
    transactionDate: args.metadata.transactionDate?.trim() || null,
    uploadedBy: actorId,
    uploadedAt: now,
  };

  db.transaction((tx) => {
    tx.insert(attachmentsTable)
      .values({
        id: row.id,
        lineItemId: row.lineItemId,
        fileName: row.fileName,
        fileUrl: relPath,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        merchant: row.merchant,
        amount: row.amount,
        currency: row.currency,
        transactionDate: row.transactionDate,
        uploadedBy: row.uploadedBy,
        uploadedAt: row.uploadedAt,
      })
      .run();
    // Flip the denormalised has_receipt flag so the policy engine sees the
    // receipt on the next (re)submit without an extra join.
    tx.update(claimLineItemsTable)
      .set({ hasReceipt: true, updatedAt: now })
      .where(eq(claimLineItemsTable.id, lineItemId))
      .run();
    writeAudit(tx, {
      actorId,
      action: "attachment.upload",
      entityType: "claim_line_item",
      entityId: lineItemId,
      after: {
        attachmentId: id,
        fileName: row.fileName,
        sizeBytes: row.sizeBytes,
      },
    });
  });

  return row;
}

/**
 * Resolve an attachment for download, verifying the caller has access to the
 * parent claim (owner, assigned approver, or finance). Returns the row + the
 * file bytes for the local driver, or a redirect URL for the S3 driver. The
 * route layer either streams the bytes or 302-redirects accordingly.
 */
export type AttachmentDownload =
  | { row: StoredAttachment; mode: "local"; absPath: string; bytes: Buffer }
  | { row: StoredAttachment; mode: "s3"; redirectUrl: string };

export async function resolveAttachmentForDownload(
  db: DB,
  attachmentId: string,
  viewer: { id: string; roles: Role[] },
  opts: {
    uploadsDirOverride?: string | null;
    storage?: ReceiptStorage;
    driver?: "local" | "s3";
  } = {}
): Promise<AttachmentDownload> {
  const row = db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.id, attachmentId))
    .get();
  if (!row) {
    throw new AttachmentError(
      404,
      "not_found",
      `Attachment ${attachmentId} not found`
    );
  }
  const lineItem = db
    .select()
    .from(claimLineItemsTable)
    .where(eq(claimLineItemsTable.id, row.lineItemId))
    .get();
  if (!lineItem) {
    throw new AttachmentError(404, "not_found", "Parent line item not found");
  }
  const claim = db
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.id, lineItem.claimId))
    .get();
  if (!claim) {
    throw new AttachmentError(404, "not_found", "Parent claim not found");
  }

  const allowed =
    claim.employeeId === viewer.id ||
    viewer.roles.includes("finance") ||
    isCurrentApprover(db, claim, viewer.id);
  if (!allowed) {
    throw new AttachmentError(
      403,
      "forbidden",
      "You do not have access to this attachment"
    );
  }

  const rowOut: StoredAttachment = {
    id: row.id,
    lineItemId: row.lineItemId,
    fileName: row.fileName,
    fileUrl: row.fileUrl,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    merchant: row.merchant,
    amount: row.amount,
    currency: row.currency,
    transactionDate: row.transactionDate,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
  };

  if (opts.driver === "s3") {
    const storage = resolveStorage(opts);
    return { row: rowOut, mode: "s3", redirectUrl: await storage.getPublicUrl(row.fileUrl) };
  }

  const absPath = join(uploadsDir(opts.uploadsDirOverride), row.fileUrl);
  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch {
    throw new AttachmentError(
      404,
      "not_found",
      "Attachment file is missing from storage"
    );
  }

  return { row: rowOut, mode: "local", absPath, bytes };
}

/**
 * True when `userId` is the approver at the claim's current step. Used to gate
 * attachment downloads for approvers reviewing a claim in their inbox.
 */
function isCurrentApprover(
  db: DB,
  claim: typeof claimsTable.$inferSelect,
  userId: string
): boolean {
  if (claim.status !== "pending" || !claim.approvalRouteId) return false;
  const steps = db
    .select()
    .from(approvalStepsTable)
    .where(eq(approvalStepsTable.routeId, claim.approvalRouteId))
    .all()
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const step = steps[claim.currentStepIndex];
  if (!step) return false;
  if (step.approverType === "specific_user") return step.approverId === userId;
  if (step.approverType === "finance") return true;
  if (step.approverType === "submitter_manager") {
    const emp = db
      .select({ managerId: usersTable.managerId })
      .from(usersTable)
      .where(eq(usersTable.id, claim.employeeId))
      .get();
    return emp?.managerId === userId;
  }
  return false;
}

/** Remove an attachment (Draft/Action Required, owner only). */
export async function deleteAttachment(
  db: DB,
  attachmentId: string,
  actorId: string,
  opts: {
    uploadsDirOverride?: string | null;
    storage?: ReceiptStorage;
  } = {}
): Promise<void> {
  const row = db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.id, attachmentId))
    .get();
  if (!row) {
    throw new AttachmentError(
      404,
      "not_found",
      `Attachment ${attachmentId} not found`
    );
  }
  const lineItem = db
    .select()
    .from(claimLineItemsTable)
    .where(eq(claimLineItemsTable.id, row.lineItemId))
    .get();
  if (!lineItem) return;
  const claim = db
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.id, lineItem.claimId))
    .get();
  if (!claim) return;
  if (claim.employeeId !== actorId) {
    throw new AttachmentError(
      403,
      "forbidden",
      "You do not own this attachment"
    );
  }
  if (claim.status !== "draft" && claim.status !== "action_required") {
    throw new AttachmentError(
      409,
      "wrong_status",
      `Cannot delete an attachment on a ${claim.status} claim`
    );
  }

  const storage = resolveStorage(opts);
  try {
    await storage.delete(row.fileUrl);
  } catch {
    // best-effort; metadata row is the source of truth
  }

  db.transaction((tx) => {
    tx.delete(attachmentsTable)
      .where(eq(attachmentsTable.id, attachmentId))
      .run();
    // Recompute has_receipt: flip back to false if no attachments remain.
    const remaining = tx
      .select({ id: attachmentsTable.id })
      .from(attachmentsTable)
      .where(eq(attachmentsTable.lineItemId, row.lineItemId))
      .all();
    if (remaining.length === 0) {
      tx.update(claimLineItemsTable)
        .set({ hasReceipt: false, updatedAt: new Date() })
        .where(eq(claimLineItemsTable.id, row.lineItemId))
        .run();
    }
    writeAudit(tx, {
      actorId,
      action: "attachment.delete",
      entityType: "claim_line_item",
      entityId: row.lineItemId,
      before: { attachmentId, fileName: row.fileName },
    });
  });
}

// Surface the typed errors at module scope for route-layer import. `ClaimError`
// is re-exported so the route layer only needs one import path.
export { ClaimError };

/* ============================================================================
 * SpendFlow — Finance exception resolution + payment lifecycle service
 * (ticket #13).
 *
 * Two independent concerns living in one domain because they share the same
 * caller (Finance Admin, i.e. `role === "finance"`) and the same upstream
 * state (fully approved claims):
 *
 *  - Exception queue: fully approved claims with at least one line item
 *    carrying an open `policy_flag`. Finance overrides (clears the flag,
 *    claim stays Approved) or rejects (claim returns to the employee as
 *    Action Required, to be fixed and resubmitted through the approval chain
 *    again). This is deliberately NOT the approvals #12 `request_changes`/
 *    `reject` flow — those act on a claim mid-route against a specific step;
 *    this acts on an already-fully-approved claim with no current step, so it
 *    only ever touches `claims`/`claim_line_items` + audit/notification, never
 *    `approval_actions`.
 *  - Payment lifecycle: Approved → Processing (method + reference captured)
 *    → Paid (processed-by + processed-at captured). One `payments` row per
 *    claim, created at Processing and updated in place at Paid.
 * ========================================================================== */

import { eq } from "drizzle-orm";
import {
  claimLineItemsTable,
  claimsTable,
  paymentsTable,
  usersTable,
  type ClaimStatus,
  type PaymentMethod,
} from "../db/schema.js";
import type { DB } from "../db/index.js";
import { writeAudit } from "./audit.js";
import { writeNotification } from "./notifications.js";
import { toClaimRow, type ClaimRow } from "./claims.js";

export class FinanceError extends Error {
  constructor(
    public status: number,
    public code:
      | "not_found"
      | "forbidden"
      | "wrong_status"
      | "comment_required"
      | "validation_required"
      | "stale_decision",
    message: string
  ) {
    super(message);
    this.name = "FinanceError";
  }
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function claimTotal(claim: ClaimRow): number {
  return claim.lineItems.reduce((s, l) => s + l.amount, 0);
}

function flaggedLineItems(claim: ClaimRow) {
  return claim.lineItems.filter((l) => l.policyFlag && l.policyFlag.length > 0);
}

/* --------------------------------------------------------- exception queue -- */

export interface ExceptionQueueItem extends ClaimRow {
  employeeName: string;
  openFlagCount: number;
}

/**
 * Fully approved claims that still carry at least one open line-item policy
 * flag. A claim drops out automatically once every flag on it is resolved
 * (cleared), since the filter is evaluated live against current line-item
 * state rather than a persisted "has exception" bit.
 */
export function getFinanceExceptions(db: DB): ExceptionQueueItem[] {
  const approved = db
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.status, "approved"))
    .all();

  const out: ExceptionQueueItem[] = [];
  for (const row of approved) {
    const claim = toClaimRow(db, row);
    const flagged = flaggedLineItems(claim);
    if (flagged.length === 0) continue;
    const employee = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, claim.employeeId))
      .get();
    out.push({
      ...claim,
      employeeName: employee?.name ?? "",
      openFlagCount: flagged.length,
    });
  }
  return out;
}

/* ------------------------------------------------------ override / reject -- */

export type ExceptionAction = "override" | "reject";

export interface ExceptionResolveInput {
  action: ExceptionAction;
  lineItemId?: string;
  comment: string;
}

function loadClaimRowTx(db: DB, id: string) {
  const row = db.select().from(claimsTable).where(eq(claimsTable.id, id)).get();
  if (!row) throw new FinanceError(404, "not_found", `Claim ${id} not found`);
  return row;
}

/**
 * Resolve a flagged claim: override clears the target line item(s)' policy
 * flag and leaves the claim Approved (ready for payment); reject returns the
 * whole claim to the employee as Action Required for resubmission. Both
 * require a non-empty justification/comment and both write audit + notify the
 * employee. A stale claim (already moved past Approved — processing, paid,
 * returned again, etc.) is rejected as a typed conflict so the caller can
 * surface a stale-decision panel.
 */
export function resolveException(
  db: DB,
  actorId: string,
  claimId: string,
  input: ExceptionResolveInput
): { claim: ClaimRow; action: ExceptionAction } {
  const comment = input.comment?.trim();
  if (!comment) {
    throw new FinanceError(
      400,
      "comment_required",
      `A justification comment is required for ${input.action}`
    );
  }

  return db.transaction((tx) => {
    const row = loadClaimRowTx(tx, claimId);
    if (row.status !== "approved") {
      throw new FinanceError(
        409,
        "stale_decision",
        `Claim is ${row.status}; expected approved`
      );
    }

    const claim = toClaimRow(tx, row);
    const targets = input.lineItemId
      ? claim.lineItems.filter((l) => l.id === input.lineItemId)
      : flaggedLineItems(claim);

    if (input.lineItemId && targets.length === 0) {
      throw new FinanceError(
        404,
        "not_found",
        `Line item ${input.lineItemId} not found on claim ${claimId}`
      );
    }
    const flaggedTargets = targets.filter((l) => l.policyFlag && l.policyFlag.length > 0);
    if (flaggedTargets.length === 0) {
      throw new FinanceError(
        400,
        "validation_required",
        "No open policy exception to resolve on this claim"
      );
    }

    const now = new Date();

    if (input.action === "override") {
      for (const line of flaggedTargets) {
        tx.update(claimLineItemsTable)
          .set({ policyFlag: null, updatedAt: now })
          .where(eq(claimLineItemsTable.id, line.id))
          .run();
      }
      tx.update(claimsTable).set({ updatedAt: now }).where(eq(claimsTable.id, claimId)).run();

      writeAudit(tx, {
        actorId,
        action: "claim.exception_override",
        entityType: "claim",
        entityId: claimId,
        before: {
          lineItemIds: flaggedTargets.map((l) => l.id),
          flags: flaggedTargets.map((l) => l.policyFlag),
        },
        after: { lineItemIds: flaggedTargets.map((l) => l.id), flags: null, comment },
      });
      writeNotification(tx, {
        recipientId: claim.employeeId,
        category: "action",
        title: `Claim ${claim.reference} policy exception overridden`,
        body: comment,
        claimId,
      });

      return { claim: toClaimRow(tx, loadClaimRowTx(tx, claimId)), action: "override" };
    }

    // reject: return the whole claim to the employee as Action Required.
    tx.update(claimsTable)
      .set({ status: "action_required", decidedAt: now, updatedAt: now })
      .where(eq(claimsTable.id, claimId))
      .run();

    writeAudit(tx, {
      actorId,
      action: "claim.exception_rejected",
      entityType: "claim",
      entityId: claimId,
      before: {
        status: "approved",
        lineItemIds: flaggedTargets.map((l) => l.id),
        flags: flaggedTargets.map((l) => l.policyFlag),
      },
      after: { status: "action_required", comment },
    });
    writeNotification(tx, {
      recipientId: claim.employeeId,
      category: "action",
      title: `Claim ${claim.reference} returned by Finance`,
      body: comment,
      claimId,
    });

    return { claim: toClaimRow(tx, loadClaimRowTx(tx, claimId)), action: "reject" };
  });
}

/* --------------------------------------------------------- payment lifecycle -- */

export interface PaymentRow {
  id: string;
  claimId: string;
  method: PaymentMethod;
  referenceNumber: string;
  amount: number;
  currency: string;
  status: "processing" | "paid";
  processedBy: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentQueueItem {
  id: string;
  reference: string;
  title: string;
  employeeId: string;
  employeeName: string;
  currency: string;
  totalAmount: number;
  status: ClaimStatus;
  payment: PaymentRow | null;
}

function loadPaymentForClaim(db: DB, claimId: string): PaymentRow | null {
  return (
    db.select().from(paymentsTable).where(eq(paymentsTable.claimId, claimId)).get() ?? null
  );
}

function toQueueItem(db: DB, row: typeof claimsTable.$inferSelect): PaymentQueueItem {
  const claim = toClaimRow(db, row);
  const employee = db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, claim.employeeId))
    .get();
  return {
    id: claim.id,
    reference: claim.reference,
    title: claim.title,
    employeeId: claim.employeeId,
    employeeName: employee?.name ?? "",
    currency: claim.currency,
    totalAmount: claimTotal(claim),
    status: claim.status,
    payment: loadPaymentForClaim(db, claim.id),
  };
}

/**
 * Claims grouped by reimbursement stage: Approved (ready for payment — flagged
 * claims are excluded here since they still need exception resolution first),
 * Processing, and Paid.
 */
export function getFinancePayments(db: DB): {
  approved: PaymentQueueItem[];
  processing: PaymentQueueItem[];
  paid: PaymentQueueItem[];
} {
  const approvedRows = db
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.status, "approved"))
    .all();
  const approved = approvedRows
    .filter((row) => flaggedLineItems(toClaimRow(db, row)).length === 0)
    .map((row) => toQueueItem(db, row));

  const processing = db
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.status, "processing"))
    .all()
    .map((row) => toQueueItem(db, row));

  const paid = db
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.status, "paid"))
    .all()
    .map((row) => toQueueItem(db, row));

  return { approved, processing, paid };
}

export interface MarkProcessingInput {
  method: PaymentMethod;
  reference: string;
}

/**
 * Transition an Approved claim to Processing, capturing the payment method +
 * reference number. Creates the claim's (single) payments row. Rejected as a
 * stale-decision conflict if the claim isn't currently Approved.
 */
export function markClaimProcessing(
  db: DB,
  actorId: string,
  claimId: string,
  input: MarkProcessingInput
): { claim: ClaimRow; payment: PaymentRow } {
  const method = input.method;
  const reference = input.reference?.trim();
  if (!method || !reference) {
    throw new FinanceError(
      400,
      "validation_required",
      "Payment method and reference number are required"
    );
  }

  return db.transaction((tx) => {
    const row = loadClaimRowTx(tx, claimId);
    if (row.status !== "approved") {
      throw new FinanceError(
        409,
        "stale_decision",
        `Claim is ${row.status}; expected approved`
      );
    }
    const claim = toClaimRow(tx, row);
    const now = new Date();
    const paymentId = newId("pay");

    tx.insert(paymentsTable)
      .values({
        id: paymentId,
        claimId,
        method,
        referenceNumber: reference,
        amount: claimTotal(claim),
        currency: claim.currency,
        status: "processing",
        processedBy: null,
        processedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    tx.update(claimsTable)
      .set({ status: "processing", updatedAt: now })
      .where(eq(claimsTable.id, claimId))
      .run();

    writeAudit(tx, {
      actorId,
      action: "claim.payment_processing",
      entityType: "claim",
      entityId: claimId,
      before: { status: "approved" },
      after: { status: "processing", method, referenceNumber: reference },
    });
    writeNotification(tx, {
      recipientId: claim.employeeId,
      category: "payment",
      title: `Claim ${claim.reference} is being processed`,
      body: `Payment method: ${method}, reference: ${reference}.`,
      claimId,
    });

    const payment = loadPaymentForClaim(tx, claimId)!;
    return { claim: toClaimRow(tx, loadClaimRowTx(tx, claimId)), payment };
  });
}

/**
 * Transition a Processing claim to Paid, stamping processed-by/processed-at
 * on its payments row. Rejected as a stale-decision conflict if the claim
 * isn't currently Processing (including the case where it was never put into
 * Processing, i.e. no payments row exists).
 */
export function markClaimPaid(
  db: DB,
  actorId: string,
  claimId: string
): { claim: ClaimRow; payment: PaymentRow } {
  return db.transaction((tx) => {
    const row = loadClaimRowTx(tx, claimId);
    const payment = loadPaymentForClaim(tx, claimId);
    if (row.status !== "processing" || !payment || payment.status !== "processing") {
      throw new FinanceError(
        409,
        "stale_decision",
        `Claim is ${row.status}; expected processing`
      );
    }
    const claim = toClaimRow(tx, row);
    const now = new Date();

    tx.update(paymentsTable)
      .set({ status: "paid", processedBy: actorId, processedAt: now, updatedAt: now })
      .where(eq(paymentsTable.id, payment.id))
      .run();

    tx.update(claimsTable)
      .set({ status: "paid", updatedAt: now })
      .where(eq(claimsTable.id, claimId))
      .run();

    writeAudit(tx, {
      actorId,
      action: "claim.paid",
      entityType: "claim",
      entityId: claimId,
      before: { status: "processing" },
      after: { status: "paid" },
    });
    writeNotification(tx, {
      recipientId: claim.employeeId,
      category: "payment",
      title: `Claim ${claim.reference} has been paid`,
      body: `Your reimbursement for "${claim.title}" has been paid.`,
      claimId,
    });

    const updatedPayment = loadPaymentForClaim(tx, claimId)!;
    return { claim: toClaimRow(tx, loadClaimRowTx(tx, claimId)), payment: updatedPayment };
  });
}

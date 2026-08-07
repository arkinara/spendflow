/* ============================================================================
 * SpendFlow — Approval decisioning service (ticket #12).
 *
 * Inbox query (claims currently at the authenticated approver's step) and the
 * approve/reject/request_changes decision endpoint. Decisions are validated
 * against the resolved route + step, run inside a transaction with a stale-
 * step guard (so two concurrent decisions on the same claim/step cannot both
 * succeed), and always write audit_log + notification + approval_actions rows.
 * ========================================================================== */

import { asc, eq } from "drizzle-orm";
import {
  approvalActionsTable,
  approvalRoutesTable,
  approvalStepsTable,
  claimsTable,
  claimLineItemsTable,
  usersTable,
} from "../db/schema.js";
import type { DB } from "../db/index.js";
import { writeAudit } from "./audit.js";
import { writeNotification } from "./notifications.js";
import {
  approverUserIdsForStep,
  type RoutingStep,
} from "./approval-engine.js";
import { loadApprovalRoutes } from "./config.js";
import { parseRoles } from "./roles.js";
import type { Role } from "../types.js";
import {
  loadClaimOrThrow,
  toClaimRow,
  type ClaimRow,
} from "./claims.js";

export class ApprovalError extends Error {
  constructor(
    public status: number,
    public code:
      | "not_found"
      | "forbidden"
      | "wrong_status"
      | "comment_required"
      | "stale_decision"
      | "no_route",
    message: string
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

export type DecisionAction = "approve" | "reject" | "request_changes";

export interface DecisionInput {
  action: DecisionAction;
  comment?: string;
}

export interface InboxItem {
  id: string;
  reference: string;
  title: string;
  employeeId: string;
  employeeName: string;
  status: string;
  currency: string;
  totalAmount: number;
  submittedAt: Date | null;
  currentStepIndex: number;
  stepLabel: string;
}

export interface ApproverClaimDetail extends ClaimRow {
  employeeName: string;
  steps: RoutingStep[];
  currentStep: RoutingStep | null;
}

/* ----------------------------------------------------------- inbox query -- */

/**
 * Resolve the set of step ids the authenticated approver can decide on:
 *  - any step of type `specific_user` whose approverId === userId
 *  - any step of type `finance` (when the caller's role is finance)
 *  - any step of type `submitter_manager` is matched dynamically per-claim
 *    against the claim employee's manager, so it cannot be pre-resolved by
 *    step id alone; handled in the inbox join below.
 */
function inboxStepCandidates(
  db: DB,
  userId: string,
  roles: Role[]
): { specificStepIds: string[]; asFinance: boolean } {
  const specific = db
    .select({ id: approvalStepsTable.id })
    .from(approvalStepsTable)
    .where(eq(approvalStepsTable.approverId, userId))
    .all()
    .map((r) => r.id);
  return { specificStepIds: specific, asFinance: roles.includes("finance") };
}

/**
 * Approver inbox: every Pending claim currently sitting at this approver's
 * step, filtered server-side by the caller's identity. A decided claim is no
 * longer Pending at this step, so it naturally drops out of the inbox.
 */
export function approverInbox(
  db: DB,
  approverId: string,
  approverRoles: Role[],
  opts: { sortBy?: "submitted_at" | "amount"; sortDir?: "asc" | "desc" } = {}
): InboxItem[] {
  const { sortBy = "submitted_at", sortDir = "desc" } = opts;
  const pending = db
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.status, "pending"))
    .all();

  const { specificStepIds, asFinance } = inboxStepCandidates(
    db,
    approverId,
    approverRoles
  );

  const out: InboxItem[] = [];
  for (const claim of pending) {
    // Manager-match: the claim's employee must report to this approver.
    const employee = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, claim.employeeId))
      .get();
    if (!employee) continue;

    const route = claim.approvalRouteId
      ? db
          .select()
          .from(approvalRoutesTable)
          .where(eq(approvalRoutesTable.id, claim.approvalRouteId))
          .get()
      : null;
    if (!route) continue;

    const steps = db
      .select()
      .from(approvalStepsTable)
      .where(eq(approvalStepsTable.routeId, route.id))
      .orderBy(asc(approvalStepsTable.orderIndex))
      .all();
    const step = steps[claim.currentStepIndex];
    if (!step) continue;

    const isManagerStep =
      step.approverType === "submitter_manager" &&
      employee.managerId === approverId;
    const isSpecificStep =
      step.approverType === "specific_user" && specificStepIds.includes(step.id);
    const isFinanceStep = step.approverType === "finance" && asFinance;
    if (!isManagerStep && !isSpecificStep && !isFinanceStep) continue;

    const lineTotals = db
      .select({ amount: claimLineItemsTable.amount })
      .from(claimLineItemsTable)
      .where(eq(claimLineItemsTable.claimId, claim.id))
      .all();
    const totalAmount = lineTotals.reduce((s, l) => s + l.amount, 0);

    out.push({
      id: claim.id,
      reference: claim.reference,
      title: claim.title,
      employeeId: claim.employeeId,
      employeeName: employee.name,
      status: claim.status,
      currency: claim.currency,
      totalAmount,
      submittedAt: claim.submittedAt,
      currentStepIndex: claim.currentStepIndex,
      stepLabel: step.label,
    });
  }

  out.sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "amount") return (a.totalAmount - b.totalAmount) * dir;
    const ta = a.submittedAt?.getTime() ?? 0;
    const tb = b.submittedAt?.getTime() ?? 0;
    return (ta - tb) * dir;
  });
  return out;
}

/* ----------------------------------------------------- claim detail view -- */

/** Claim detail enriched for an approver: line items + resolved steps. */
export function getApproverClaimDetail(
  db: DB,
  approverId: string,
  approverRoles: Role[],
  claimId: string
): ApproverClaimDetail {
  const claim = loadClaimOrThrow(db, claimId);
  const employee = db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, claim.employeeId))
    .get();
  const routes = loadApprovalRoutes(db);
  // For display, surface every step of the claim's resolved route.
  const routeConfig = claim.approvalRouteId
    ? routes.find((r) => r.id === claim.approvalRouteId)
    : undefined;
  const steps = routeConfig?.steps ?? [];
  const currentStep = steps[claim.currentStepIndex] ?? null;

  // Approver must be permitted to view a claim at their step (or be finance).
  const permitted = canDecideStep(db, approverId, approverRoles, claim.employeeId, currentStep) ||
    approverRoles.includes("finance");
  if (!permitted) {
    throw new ApprovalError(403, "forbidden", "This claim is not at your step");
  }

  return {
    ...toClaimRow(db, claim),
    employeeName: employee?.name ?? "",
    steps,
    currentStep,
  };
}

function canDecideStep(
  db: DB,
  approverId: string,
  approverRoles: Role[],
  employeeId: string,
  step: RoutingStep | null
): boolean {
  if (!step) return false;
  const { userIds, requiresFinanceRole } = approverUserIdsForStep(
    step,
    managerOf(db, employeeId)
  );
  if (requiresFinanceRole) return approverRoles.includes("finance");
  return userIds.includes(approverId);
}

function managerOf(db: DB, employeeId: string): string | null {
  const row = db
    .select({ managerId: usersTable.managerId })
    .from(usersTable)
    .where(eq(usersTable.id, employeeId))
    .get();
  return row?.managerId ?? null;
}

/* ------------------------------------------------------------- decisions -- */

/**
 * Record an approve/reject/request_changes decision and advance or return the
 * claim. Runs inside a transaction with a stale-step re-check so two
 * concurrent decisions on the same claim/step cannot both succeed.
 */
export function recordDecision(
  db: DB,
  approverId: string,
  approverRoles: Role[],
  claimId: string,
  input: DecisionInput
): {
  claim: ClaimRow;
  action: DecisionAction;
  advanced: boolean;
  finalised: boolean;
} {
  if (input.action !== "approve" && !input.comment?.trim()) {
    throw new ApprovalError(
      400,
      "comment_required",
      `A comment is required for ${input.action}`
    );
  }

  // Re-resolve the route inside the transaction so the stale-step guard holds
  // against any concurrent decision on the same claim.
  return db.transaction((tx) => {
    const claim = loadClaimOrThrowTx(tx, claimId);
    if (claim.status !== "pending") {
      throw new ApprovalError(
        409,
        "stale_decision",
        `Claim is no longer pending (status: ${claim.status})`
      );
    }
    const routes = loadApprovalRoutes(tx);
    const routeConfig = claim.approvalRouteId
      ? routes.find((r) => r.id === claim.approvalRouteId)
      : undefined;
    if (!routeConfig) {
      throw new ApprovalError(
        503,
        "no_route",
        "The claim's approval route is no longer configured"
      );
    }
    const steps = routeConfig.steps;
    const currentStep = steps[claim.currentStepIndex];
    if (!currentStep) {
      throw new ApprovalError(
        503,
        "no_route",
        `Step index ${claim.currentStepIndex} has no matching step on route ${routeConfig.id}`
      );
    }

    if (!canDecideStepTx(tx, approverId, approverRoles, claim.employeeId, currentStep)) {
      throw new ApprovalError(
        409,
        "stale_decision",
        "This claim is no longer at your step"
      );
    }

    const now = new Date();
    const comment = input.comment?.trim() || null;
    const isFinal = claim.currentStepIndex >= steps.length - 1;

    if (input.action === "approve") {
      if (isFinal) {
        tx.update(claimsTable)
          .set({
            status: "approved",
            decidedAt: now,
            updatedAt: now,
          })
          .where(eq(claimsTable.id, claimId))
          .run();
        tx.insert(approvalActionsTable)
          .values({
            id: `act-${crypto.randomUUID()}`,
            claimId,
            stepId: currentStep.id,
            actorId: approverId,
            action: "approved",
            comment,
            createdAt: now,
          })
          .run();
        writeAudit(tx, {
          actorId: approverId,
          action: "claim.approved.final",
          entityType: "claim",
          entityId: claimId,
          before: { status: "pending", step: claim.currentStepIndex },
          after: { status: "approved" },
        });
        // Notify finance that a claim was fully approved.
        notifyFinance(tx, claimId, claim, "approved");
        return {
          claim: toClaimRowTx(tx, claimId),
          action: "approve",
          advanced: false,
          finalised: true,
        };
      }
      const nextIndex = claim.currentStepIndex + 1;
      tx.update(claimsTable)
        .set({
          currentStepIndex: nextIndex,
          updatedAt: now,
        })
        .where(eq(claimsTable.id, claimId))
        .run();
      tx.insert(approvalActionsTable)
        .values({
          id: `act-${crypto.randomUUID()}`,
          claimId,
          stepId: currentStep.id,
          actorId: approverId,
          action: "approved",
          comment,
          createdAt: now,
        })
        .run();
      writeAudit(tx, {
        actorId: approverId,
        action: "claim.approved.advance",
        entityType: "claim",
        entityId: claimId,
        before: { step: claim.currentStepIndex },
        after: { step: nextIndex },
      });
      notifyNextApprover(tx, claimId, claim, steps[nextIndex]);
      return {
        claim: toClaimRowTx(tx, claimId),
        action: "approve",
        advanced: true,
        finalised: false,
      };
    }

    // reject or request_changes: returns the claim to the employee.
    const newStatus = input.action === "reject" ? "rejected" : "action_required";
    const actionLabel = input.action === "reject" ? "rejected" : "returned";
    tx.update(claimsTable)
      .set({
        status: newStatus,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(claimsTable.id, claimId))
      .run();
    tx.insert(approvalActionsTable)
      .values({
        id: `act-${crypto.randomUUID()}`,
        claimId,
        stepId: currentStep.id,
        actorId: approverId,
        action: actionLabel,
        comment,
        createdAt: now,
      })
      .run();
    writeAudit(tx, {
      actorId: approverId,
      action: `claim.${actionLabel}`,
      entityType: "claim",
      entityId: claimId,
      before: { status: "pending", step: claim.currentStepIndex },
      after: { status: newStatus },
    });
    writeNotification(tx, {
      recipientId: claim.employeeId,
      category: "action",
      title: `Claim ${claim.reference} ${input.action === "reject" ? "rejected" : "returned"}`,
      body: comment
        ? comment
        : `Your claim "${claim.title}" was ${input.action === "reject" ? "rejected" : "returned for changes"}.`,
      claimId,
    });
    return {
      claim: toClaimRowTx(tx, claimId),
      action: input.action,
      advanced: false,
      finalised: input.action === "reject",
    };
  });
}

/* ----------------------------------------------------- tx-scoped helpers -- */
// drizzle's better-sqlite3 transaction callback receives the same DB shape, so
// these mirror the claims.ts loaders but operate inside the open transaction.

function loadClaimOrThrowTx(db: DB, id: string) {
  const row = db.select().from(claimsTable).where(eq(claimsTable.id, id)).get();
  if (!row) throw new ApprovalError(404, "not_found", `Claim ${id} not found`);
  return row;
}

function toClaimRowTx(db: DB, id: string): ClaimRow {
  return toClaimRow(db, loadClaimOrThrowTx(db, id));
}

function canDecideStepTx(
  db: DB,
  approverId: string,
  approverRoles: Role[],
  employeeId: string,
  step: RoutingStep
): boolean {
  const { userIds, requiresFinanceRole } = approverUserIdsForStep(
    step,
    managerOfTx(db, employeeId)
  );
  if (requiresFinanceRole) return approverRoles.includes("finance");
  return userIds.includes(approverId);
}

function managerOfTx(db: DB, employeeId: string): string | null {
  const row = db
    .select({ managerId: usersTable.managerId })
    .from(usersTable)
    .where(eq(usersTable.id, employeeId))
    .get();
  return row?.managerId ?? null;
}

function notifyFinance(
  db: DB,
  claimId: string,
  claim: { reference: string; title: string },
  verb: string
) {
  const financeUsers = db
    .select()
    .from(usersTable)
    .all()
    .filter((u) => parseRoles(u.roles).includes("finance"));
  for (const fu of financeUsers) {
    writeNotification(db, {
      recipientId: fu.id,
      category: "approval",
      title: `Claim ${claim.reference} ${verb}`,
      body: `"${claim.title}" was fully approved and is ready for processing.`,
      claimId,
    });
  }
}

function notifyNextApprover(
  db: DB,
  claimId: string,
  claim: { reference: string; title: string; employeeId: string },
  step: RoutingStep
) {
  const managerId = managerOfTx(db, claim.employeeId);
  const { userIds, requiresFinanceRole } = approverUserIdsForStep(step, managerId);
  const title = `Claim ${claim.reference} ready for your review`;
  const body = `"${claim.title}" advanced to: ${step.label}.`;
  const recipients = requiresFinanceRole
    ? db
        .select()
        .from(usersTable)
        .all()
        .filter((u) => parseRoles(u.roles).includes("finance"))
        .map((u) => u.id)
    : userIds;
  for (const rid of recipients) {
    writeNotification(db, {
      recipientId: rid,
      category: "approval",
      title,
      body,
      claimId,
    });
  }
}

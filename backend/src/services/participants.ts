/* ============================================================================
 * SpendFlow — claim participant resolution (ticket #15).
 *
 * Shared gate for comments + audit history: submitter, current/former
 * approver, or finance admin. Mirrors the FE comment-composer role gate (#8)
 * so both surfaces agree on who counts as a participant.
 * ========================================================================== */

import { eq } from "drizzle-orm";
import { approvalActionsTable, usersTable } from "../db/schema.js";
import type { DB } from "../db/index.js";
import { approverUserIdsForStep } from "./approval-engine.js";
import { loadApprovalRoutes } from "./config.js";

export interface ParticipantClaimShape {
  id: string;
  employeeId: string;
  status: string;
  approvalRouteId: string | null;
  currentStepIndex: number;
}

/**
 * Every user id with legitimate access to a claim: the submitter, every
 * finance user (finance admins see all claims), every actor who has taken a
 * step-level decision on the claim (former approvers — decision actions
 * always carry a `stepId`; lifecycle actions like created/submitted/withdrawn
 * do not), and the approver(s) currently resolved for the claim's active step
 * while it is Pending.
 */
export function claimParticipantIds(db: DB, claim: ParticipantClaimShape): string[] {
  const ids = new Set<string>();
  ids.add(claim.employeeId);

  for (const fu of db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "finance"))
    .all()) {
    ids.add(fu.id);
  }

  for (const action of db
    .select({ actorId: approvalActionsTable.actorId, stepId: approvalActionsTable.stepId })
    .from(approvalActionsTable)
    .where(eq(approvalActionsTable.claimId, claim.id))
    .all()) {
    if (action.stepId != null) ids.add(action.actorId);
  }

  if (claim.status === "pending" && claim.approvalRouteId) {
    const route = loadApprovalRoutes(db).find((r) => r.id === claim.approvalRouteId);
    const step = route?.steps[claim.currentStepIndex];
    if (step) {
      const employee = db
        .select({ managerId: usersTable.managerId })
        .from(usersTable)
        .where(eq(usersTable.id, claim.employeeId))
        .get();
      const { userIds } = approverUserIdsForStep(step, employee?.managerId ?? null);
      userIds.forEach((id) => ids.add(id));
    }
  }

  return Array.from(ids);
}

export function isClaimParticipant(
  db: DB,
  claim: ParticipantClaimShape,
  userId: string
): boolean {
  return claimParticipantIds(db, claim).includes(userId);
}

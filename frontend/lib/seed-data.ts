/* ============================================================================
   SpendFlow — seeded query functions (Phase 1, web).
   Query functions moved out of the legacy lib/mock mock module in cleanup-2 (split from
   #24). They operate on the static fixtures in lib/fixtures.ts and are used by
   the Phase 1 dev environment for predictable seed data.
   ========================================================================== */

import type {
  AuditEntry,
  Claim,
  Comment,
  ExpenseCategory,
  Notification,
  Role,
  User,
} from "@/lib/types";
import {
  auditLog,
  categories,
  claims,
  comments,
  FINANCE_PAYMENT_STATUSES,
  HIGH_VALUE_THRESHOLD,
  notifications,
  users,
} from "@/lib/fixtures";

/* ------------------------------------------------------------- selectors -- */

export function computeClaimTotal(claim: Claim): number {
  return claim.lineItems.reduce((sum, item) => sum + item.amount, 0);
}

/**
 * Resolve the ordered approval steps a claim must clear, mirroring the routing
 * rules fixture: standard claims stop at the line manager; high-value or
 * exception-flagged claims also pass through a finance review step. Used by the
 * approver decision flow to decide whether "Approve" advances the claim to the
 * next step or finalises it.
 */
export function routingStepsForClaim(claim: Claim): string[] {
  if (claim.exception || computeClaimTotal(claim) > HIGH_VALUE_THRESHOLD) {
    return ["Line manager", "Finance review"];
  }
  return ["Line manager"];
}

/**
 * Claims currently awaiting the line-manager approver (step 0). Pending claims
 * that have already been approved past step 0 (advanced to Finance review) are
 * intentionally excluded — they have left the approver's inbox. Phase 1 has a
 * single approver, so the optional id is accepted for forward-compatibility but
 * not yet used to filter.
 */
export function claimsForApprover(_approverId?: string): Claim[] {
  return claims.filter(
    (c) => c.status === "pending" && (c.currentStepIndex ?? 0) === 0
  );
}

/**
 * Push a notification into the live store. Used by the mock decision flow so the
 * employee/finance audience sees a fresh row after an approval, rejection, or
 * return — mirroring how the real backend would emit domain events.
 */
let notificationSeq = 9000;
export function pushNotification(n: Omit<Notification, "id">): Notification {
  const entry: Notification = { id: `nt-${++notificationSeq}`, ...n };
  notifications.unshift(entry);
  return entry;
}

/**
 * Append an immutable audit row to the live audit log. Used by the mock
 * Finance decision flow so the claim's audit trail re-renders immediately
 * after an exception resolution or payment transition.
 */
let auditSeq = 8000;
export function pushAudit(a: Omit<AuditEntry, "id">): AuditEntry {
  const entry: AuditEntry = { id: `au-${++auditSeq}`, ...a };
  auditLog.unshift(entry);
  return entry;
}

export function getUser(id: string): User | undefined {
  return users.find((u) => u.id === id);
}

export function getUserName(id: string): string {
  return getUser(id)?.name ?? "Unknown";
}

export function getClaim(id: string): Claim | undefined {
  return claims.find((c) => c.id === id);
}

export function getCategory(id: string): ExpenseCategory | undefined {
  return categories.find((c) => c.id === id);
}

export function claimsForEmployee(employeeId: string): Claim[] {
  return claims.filter((c) => c.employeeId === employeeId);
}

export function openExceptions(): Claim[] {
  return claims.filter((c) => c.exception && c.exception.status === "open");
}

/**
 * Finance-scoped exception queue: claims that are in the payment lifecycle
 * (approved / processing) AND still carry an open policy flag. These are the
 * claims genuinely needing a Finance judgment call — not every open flag in
 * the system (an action_required claim is back with the employee).
 */
export function openFinanceExceptions(): Claim[] {
  return claims.filter(
    (c) =>
      FINANCE_PAYMENT_STATUSES.includes(c.status) &&
      c.exception?.status === "open"
  );
}

/** Claims fully approved and ready for Finance to disburse. Claims still
 *  carrying an OPEN policy flag are excluded — they must be resolved in the
 *  exception queue before they can be paid. */
export function claimsReadyToPay(): Claim[] {
  return claims.filter(
    (c) => c.status === "approved" && c.exception?.status !== "open"
  );
}

/** Claims whose payment is currently in flight. */
export function claimsProcessing(): Claim[] {
  return claims.filter((c) => c.status === "processing");
}

/** Claims already reimbursed, newest-paid first. */
export function claimsPaid(): Claim[] {
  return claims
    .filter((c) => c.status === "paid")
    .sort((a, b) => {
      const pa = a.payment?.paidAt ?? a.decidedAt ?? a.submittedAt ?? a.createdAt;
      const pb = b.payment?.paidAt ?? b.decidedAt ?? b.submittedAt ?? b.createdAt;
      return pb.localeCompare(pa);
    });
}

export function commentsForClaim(claimId: string): Comment[] {
  return comments
    .filter((c) => c.claimId === claimId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function auditForClaim(claimId: string): AuditEntry[] {
  return auditLog
    .filter((a) => a.claimId === claimId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function notificationsFor(role: Role): Notification[] {
  return notifications
    .filter((n) => n.audience === role)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function unreadCount(role: Role): number {
  return notifications.filter((n) => n.audience === role && !n.read).length;
}

/**
 * Whether a user may participate in a claim's comments / audit trail.
 *
 * Phase 1 has one user per role: the claim submitter, their line manager
 * (the approver in the claim's routing — every seeded employee reports to
 * u-mgr-1), and the Finance Admin. The submitter, any approver in the claim's
 * routing, and Finance are participants; anyone else is blocked. Used to gate
 * the comments thread and the audit viewer per ticket #8.
 */
export function isClaimParticipant(claim: Claim, user: User): boolean {
  if (user.role === "finance") return true;
  if (claim.employeeId === user.id) return true;
  if (user.role === "approver") {
    // Phase 1 routing step 0 is "submitter_manager" → resolve to the manager id.
    const submitter = getUser(claim.employeeId);
    return submitter?.managerId === user.id;
  }
  return false;
}

/**
 * Resolve the claim detail route for a role. Employee and Approver each have a
 * dedicated per-claim detail page; Finance has no standalone claim detail in
 * Phase 1, so the audit trail (Finance-accessible, claim-scoped) is the
 * closest "claim view". Used by notification click navigation (#8).
 */
export function claimDetailRoute(role: Role, claimId: string): string {
  if (role === "employee") return `/employee/claims/${claimId}`;
  if (role === "approver") return `/approver/claims/${claimId}`;
  return `/claims/${claimId}/audit`;
}

/* ============================================================================
   SpendFlow — Employee Dashboard data shaping (Phase 1, mock data).
   Pure selectors that turn raw mock fixtures into the shape the dashboard
   renders. Kept separate from the page so it is trivially unit-testable and
   so the page can simulate async loading + failure around a single seam.
   ========================================================================== */

import {
  claimsForEmployee,
  computeClaimTotal,
  type Claim,
  type ClaimStatus,
} from "@/lib/mock/mock_data";

/** The four status groups the PRD calls out as the at-a-glance summary. */
export const PRIMARY_STATUSES: ClaimStatus[] = [
  "draft",
  "pending",
  "action_required",
  "paid",
];

/** Extra statuses surfaced for completeness when they have activity. */
export const SECONDARY_STATUSES: ClaimStatus[] = [
  "approved",
  "processing",
  "rejected",
];

export interface StatusGroup {
  status: ClaimStatus;
  label: string;
  count: number;
  amount: number;
}

export interface PaidClaimEntry {
  claim: Claim;
  amount: number;
  paidAt: string;
}

export interface EmployeeDashboardData {
  employeeId: string;
  groups: StatusGroup[];
  primaryGroups: StatusGroup[];
  secondaryGroups: StatusGroup[];
  actionRequired: Claim[];
  recentlyPaid: PaidClaimEntry[];
  totalReimbursed: number;
  paidCount: number;
  hasAnyClaims: boolean;
}

export const STATUS_LABELS: Record<ClaimStatus, string> = {
  draft: "Draft",
  pending: "Pending Approval",
  action_required: "Action Required",
  approved: "Approved",
  processing: "Processing",
  paid: "Paid",
  rejected: "Rejected",
};

/** Resolve the paid timestamp for a claim: the `paid` approval action first. */
export function resolvePaidAt(claim: Claim): string | undefined {
  const paid = claim.approvals.find((a) => a.action === "paid");
  if (paid) return paid.at;
  return claim.decidedAt ?? claim.submittedAt;
}

/**
 * Build the full employee dashboard payload from mock data.
 * Throws if the underlying fixtures cannot be read — the page surfaces that as
 * an explicit retry-capable error state (never a blank dashboard).
 */
export function loadEmployeeDashboard(employeeId: string): EmployeeDashboardData {
  const all = claimsForEmployee(employeeId);

  const buildGroup = (status: ClaimStatus): StatusGroup => {
    const inStatus = all.filter((c) => c.status === status);
    return {
      status,
      label: STATUS_LABELS[status],
      count: inStatus.length,
      amount: inStatus.reduce((sum, c) => sum + computeClaimTotal(c), 0),
    };
  };

  const groups = [...PRIMARY_STATUSES, ...SECONDARY_STATUSES].map(buildGroup);
  const byStatus = (s: ClaimStatus) => groups.find((g) => g.status === s)!;
  const primaryGroups = PRIMARY_STATUSES.map(byStatus);
  const secondaryGroups = SECONDARY_STATUSES.map(byStatus).filter(
    (g) => g.count > 0
  );

  const actionRequired = all
    .filter((c) => c.status === "action_required")
    .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt));

  const recentlyPaid = all
    .filter((c) => c.status === "paid")
    .map((claim) => {
      const amount = computeClaimTotal(claim);
      const paidAt = resolvePaidAt(claim) ?? claim.submittedAt ?? claim.createdAt;
      return { claim, amount, paidAt };
    })
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  const paidGroup = byStatus("paid");
  const totalReimbursed = paidGroup.amount;

  return {
    employeeId,
    groups,
    primaryGroups,
    secondaryGroups,
    actionRequired,
    recentlyPaid,
    totalReimbursed,
    paidCount: paidGroup.count,
    hasAnyClaims: all.length > 0,
  };
}

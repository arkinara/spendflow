/* ============================================================================
   SpendFlow — Employee Dashboard data shaping.
   FALLBACK ONLY (ticket #18): the employee dashboard now reads from
   `/api/claims` via `useEmployeeDashboard` + `buildDashboard`. This module's
   mock-backed `loadEmployeeDashboard` is retained as a fallback / for the
   other verticals (#19–#23) that still consume the in-memory fixtures.
   Pure selectors that turn raw claim rows into the shape the dashboard
   renders. Kept separate from the page so it is trivially unit-testable.
   ========================================================================== */

import {
  claimsForEmployee,
  computeClaimTotal,
} from "@/lib/mock/mock_data";
import type { Claim, ClaimStatus } from "@/lib/types";

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
  const paid = claim.approvals?.find((a) => a.action === "paid");
  if (paid) return paid.at;
  return claim.decidedAt ?? claim.submittedAt;
}

/**
 * Pure dashboard builder over an already-fetched claim set. Used by the
 * HTTP-backed `useEmployeeDashboard` hook (#18) so the dashboard render path
 * has a single shaping seam independent of the data source. Tolerant of
 * claims whose `approvals` array is empty (BE-sourced claims carry no
 * approval timeline inline — that lives in the audit endpoint).
 */
export function buildDashboard(
  employeeId: string,
  allClaims: Claim[],
): EmployeeDashboardData {
  const all = allClaims;

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
    (g) => g.count > 0,
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

/**
 * Build the full employee dashboard payload from the in-memory mock fixtures.
 * FALLBACK: kept for the remaining mock-backed verticals (#19–#23); the
 * employee dashboard itself now flows through `buildDashboard` over real BE
 * rows (see `useEmployeeDashboard`).
 */
export function loadEmployeeDashboard(employeeId: string): EmployeeDashboardData {
  return buildDashboard(employeeId, claimsForEmployee(employeeId));
}

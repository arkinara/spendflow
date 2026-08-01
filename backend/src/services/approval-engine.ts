/* ============================================================================
 * SpendFlow — Approval route resolution engine (ticket #12).
 *
 * Pure module: given a claim, the submitting employee, and the configured
 * active routes (with their ordered steps), resolves which route + ordered
 * step list applies. Specific routes are matched in declared order; if none
 * matches the active fallback route is used; if no fallback exists a typed
 * configuration error is thrown so submission fails loudly rather than
 * leaving the claim unrouted.
 *
 * DB-free on purpose: the same call is reused by claim submission (#11) and
 * Phase 2 mobile submission without re-implementing the matcher.
 * ========================================================================== */

import type { ApproverType } from "../db/schema.js";

export interface RoutingStep {
  id: string;
  approverType: ApproverType;
  /** Required when `approverType === "specific_user"`; null otherwise. */
  approverId?: string | null;
  label: string;
  /** Zero-based ordering within the route. */
  orderIndex: number;
}

export interface ApprovalRouteConfig {
  id: string;
  name: string;
  active: boolean;
  isFallback: boolean;
  match: {
    minAmount?: number | null;
    maxAmount?: number | null;
    categoryId?: string | null;
    department?: string | null;
  };
  steps: RoutingStep[];
}

/** Minimal claim shape the matcher needs. */
export interface RouteClaimInput {
  /** Sum of all line-item amounts (minor units). */
  totalAmount: number;
  /** Distinct category ids present on the claim's line items. */
  categoryIds: string[];
  /** Submitting employee's department (matched against route match). */
  department?: string | null;
}

export class RoutingError extends Error {
  constructor(
    public code: "no_route" | "no_steps" | "invalid_route",
    message: string
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

function matches(route: ApprovalRouteConfig, claim: RouteClaimInput): boolean {
  if (!route.active) return false;
  const { minAmount, maxAmount, categoryId, department } = route.match;
  if (minAmount != null && claim.totalAmount < minAmount) return false;
  if (maxAmount != null && claim.totalAmount > maxAmount) return false;
  if (categoryId != null && !claim.categoryIds.includes(categoryId)) return false;
  if (department != null && claim.department !== department) return false;
  return true;
}

/**
 * Resolve the route a submitted claim auto-matches, plus its ordered steps.
 *
 * Specific (non-fallback) routes are evaluated in declared order; the first
 * match wins. If none matches, the active fallback route is used. If there
 * is no active fallback either, {@link RoutingError}("no_route") is thrown —
 * a configuration error surfaced at submission time so Finance can fix it.
 *
 * Re-resolving the same claim yields the same route deterministically
 * (route order is stable), so retries never duplicate or shift assignments.
 */
export function resolveApprovalRoute(
  claim: RouteClaimInput,
  routes: ApprovalRouteConfig[]
): { route: ApprovalRouteConfig; steps: RoutingStep[] } {
  for (const route of routes) {
    if (!route.active || route.isFallback) continue;
    if (matches(route, claim)) {
      const steps = orderedSteps(route);
      if (steps.length === 0) {
        throw new RoutingError(
          "no_steps",
          `Route ${route.id} (${route.name}) has no configured steps`
        );
      }
      return { route, steps };
    }
  }
  const fallback = routes.find((r) => r.active && r.isFallback);
  if (!fallback) {
    throw new RoutingError(
      "no_route",
      "No active approval route matched this claim and no fallback route is configured"
    );
  }
  const steps = orderedSteps(fallback);
  if (steps.length === 0) {
    throw new RoutingError(
      "no_steps",
      `Fallback route ${fallback.id} (${fallback.name}) has no configured steps`
    );
  }
  return { route: fallback, steps };
}

/** Steps in their declared order (defensive copy, sorted by `orderIndex`). */
function orderedSteps(route: ApprovalRouteConfig): RoutingStep[] {
  return [...route.steps].sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Resolve which user id(s) act as the approver for a given step against a
 * submitted claim. Returns one or more user ids:
 *  - `submitter_manager` → the claim employee's `managerId` (may be empty
 *    when the employee has no manager — surfaced as an empty list so the
 *    caller can flag a configuration gap).
 *  - `specific_user` → the step's `approverId`.
 *  - `finance` → resolved by the caller (every finance user); we return an
 *    empty marker list here and let the decision service expand it.
 */
export function approverUserIdsForStep(
  step: RoutingStep,
  employeeManagerId: string | null
): { userIds: string[]; requiresFinanceRole: boolean } {
  switch (step.approverType) {
    case "submitter_manager":
      return {
        userIds: employeeManagerId ? [employeeManagerId] : [],
        requiresFinanceRole: false,
      };
    case "specific_user":
      return {
        userIds: step.approverId ? [step.approverId] : [],
        requiresFinanceRole: false,
      };
    case "finance":
      return { userIds: [], requiresFinanceRole: true };
  }
}

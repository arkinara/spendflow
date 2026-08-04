/* ============================================================================
   SpendFlow — Finance Admin store (Phase 1, mock persistence).
   FALLBACK ONLY as of ticket #21: `/finance/policies` now reads/writes
   through the HTTP client `lib/api/admin.ts` (`useAdminStore.ts`). This file
   stays for any other in-progress verticals that still import it directly —
   do not wire new admin UI against it.
   Category, Policy, and Approval-Routing administration. Each mutator writes
   directly into the live `categories` / `policies` / `routingRules` arrays so
   every selector (and the live admin UI) reflects the change on its next
   refresh — mirroring how a real backend would persist and re-emit. Throws on
   invalid input so the caller surfaces a validation error instead of a silent
   drop. Effective dating + route matching are pure helpers used by the admin
   preview and the (future) BE-admin wiring.
   ========================================================================== */

import {
  categories,
  policies,
  routingRules,
  users,
  computeClaimTotal,
  getUser,
  getCategory,
  type ExpenseCategory,
  type Policy,
  type RoutingRule,
  type RoutingStep,
  type RoutingMatch,
  type ApproverType,
  type Claim,
  type ExpenseCategoryId,
} from "@/lib/mock/mock_data";
import type { CurrencyCode } from "@/lib/format";

/* ----------------------------------------------------------------- ids -- */

let adminSeq = 7000;
function nextId(prefix: string): string {
  adminSeq += 1;
  return `${prefix}-${adminSeq}`;
}

/** Deterministic step id inside a route (stable across reorders). */
function stepId(routeId: string, n: number): string {
  return `${routeId}-st-${n}`;
}

/* ============================================================= CATEGORIES == */

export interface CategoryInput {
  id?: string;
  name: string;
  code: string;
  icon?: string;
  requiresMileage: boolean;
  requiresReceipt: boolean;
  receiptThreshold: number;
  perItemCap?: number;
  active?: boolean;
}

function assertCategoryInput(input: CategoryInput): void {
  const name = input.name.trim();
  if (!name) throw new Error("Category name is required.");
  const code = input.code.trim();
  if (!code) throw new Error("Category code is required.");
  if (!/^[A-Z0-9]{2,6}$/i.test(code)) {
    throw new Error("Code must be 2–6 letters or digits.");
  }
  const dup = categories.find(
    (c) => c.code.toLowerCase() === code.toLowerCase() && c.id !== input.id
  );
  if (dup) throw new Error(`Code “${code}” is already used by “${dup.name}”.`);
  if (
    Number.isNaN(input.receiptThreshold) ||
    input.receiptThreshold < 0
  ) {
    throw new Error("Receipt threshold must be zero or a positive amount.");
  }
  if (input.perItemCap != null && input.perItemCap < 0) {
    throw new Error("Per-item cap cannot be negative.");
  }
}

/** Create and insert a new category into the live store; returns the new row. */
export function createCategory(input: CategoryInput): ExpenseCategory {
  assertCategoryInput(input);
  const id = nextId("cat");
  const row: ExpenseCategory = {
    id,
    name: input.name.trim(),
    code: input.code.trim().toUpperCase(),
    icon: input.icon?.trim() || "Receipt",
    requiresMileage: input.requiresMileage,
    requiresReceipt: input.requiresReceipt,
    receiptThreshold: input.receiptThreshold,
    perItemCap: input.perItemCap,
    active: input.active ?? true,
  };
  categories.push(row);
  return row;
}

/** Patch an existing category in place; throws if it is missing. */
export function updateCategory(
  id: string,
  patch: Partial<Omit<CategoryInput, "id">>
): ExpenseCategory {
  const row = categories.find((c) => c.id === id);
  if (!row) throw new Error("That category no longer exists.");
  assertCategoryInput({
    name: patch.name ?? row.name,
    code: patch.code ?? row.code,
    requiresMileage: patch.requiresMileage ?? row.requiresMileage,
    requiresReceipt: patch.requiresReceipt ?? row.requiresReceipt,
    receiptThreshold: patch.receiptThreshold ?? row.receiptThreshold,
    perItemCap: patch.perItemCap ?? row.perItemCap,
    id: row.id,
  });
  if (patch.name != null) row.name = patch.name.trim();
  if (patch.code != null) row.code = patch.code.trim().toUpperCase();
  if (patch.icon != null) row.icon = patch.icon;
  if (patch.requiresMileage != null) row.requiresMileage = patch.requiresMileage;
  if (patch.requiresReceipt != null) row.requiresReceipt = patch.requiresReceipt;
  if (patch.receiptThreshold != null) row.receiptThreshold = patch.receiptThreshold;
  if (patch.perItemCap != null) row.perItemCap = patch.perItemCap;
  if (patch.active != null) row.active = patch.active;
  return row;
}

/**
 * Soft-delete (deactivate) a category. The row stays in the list, marked
 * inactive, so historical claims that reference it keep a stable label. Use
 * {@link updateCategory} with `{ active: true }` to re-enable.
 */
export function setCategoryActive(id: string, active: boolean): ExpenseCategory {
  const row = categories.find((c) => c.id === id);
  if (!row) throw new Error("That category no longer exists.");
  row.active = active;
  return row;
}

/** Categories available to employees in the claim builder (active only). */
export function getActiveCategories(): ExpenseCategory[] {
  return categories.filter((c) => c.active);
}

/* ================================================================ POLICIES == */

/**
 * Currencies a spend policy may be denominated in (Phase 1). `PolicyInput`
 * types `currency` as `CurrencyCode`, but that is TypeScript-only — a value
 * cast past the compiler (or arriving from future BE wiring / JSON) would be
 * persisted unchecked. This runtime allowlist is enforced at the store write
 * boundary ({@link assertPolicyInput}) so an unknown ISO 4217 code is rejected
 * with a clear typed error instead of silently stored.
 */
export const SUPPORTED_POLICY_CURRENCIES: readonly CurrencyCode[] = ["IDR", "USD"];

/** True when `code` is a policy currency the store will persist. */
export function isSupportedPolicyCurrency(code: string): boolean {
  return (SUPPORTED_POLICY_CURRENCIES as readonly string[]).includes(code);
}

export interface PolicyInput {
  id?: string;
  name: string;
  description?: string;
  categoryId?: ExpenseCategoryId | "";
  limit: number;
  period: Policy["period"];
  currency: CurrencyCode;
  receiptRequired: boolean;
  receiptRequiredAbove: number;
  justificationRequiredAbove: number;
  effectiveDate: string; // ISO yyyy-mm-dd
  active?: boolean;
}

function assertPolicyInput(input: PolicyInput): void {
  const name = input.name.trim();
  if (!name) throw new Error("Policy name is required.");
  if (!isSupportedPolicyCurrency(input.currency)) {
    throw new Error(
      `Currency “${input.currency}” is not supported. Choose one of: ${SUPPORTED_POLICY_CURRENCIES.join(", ")}.`
    );
  }
  if (Number.isNaN(input.limit) || input.limit <= 0) {
    throw new Error("Max amount must be a positive number.");
  }
  if (
    Number.isNaN(input.receiptRequiredAbove) ||
    input.receiptRequiredAbove < 0
  ) {
    throw new Error("Receipt-required threshold cannot be negative.");
  }
  if (
    Number.isNaN(input.justificationRequiredAbove) ||
    input.justificationRequiredAbove < 0
  ) {
    throw new Error("Justification-required threshold cannot be negative.");
  }
  // Cross-field guard (analogous to the routing min<max check): a trigger
  // threshold must not exceed the max reimbursable amount, otherwise the rule
  // is unreachable for in-policy expenses.
  if (input.receiptRequiredAbove > input.limit) {
    throw new Error("Receipt-required threshold cannot exceed the max amount.");
  }
  if (input.justificationRequiredAbove > input.limit) {
    throw new Error(
      "Justification-required threshold cannot exceed the max amount."
    );
  }
  if (!input.effectiveDate || Number.isNaN(new Date(input.effectiveDate).getTime())) {
    throw new Error("A valid effective date is required.");
  }
}

export function createPolicy(input: PolicyInput): Policy {
  assertPolicyInput(input);
  const id = nextId("pol");
  const row: Policy = {
    id,
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    categoryId: input.categoryId || undefined,
    limit: input.limit,
    period: input.period,
    currency: input.currency,
    receiptRequired: input.receiptRequired,
    receiptRequiredAbove: input.receiptRequiredAbove,
    justificationRequiredAbove: input.justificationRequiredAbove,
    effectiveDate: input.effectiveDate,
    active: input.active ?? true,
  };
  policies.push(row);
  return row;
}

export function updatePolicy(
  id: string,
  patch: Partial<Omit<PolicyInput, "id">>
): Policy {
  const row = policies.find((p) => p.id === id);
  if (!row) throw new Error("That policy no longer exists.");
  assertPolicyInput({
    name: patch.name ?? row.name,
    limit: patch.limit ?? row.limit,
    period: patch.period ?? row.period,
    currency: patch.currency ?? row.currency,
    receiptRequired: patch.receiptRequired ?? row.receiptRequired,
    receiptRequiredAbove: patch.receiptRequiredAbove ?? row.receiptRequiredAbove,
    justificationRequiredAbove:
      patch.justificationRequiredAbove ?? row.justificationRequiredAbove,
    effectiveDate: patch.effectiveDate ?? row.effectiveDate,
  });
  if (patch.name != null) row.name = patch.name.trim();
  if (patch.description != null) row.description = patch.description.trim();
  if (patch.categoryId != null) row.categoryId = patch.categoryId || undefined;
  if (patch.limit != null) row.limit = patch.limit;
  if (patch.period != null) row.period = patch.period;
  if (patch.currency != null) row.currency = patch.currency;
  if (patch.receiptRequired != null) row.receiptRequired = patch.receiptRequired;
  if (patch.receiptRequiredAbove != null)
    row.receiptRequiredAbove = patch.receiptRequiredAbove;
  if (patch.justificationRequiredAbove != null)
    row.justificationRequiredAbove = patch.justificationRequiredAbove;
  if (patch.effectiveDate != null) row.effectiveDate = patch.effectiveDate;
  if (patch.active != null) row.active = patch.active;
  return row;
}

export function setPolicyActive(id: string, active: boolean): Policy {
  const row = policies.find((p) => p.id === id);
  if (!row) throw new Error("That policy no longer exists.");
  row.active = active;
  return row;
}

/* ------------------------------------------------ effective-dating helpers -- */

/**
 * True when a policy is in force on the given ISO date: active AND its
 * effective date is on/before the as-of date. Used to demonstrate that a
 * policy edit with a future effective date does not yet apply to claims
 * submitted today, while historical claims stay under the rules in force at
 * their submission time.
 */
export function policyEffectiveOn(policy: Policy, asOfIso: string): boolean {
  if (!policy.active) return false;
  const asOf = new Date(asOfIso);
  const eff = new Date(policy.effectiveDate);
  if (Number.isNaN(asOf.getTime()) || Number.isNaN(eff.getTime())) return false;
  // Compare calendar dates only (drop time/timezone noise).
  const a = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const e = new Date(eff.getFullYear(), eff.getMonth(), eff.getDate());
  return e.getTime() <= a.getTime();
}

/**
 * The in-force policy for a category on a given date, preferring the most
 * recently effective one when several apply. Returns undefined when no active
 * policy covers the category.
 */
export function activePolicyFor(
  categoryId: ExpenseCategoryId,
  asOfIso: string
): Policy | undefined {
  const candidates = policies
    .filter((p) => p.categoryId === categoryId)
    .filter((p) => policyEffectiveOn(p, asOfIso))
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  return candidates[0];
}

/* ================================================================ ROUTING === */

export interface RouteStepInput {
  id?: string;
  approverType: ApproverType;
  approverId?: string;
  label?: string;
}

export interface RouteInput {
  id?: string;
  name: string;
  condition?: string;
  match: RoutingMatch;
  steps: RouteStepInput[];
  isFallback?: boolean;
  active?: boolean;
}

function normalizeStep(
  routeId: string,
  step: RouteStepInput,
  index: number
): RoutingStep {
  const approverType = step.approverType;
  if (approverType === "specific_user") {
    if (!step.approverId) {
      throw new Error("A named approver step must select a specific user.");
    }
    const u = getUser(step.approverId);
    if (!u) throw new Error("The selected approver could not be found.");
  }
  const label =
    step.label?.trim() ||
    (approverType === "submitter_manager"
      ? "Submitter's manager"
      : approverType === "finance"
        ? "Finance Admin"
        : getUser(step.approverId ?? "")?.name ?? "Approver");
  return {
    id: step.id ?? stepId(routeId, index + 1),
    approverType,
    approverId: approverType === "specific_user" ? step.approverId : undefined,
    label,
  };
}

function assertRouteInput(input: RouteInput): void {
  const name = input.name.trim();
  if (!name) throw new Error("Route name is required.");
  if (!input.steps || input.steps.length === 0) {
    throw new Error("A route needs at least one approval step.");
  }
  if (input.match.minAmount != null && input.match.minAmount < 0) {
    throw new Error("Minimum amount cannot be negative.");
  }
  if (input.match.maxAmount != null && input.match.maxAmount < 0) {
    throw new Error("Maximum amount cannot be negative.");
  }
  if (
    input.match.minAmount != null &&
    input.match.maxAmount != null &&
    input.match.minAmount > input.match.maxAmount
  ) {
    throw new Error("Minimum amount cannot exceed the maximum amount.");
  }
}

export function createRoute(input: RouteInput): RoutingRule {
  assertRouteInput(input);
  const id = nextId("rt");
  const steps = input.steps.map((s, i) => normalizeStep(id, s, i));
  const row: RoutingRule = {
    id,
    name: input.name.trim(),
    condition: input.condition?.trim() || summarizeMatch(input.match),
    match: { ...input.match },
    steps,
    isFallback: input.isFallback ?? false,
    active: input.active ?? true,
  };
  routingRules.push(row);
  return row;
}

export function updateRoute(
  id: string,
  patch: Partial<Omit<RouteInput, "id">>
): RoutingRule {
  const row = routingRules.find((r) => r.id === id);
  if (!row) throw new Error("That route no longer exists.");
  const merged: RouteInput = {
    name: patch.name ?? row.name,
    condition: patch.condition ?? row.condition,
    match: patch.match ?? row.match,
    steps: patch.steps ?? row.steps,
    isFallback: patch.isFallback ?? row.isFallback,
    active: patch.active ?? row.active,
  };
  assertRouteInput(merged);
  row.name = merged.name.trim();
  row.condition = merged.condition?.trim() || summarizeMatch(merged.match);
  row.match = { ...merged.match };
  row.steps = merged.steps.map((s, i) => normalizeStep(id, s, i));
  row.isFallback = merged.isFallback ?? false;
  if (patch.active != null) row.active = patch.active;
  return row;
}

export function setRouteActive(id: string, active: boolean): RoutingRule {
  const row = routingRules.find((r) => r.id === id);
  if (!row) throw new Error("That route no longer exists.");
  row.active = active;
  return row;
}

/**
 * Rewrite a route's step order from an ordered list of step ids. Throws if the
 * supplied order omits or duplicates any existing step (the new order must be
 * a permutation of the current steps).
 */
export function reorderRouteSteps(
  routeId: string,
  orderedStepIds: string[]
): RoutingRule {
  const row = routingRules.find((r) => r.id === routeId);
  if (!row) throw new Error("That route no longer exists.");
  if (orderedStepIds.length !== row.steps.length) {
    throw new Error("Reorder must include every step exactly once.");
  }
  const byId = new Map(row.steps.map((s) => [s.id, s]));
  const next: RoutingStep[] = [];
  const seen = new Set<string>();
  for (const sid of orderedStepIds) {
    if (!byId.has(sid)) {
      throw new Error("Reorder references an unknown step.");
    }
    if (seen.has(sid)) {
      throw new Error("A step appears more than once in the new order.");
    }
    seen.add(sid);
    next.push(byId.get(sid)!);
  }
  row.steps = next;
  return row;
}

/* --------------------------------------------------- route matching engine -- */

function routeMatches(rule: RoutingRule, claim: Claim): boolean {
  if (!rule.active) return false;
  const { minAmount, maxAmount, categoryId, department } = rule.match;
  const total = computeClaimTotal(claim);
  if (minAmount != null && total < minAmount) return false;
  if (maxAmount != null && total > maxAmount) return false;
  if (
    categoryId != null &&
    !claim.lineItems.some((l) => l.categoryId === categoryId)
  ) {
    return false;
  }
  if (department != null) {
    const emp = getUser(claim.employeeId);
    if (!emp || emp.department !== department) return false;
  }
  return true;
}

/**
 * Resolve the active route a submitted claim auto-matches, based on its
 * attributes (total, categories, department). Specific routes are evaluated in
 * declared order; if none matches, the active fallback route applies. Always
 * returns a route (a synthetic fallback is synthesised if even the seeded
 * fallback is missing, so a claim is never left unrouted).
 */
export function matchRouteForClaim(claim: Claim): RoutingRule {
  for (const rule of routingRules) {
    if (rule.isFallback) continue;
    if (routeMatches(rule, claim)) return rule;
  }
  const fallback = routingRules.find((r) => r.isFallback && r.active);
  if (fallback) return fallback;
  return {
    id: "rt-synthetic-fallback",
    name: "Standard claim (fallback)",
    condition: "Synthesised fallback",
    match: {},
    steps: [
      { id: "rt-syn-1", approverType: "submitter_manager", label: "Line manager" },
    ],
    isFallback: true,
    active: true,
  };
}

/* --------------------------------------------------------------- selectors -- */

/** All routes excluding the fallback (used by the admin matcher preview). */
export function specificActiveRoutes(): RoutingRule[] {
  return routingRules.filter((r) => r.active && !r.isFallback);
}

export function getFallbackRoute(): RoutingRule | undefined {
  return routingRules.find((r) => r.isFallback);
}

/* ----------------------------------------------------------------- helpers -- */

/** Build a human label for a routing match (used when condition is blank). */
export function summarizeMatch(match: RoutingMatch): string {
  const parts: string[] = [];
  if (match.minAmount != null && match.maxAmount != null) {
    parts.push(`IDR ${match.minAmount.toLocaleString("id-ID")}–${match.maxAmount.toLocaleString("id-ID")}`);
  } else if (match.minAmount != null) {
    parts.push(`Total ≥ IDR ${match.minAmount.toLocaleString("id-ID")}`);
  } else if (match.maxAmount != null) {
    parts.push(`Total ≤ IDR ${match.maxAmount.toLocaleString("id-ID")}`);
  }
  if (match.categoryId != null) {
    parts.push(`Category: ${getCategory(match.categoryId)?.name ?? match.categoryId}`);
  }
  if (match.department != null) parts.push(`Dept: ${match.department}`);
  return parts.length ? parts.join(" · ") : "Any claim";
}

/** Human label for an approver type (used in the route builder dropdown). */
export function approverTypeLabel(type: ApproverType): string {
  switch (type) {
    case "submitter_manager":
      return "Submitter's manager";
    case "finance":
      return "Finance Admin";
    case "specific_user":
      return "Named approver";
  }
}

/** Re-exported so tests can snapshot/restore the live admin collections. */
export { categories, policies, routingRules, users };

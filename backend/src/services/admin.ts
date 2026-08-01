/* ============================================================================
 * SpendFlow — Policy, Category & Approval Routing Administration (ticket #14).
 *
 * Finance-Admin-only configuration CRUD over the tables `#11`/`#12` already
 * modelled (`categories`, `policies`, `approval_routes`, `approval_steps`).
 * No schema change was needed — every column this ticket needs (`code`,
 * `active`, `effective_date`, `receipt_required_above`,
 * `justification_required_above`, `currency`) already exists.
 *
 * Deletions are always soft: category/policy/route rows are deactivated
 * (`active = false`), never removed, so historical claims/line items/claims
 * that reference them by id keep resolving. Route step *edits* replace the
 * step set for that route (steps carry no independent history — only
 * `approval_actions.step_id`, which is nullable and `onDelete: set null`, so a
 * historical action keeps its claim/actor/decision even if its step row is
 * later replaced).
 * ========================================================================== */

import { asc, eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import {
  APPROVER_TYPES,
  CURRENCIES,
  approvalRoutesTable,
  approvalStepsTable,
  categoriesTable,
  policiesTable,
  type ApproverType,
  type Currency,
} from "../db/schema.js";
import { writeAudit } from "./audit.js";
import {
  resolveApprovalRoute,
  RoutingError,
  type ApprovalRouteConfig,
  type RouteClaimInput,
  type RoutingStep,
} from "./approval-engine.js";

export class AdminError extends Error {
  constructor(
    public status: number,
    public code:
      | "not_found"
      | "validation"
      | "duplicate_code"
      | "invalid_steps",
    message: string
  ) {
    super(message);
    this.name = "AdminError";
  }
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ========================================================================= */
/* Categories                                                                 */
/* ========================================================================= */

export interface CategoryRow {
  id: string;
  name: string;
  code: string;
  requiresReceipt: boolean;
  receiptThreshold: number;
  perItemCap: number | null;
  mileageRate: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toCategoryRow(row: typeof categoriesTable.$inferSelect): CategoryRow {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    requiresReceipt: row.requiresReceipt,
    receiptThreshold: row.receiptThreshold,
    perItemCap: row.perItemCap,
    mileageRate: row.mileageRate,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** All categories (active + inactive) ordered by name — admin view. */
export function listCategories(db: DB): CategoryRow[] {
  return db.select().from(categoriesTable).orderBy(asc(categoriesTable.name)).all().map(toCategoryRow);
}

function loadCategoryOrFail(db: DB, id: string) {
  const row = db.select().from(categoriesTable).where(eq(categoriesTable.id, id)).get();
  if (!row) throw new AdminError(404, "not_found", `Category ${id} not found`);
  return row;
}

function assertUniqueCode(db: DB, code: string, excludeId?: string) {
  const existing = db.select().from(categoriesTable).where(eq(categoriesTable.code, code)).all();
  if (existing.some((r) => r.id !== excludeId)) {
    throw new AdminError(409, "duplicate_code", `Category code "${code}" is already in use`);
  }
}

export interface CategoryInput {
  name: string;
  code: string;
  requiresReceipt?: boolean;
  receiptThreshold?: number;
  perItemCap?: number | null;
  mileageRate?: number | null;
}

export function addCategory(db: DB, actorId: string, input: CategoryInput): CategoryRow {
  const name = input.name?.trim();
  const code = input.code?.trim();
  if (!name) throw new AdminError(400, "validation", "Category name is required");
  if (!code) throw new AdminError(400, "validation", "Category code is required");
  assertUniqueCode(db, code);

  const now = new Date();
  const id = newId("cat");
  db.insert(categoriesTable)
    .values({
      id,
      name,
      code,
      requiresReceipt: input.requiresReceipt ?? false,
      receiptThreshold: input.receiptThreshold ?? 0,
      perItemCap: input.perItemCap ?? null,
      mileageRate: input.mileageRate ?? null,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = toCategoryRow(loadCategoryOrFail(db, id));
  writeAudit(db, {
    actorId,
    action: "category.create",
    entityType: "category",
    entityId: id,
    after: row,
  });
  return row;
}

export type CategoryEditInput = Partial<CategoryInput>;

export function editCategory(
  db: DB,
  actorId: string,
  id: string,
  input: CategoryEditInput
): CategoryRow {
  const before = toCategoryRow(loadCategoryOrFail(db, id));
  const name = input.name !== undefined ? input.name.trim() : before.name;
  const code = input.code !== undefined ? input.code.trim() : before.code;
  if (!name) throw new AdminError(400, "validation", "Category name is required");
  if (!code) throw new AdminError(400, "validation", "Category code is required");
  if (code !== before.code) assertUniqueCode(db, code, id);

  const now = new Date();
  db.update(categoriesTable)
    .set({
      name,
      code,
      requiresReceipt: input.requiresReceipt ?? before.requiresReceipt,
      receiptThreshold: input.receiptThreshold ?? before.receiptThreshold,
      perItemCap: input.perItemCap !== undefined ? input.perItemCap : before.perItemCap,
      mileageRate: input.mileageRate !== undefined ? input.mileageRate : before.mileageRate,
      updatedAt: now,
    })
    .where(eq(categoriesTable.id, id))
    .run();
  const after = toCategoryRow(loadCategoryOrFail(db, id));
  writeAudit(db, {
    actorId,
    action: "category.update",
    entityType: "category",
    entityId: id,
    before,
    after,
  });
  return after;
}

/** Soft delete — sets `active = false`. Never removes the row, so historical
 *  claim line items referencing this category keep resolving. */
export function deactivateCategory(db: DB, actorId: string, id: string): CategoryRow {
  const before = toCategoryRow(loadCategoryOrFail(db, id));
  if (!before.active) return before;
  const now = new Date();
  db.update(categoriesTable)
    .set({ active: false, updatedAt: now })
    .where(eq(categoriesTable.id, id))
    .run();
  const after = toCategoryRow(loadCategoryOrFail(db, id));
  writeAudit(db, {
    actorId,
    action: "category.deactivate",
    entityType: "category",
    entityId: id,
    before: { active: before.active },
    after: { active: false },
  });
  return after;
}

/* ========================================================================= */
/* Policies                                                                   */
/* ========================================================================= */

export interface PolicyRow {
  id: string;
  name: string;
  description: string;
  categoryId: string | null;
  limitAmount: number | null;
  period: "per_item" | "per_day" | "per_trip" | "per_month";
  currency: Currency;
  receiptRequired: boolean;
  receiptRequiredAbove: number;
  justificationRequiredAbove: number;
  effectiveDate: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toPolicyRow(row: typeof policiesTable.$inferSelect): PolicyRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId,
    limitAmount: row.limitAmount,
    period: row.period,
    currency: row.currency as Currency,
    receiptRequired: row.receiptRequired,
    receiptRequiredAbove: row.receiptRequiredAbove,
    justificationRequiredAbove: row.justificationRequiredAbove,
    effectiveDate: row.effectiveDate,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** All policies (active + inactive) ordered by effective date — admin view. */
export function listPolicies(db: DB): PolicyRow[] {
  return db.select().from(policiesTable).orderBy(asc(policiesTable.effectiveDate)).all().map(toPolicyRow);
}

function loadPolicyOrFail(db: DB, id: string) {
  const row = db.select().from(policiesTable).where(eq(policiesTable.id, id)).get();
  if (!row) throw new AdminError(404, "not_found", `Policy ${id} not found`);
  return row;
}

export interface PolicyInput {
  name: string;
  description?: string;
  categoryId: string;
  limitAmount: number;
  period?: "per_item" | "per_day" | "per_trip" | "per_month";
  currency: string;
  receiptRequired?: boolean;
  receiptRequiredAbove?: number;
  justificationRequiredAbove?: number;
  effectiveDate: string;
}

/** Validate the fully-merged field set shared by create + edit. Throws
 *  {@link AdminError} on the first violation. */
function validatePolicyFields(fields: {
  categoryId: string | null;
  limitAmount: number | null;
  currency: string;
  receiptRequiredAbove: number;
  justificationRequiredAbove: number;
  effectiveDate: string;
}) {
  if (!fields.categoryId) {
    throw new AdminError(400, "validation", "Policy category_id is required");
  }
  if (fields.limitAmount == null || fields.limitAmount <= 0) {
    throw new AdminError(400, "validation", "Policy limit amount must be greater than 0");
  }
  if (!CURRENCIES.includes(fields.currency as Currency)) {
    throw new AdminError(
      400,
      "validation",
      `Currency must be one of: ${CURRENCIES.join(", ")}`
    );
  }
  if (fields.receiptRequiredAbove > fields.limitAmount) {
    throw new AdminError(
      400,
      "validation",
      "receipt_required_above must not exceed the policy limit"
    );
  }
  if (fields.justificationRequiredAbove > fields.limitAmount) {
    throw new AdminError(
      400,
      "validation",
      "justification_required_above must not exceed the policy limit"
    );
  }
  if (!ISO_DATE_RE.test(fields.effectiveDate)) {
    throw new AdminError(400, "validation", "effective_date must be an ISO date (YYYY-MM-DD)");
  }
}

export function addPolicy(db: DB, actorId: string, input: PolicyInput): PolicyRow {
  const name = input.name?.trim();
  if (!name) throw new AdminError(400, "validation", "Policy name is required");
  const fields = {
    categoryId: input.categoryId ?? null,
    limitAmount: input.limitAmount ?? null,
    currency: input.currency,
    receiptRequiredAbove: input.receiptRequiredAbove ?? 0,
    justificationRequiredAbove: input.justificationRequiredAbove ?? 0,
    effectiveDate: input.effectiveDate,
  };
  validatePolicyFields(fields);

  const now = new Date();
  const id = newId("pol");
  db.insert(policiesTable)
    .values({
      id,
      name,
      description: input.description ?? "",
      categoryId: fields.categoryId,
      limitAmount: fields.limitAmount,
      period: input.period ?? "per_item",
      currency: fields.currency,
      receiptRequired: input.receiptRequired ?? false,
      receiptRequiredAbove: fields.receiptRequiredAbove,
      justificationRequiredAbove: fields.justificationRequiredAbove,
      effectiveDate: fields.effectiveDate,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = toPolicyRow(loadPolicyOrFail(db, id));
  writeAudit(db, {
    actorId,
    action: "policy.create",
    entityType: "policy",
    entityId: id,
    after: row,
  });
  return row;
}

export type PolicyEditInput = Partial<PolicyInput>;

/**
 * Edit a policy in place. Because policies are effective-dated, editing an
 * existing row's `effective_date` (or any threshold) never rewrites history:
 * `listActivePolicies(db, asOfIso)` (config.ts) filters by
 * `effective_date <= asOfIso`, and claims are evaluated against the policy
 * snapshot in force at *their own* submission date — already-submitted claims
 * were evaluated against a policy snapshot captured at submit time
 * (`policy_exception`/`policy_flag`), so a later edit here cannot retroactively
 * change a past decision.
 */
export function editPolicy(
  db: DB,
  actorId: string,
  id: string,
  input: PolicyEditInput
): PolicyRow {
  const before = toPolicyRow(loadPolicyOrFail(db, id));
  const name = input.name !== undefined ? input.name.trim() : before.name;
  if (!name) throw new AdminError(400, "validation", "Policy name is required");
  const fields = {
    categoryId: input.categoryId !== undefined ? input.categoryId : before.categoryId,
    limitAmount: input.limitAmount !== undefined ? input.limitAmount : before.limitAmount,
    currency: input.currency !== undefined ? input.currency : before.currency,
    receiptRequiredAbove:
      input.receiptRequiredAbove !== undefined
        ? input.receiptRequiredAbove
        : before.receiptRequiredAbove,
    justificationRequiredAbove:
      input.justificationRequiredAbove !== undefined
        ? input.justificationRequiredAbove
        : before.justificationRequiredAbove,
    effectiveDate: input.effectiveDate !== undefined ? input.effectiveDate : before.effectiveDate,
  };
  validatePolicyFields(fields);

  const now = new Date();
  db.update(policiesTable)
    .set({
      name,
      description: input.description !== undefined ? input.description : before.description,
      categoryId: fields.categoryId,
      limitAmount: fields.limitAmount,
      period: input.period ?? before.period,
      currency: fields.currency,
      receiptRequired:
        input.receiptRequired !== undefined ? input.receiptRequired : before.receiptRequired,
      receiptRequiredAbove: fields.receiptRequiredAbove,
      justificationRequiredAbove: fields.justificationRequiredAbove,
      effectiveDate: fields.effectiveDate,
      updatedAt: now,
    })
    .where(eq(policiesTable.id, id))
    .run();
  const after = toPolicyRow(loadPolicyOrFail(db, id));
  writeAudit(db, {
    actorId,
    action: "policy.update",
    entityType: "policy",
    entityId: id,
    before,
    after,
  });
  return after;
}

/** Soft delete — sets `active = false`. Claims already submitted keep the
 *  policy snapshot they were evaluated against; only future lookups stop
 *  seeing this policy. */
export function deactivatePolicy(db: DB, actorId: string, id: string): PolicyRow {
  const before = toPolicyRow(loadPolicyOrFail(db, id));
  if (!before.active) return before;
  const now = new Date();
  db.update(policiesTable)
    .set({ active: false, updatedAt: now })
    .where(eq(policiesTable.id, id))
    .run();
  const after = toPolicyRow(loadPolicyOrFail(db, id));
  writeAudit(db, {
    actorId,
    action: "policy.deactivate",
    entityType: "policy",
    entityId: id,
    before: { active: before.active },
    after: { active: false },
  });
  return after;
}

/** Pure: is this policy in force on the given ISO date? Mirrors the
 *  `effective_date <= asOfIso` lexicographic comparison `config.ts` uses. */
export function policyEffectiveOn(
  policy: Pick<PolicyRow, "active" | "effectiveDate">,
  asOfIso: string
): boolean {
  return policy.active && policy.effectiveDate <= asOfIso;
}

/**
 * Pure: pick the policy snapshot in force for `categoryId` on `asOfIso` from
 * a candidate list (active + inactive rows all fair game — inactivity is
 * just another form of "not effective"). Category-scoped policies win over a
 * global (`categoryId: null`) policy; ties broken by the latest
 * `effective_date` (the most recent change in force on that date).
 */
export function activePolicyFor(
  categoryId: string | null,
  asOfIso: string,
  policies: PolicyRow[]
): PolicyRow | null {
  const inForce = policies.filter((p) => policyEffectiveOn(p, asOfIso));
  const scoped = inForce.filter((p) => p.categoryId === categoryId);
  const candidates = scoped.length > 0 ? scoped : inForce.filter((p) => p.categoryId === null);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, p) =>
    p.effectiveDate > latest.effectiveDate ? p : latest
  );
}

/* ========================================================================= */
/* Approval routes + steps                                                   */
/* ========================================================================= */

export interface RouteStepInput {
  approverType: ApproverType;
  approverId?: string | null;
  label: string;
}

export interface RouteStepRow extends RouteStepInput {
  id: string;
  orderIndex: number;
}

export interface RouteRow {
  id: string;
  name: string;
  matchMinAmount: number | null;
  matchMaxAmount: number | null;
  matchCategoryId: string | null;
  matchDepartment: string | null;
  isFallback: boolean;
  active: boolean;
  steps: RouteStepRow[];
  createdAt: Date;
  updatedAt: Date;
}

function validateSteps(steps: RouteStepInput[] | undefined): RouteStepInput[] {
  if (!steps || steps.length === 0) {
    throw new AdminError(400, "invalid_steps", "A route must have at least 1 step");
  }
  for (const step of steps) {
    if (!APPROVER_TYPES.includes(step.approverType)) {
      throw new AdminError(
        400,
        "invalid_steps",
        `approver_type must be one of: ${APPROVER_TYPES.join(", ")}`
      );
    }
    if (step.approverType === "specific_user" && !step.approverId) {
      throw new AdminError(
        400,
        "invalid_steps",
        "approver_id is required when approver_type is specific_user"
      );
    }
    if (!step.label?.trim()) {
      throw new AdminError(400, "invalid_steps", "Each step needs a label");
    }
  }
  return steps;
}

function validateMatchRange(minAmount: number | null, maxAmount: number | null) {
  if (minAmount != null && maxAmount != null && minAmount > maxAmount) {
    throw new AdminError(400, "validation", "match_min_amount must not exceed match_max_amount");
  }
}

function loadRouteRow(db: DB, id: string): RouteRow | null {
  const row = db.select().from(approvalRoutesTable).where(eq(approvalRoutesTable.id, id)).get();
  if (!row) return null;
  const steps = db
    .select()
    .from(approvalStepsTable)
    .where(eq(approvalStepsTable.routeId, id))
    .orderBy(asc(approvalStepsTable.orderIndex))
    .all()
    .map((s) => ({
      id: s.id,
      orderIndex: s.orderIndex,
      approverType: s.approverType,
      approverId: s.approverId,
      label: s.label,
    }));
  return {
    id: row.id,
    name: row.name,
    matchMinAmount: row.matchMinAmount,
    matchMaxAmount: row.matchMaxAmount,
    matchCategoryId: row.matchCategoryId,
    matchDepartment: row.matchDepartment,
    isFallback: row.isFallback,
    active: row.active,
    steps,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function loadRouteOrFail(db: DB, id: string): RouteRow {
  const row = loadRouteRow(db, id);
  if (!row) throw new AdminError(404, "not_found", `Approval route ${id} not found`);
  return row;
}

/** All routes (active + inactive) with their ordered steps — admin view. */
export function listRoutes(db: DB): RouteRow[] {
  return db
    .select({ id: approvalRoutesTable.id })
    .from(approvalRoutesTable)
    .orderBy(asc(approvalRoutesTable.createdAt))
    .all()
    .map((r) => loadRouteOrFail(db, r.id));
}

export interface RouteInput {
  name: string;
  matchMinAmount?: number | null;
  matchMaxAmount?: number | null;
  matchCategoryId?: string | null;
  matchDepartment?: string | null;
  isFallback?: boolean;
  steps: RouteStepInput[];
}

export function addRoute(db: DB, actorId: string, input: RouteInput): RouteRow {
  const name = input.name?.trim();
  if (!name) throw new AdminError(400, "validation", "Route name is required");
  const minAmount = input.matchMinAmount ?? null;
  const maxAmount = input.matchMaxAmount ?? null;
  validateMatchRange(minAmount, maxAmount);
  const steps = validateSteps(input.steps);

  return db.transaction((tx) => {
    const now = new Date();
    const id = newId("rt");
    tx.insert(approvalRoutesTable)
      .values({
        id,
        name,
        matchMinAmount: minAmount,
        matchMaxAmount: maxAmount,
        matchCategoryId: input.matchCategoryId ?? null,
        matchDepartment: input.matchDepartment ?? null,
        isFallback: input.isFallback ?? false,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    steps.forEach((s, i) => {
      tx.insert(approvalStepsTable)
        .values({
          id: newId("step"),
          routeId: id,
          orderIndex: i,
          approverType: s.approverType,
          approverId: s.approverId ?? null,
          label: s.label,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
    const row = loadRouteOrFail(tx, id);
    writeAudit(tx, {
      actorId,
      action: "route.create",
      entityType: "approval_route",
      entityId: id,
      after: row,
    });
    return row;
  });
}

export type RouteEditInput = Partial<Omit<RouteInput, "steps">> & { steps?: RouteStepInput[] };

/**
 * Edit a route's match criteria and/or replace its step set. Only touches
 * `approval_routes`/`approval_steps` — never `approval_actions` — so an
 * already-routed claim's decision history is untouched; a replaced step id
 * only nulls out `approval_actions.step_id` (schema `onDelete: set null`),
 * leaving the claim/actor/action/comment/timestamp of each past decision
 * intact.
 */
export function editRoute(
  db: DB,
  actorId: string,
  id: string,
  input: RouteEditInput
): RouteRow {
  const before = loadRouteOrFail(db, id);
  const name = input.name !== undefined ? input.name.trim() : before.name;
  if (!name) throw new AdminError(400, "validation", "Route name is required");
  const minAmount = input.matchMinAmount !== undefined ? input.matchMinAmount : before.matchMinAmount;
  const maxAmount = input.matchMaxAmount !== undefined ? input.matchMaxAmount : before.matchMaxAmount;
  validateMatchRange(minAmount, maxAmount);
  const steps = input.steps !== undefined ? validateSteps(input.steps) : null;

  return db.transaction((tx) => {
    const now = new Date();
    tx.update(approvalRoutesTable)
      .set({
        name,
        matchMinAmount: minAmount,
        matchMaxAmount: maxAmount,
        matchCategoryId:
          input.matchCategoryId !== undefined ? input.matchCategoryId : before.matchCategoryId,
        matchDepartment:
          input.matchDepartment !== undefined ? input.matchDepartment : before.matchDepartment,
        isFallback: input.isFallback !== undefined ? input.isFallback : before.isFallback,
        updatedAt: now,
      })
      .where(eq(approvalRoutesTable.id, id))
      .run();

    if (steps) {
      tx.delete(approvalStepsTable).where(eq(approvalStepsTable.routeId, id)).run();
      steps.forEach((s, i) => {
        tx.insert(approvalStepsTable)
          .values({
            id: newId("step"),
            routeId: id,
            orderIndex: i,
            approverType: s.approverType,
            approverId: s.approverId ?? null,
            label: s.label,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
    }

    const after = loadRouteOrFail(tx, id);
    writeAudit(tx, {
      actorId,
      action: "route.update",
      entityType: "approval_route",
      entityId: id,
      before,
      after,
    });
    return after;
  });
}

/** Reorder a route's existing steps. `orderedStepIds` must be exactly the
 *  route's current step ids, in the new desired order. */
export function reorderRouteSteps(
  db: DB,
  actorId: string,
  routeId: string,
  orderedStepIds: string[]
): RouteRow {
  const before = loadRouteOrFail(db, routeId);
  const currentIds = new Set(before.steps.map((s) => s.id));
  if (
    orderedStepIds.length !== before.steps.length ||
    !orderedStepIds.every((id) => currentIds.has(id)) ||
    new Set(orderedStepIds).size !== orderedStepIds.length
  ) {
    throw new AdminError(
      400,
      "invalid_steps",
      "orderedStepIds must contain exactly the route's current step ids, each once"
    );
  }

  return db.transaction((tx) => {
    const now = new Date();
    orderedStepIds.forEach((stepId, i) => {
      tx.update(approvalStepsTable)
        .set({ orderIndex: i, updatedAt: now })
        .where(eq(approvalStepsTable.id, stepId))
        .run();
    });
    tx.update(approvalRoutesTable)
      .set({ updatedAt: now })
      .where(eq(approvalRoutesTable.id, routeId))
      .run();
    const after = loadRouteOrFail(tx, routeId);
    writeAudit(tx, {
      actorId,
      action: "route.reorder",
      entityType: "approval_route",
      entityId: routeId,
      before: { stepIds: before.steps.map((s) => s.id) },
      after: { stepIds: orderedStepIds },
    });
    return after;
  });
}

/** Soft delete — sets `active = false`. Routes/steps are never removed, so a
 *  claim's `approval_route_id` (and its resolved step history in
 *  `approval_actions`) keeps resolving after deactivation. */
export function deactivateRoute(db: DB, actorId: string, id: string): RouteRow {
  const before = loadRouteOrFail(db, id);
  if (!before.active) return before;
  const now = new Date();
  db.update(approvalRoutesTable)
    .set({ active: false, updatedAt: now })
    .where(eq(approvalRoutesTable.id, id))
    .run();
  const after = loadRouteOrFail(db, id);
  writeAudit(db, {
    actorId,
    action: "route.deactivate",
    entityType: "approval_route",
    entityId: id,
    before: { active: before.active },
    after: { active: false },
  });
  return after;
}

function toRouteConfig(route: RouteRow): ApprovalRouteConfig {
  const steps: RoutingStep[] = route.steps.map((s) => ({
    id: s.id,
    approverType: s.approverType,
    approverId: s.approverId,
    label: s.label,
    orderIndex: s.orderIndex,
  }));
  return {
    id: route.id,
    name: route.name,
    active: route.active,
    isFallback: route.isFallback,
    match: {
      minAmount: route.matchMinAmount,
      maxAmount: route.matchMaxAmount,
      categoryId: route.matchCategoryId,
      department: route.matchDepartment,
    },
    steps,
  };
}

/**
 * Pure: the most specific active route matching `claim`, falling back to the
 * active fallback route when no specific route matches. Reuses the single
 * matching algorithm the claim-submission path relies on
 * (`services/approval-engine.ts`, #12) rather than a second implementation,
 * so admin previews and live routing can never disagree. Returns `null`
 * instead of throwing when configuration is incomplete (no match + no
 * fallback, or a matched route with no steps) — an admin preview needs to
 * report "unroutable", not crash.
 */
export function matchRouteForClaim(
  claim: RouteClaimInput,
  routes: RouteRow[]
): { route: RouteRow; steps: RoutingStep[]; isFallback: boolean } | null {
  const configs = routes.map(toRouteConfig);
  try {
    const { route, steps } = resolveApprovalRoute(claim, configs);
    const full = routes.find((r) => r.id === route.id)!;
    return { route: full, steps, isFallback: route.isFallback };
  } catch (err) {
    if (err instanceof RoutingError) return null;
    throw err;
  }
}

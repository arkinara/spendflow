/* ============================================================================
 * SpendFlow — claimStore domain service (ticket #11).
 *
 * Backs claim creation/edit/submit/withdraw/resubmit lifecycle. All mutations
 * are scoped to the owning employee and only allowed while the claim is in a
 * mutable status (Draft, or Action Required for resubmit). Mileage amounts are
 * computed server-side from distance × category rate; the client amount is
 * never trusted for mileage categories. Submission resolves the approval
 * route via the shared engine and stamps non-blocking policy warnings.
 * ========================================================================== */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  approvalActionsTable,
  approvalStepsTable,
  categoriesTable,
  claimLineItemsTable,
  claimsTable,
  paymentsTable,
  usersTable,
  type ApprovalAction,
  type ClaimStatus,
} from "../db/schema.js";
import type { DB } from "../db/index.js";
import { writeAudit } from "./audit.js";
import { writeNotification } from "./notifications.js";
import { parseRoles } from "./roles.js";
import {
  evaluateClaim,
  type ClaimPolicySummary,
  type PolicyWarning,
} from "./policy.js";
import { resolveApprovalRoute, RoutingError, type RoutingStep } from "./approval-engine.js";
import {
  listActiveCategories,
  listActivePolicies,
  loadApprovalRoutes,
} from "./config.js";
import { decorateClaimWithSla, type SlaSummary } from "./sla.js";
import {
  dispatchClaimEvent,
  getWebhookConfig,
  webhookHistory,
  type ClaimEvent,
  type ClaimEventKind,
} from "./webhook.js";

export class ClaimError extends Error {
  constructor(
    public status: number,
    public code:
      | "not_found"
      | "forbidden"
      | "wrong_status"
      | "no_line_items"
      | "invalid_line"
      | "unknown_category"
      | "routing_failed"
      | "not_blocked"
      | "still_blocked"
      | "invalid_manager"
      | "invalid_approver"
      | "invalid_step",
    message: string
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

/**
 * Segregation-of-duties violation (ticket #46). Thrown by `resolveRouteSteps`
 * when a route step would resolve to the submitter (self-approval) or to null
 * (no manager on a submitter_manager step). Caught inside `applySubmission`,
 * which lands the claim in `blocked_sod` instead of `pending`. Status 409 is
 * surfaced only if the error escapes the submit flow (defence in depth).
 */
export class SoDError extends Error {
  public status = 409;
  constructor(
    public code: "self_approval" | "no_manager",
    message: string
  ) {
    super(message);
    this.name = "SoDError";
  }
}

/* ----------------------------------------------------------- public types -- */

export interface LineItemInput {
  id?: string;
  categoryId: string;
  description?: string;
  date: string;
  amount?: number;
  currency?: string;
  /** Distance (km) for mileage categories — drives server-side computation. */
  quantity?: number;
  unitLabel?: string;
  note?: string;
}

export interface CreateClaimInput {
  title: string;
  purpose?: string;
  currency?: string;
  tripStart?: string;
  tripEnd?: string;
  destination?: string;
  lineItems?: LineItemInput[];
}

export interface UpdateClaimInput {
  title?: string;
  purpose?: string;
  currency?: string;
  tripStart?: string | null;
  tripEnd?: string | null;
  destination?: string | null;
}

export interface ClaimLineItemRow {
  id: string;
  claimId: string;
  categoryId: string;
  description: string;
  date: string;
  amount: number;
  currency: string;
  quantity: number | null;
  unitLabel: string | null;
  unitRate: number | null;
  hasReceipt: boolean;
  note: string | null;
  policyFlag: PolicyWarning[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimRow {
  id: string;
  reference: string;
  title: string;
  purpose: string;
  employeeId: string;
  status: ClaimStatus;
  currency: string;
  tripStart: string | null;
  tripEnd: string | null;
  destination: string | null;
  approvalRouteId: string | null;
  currentStepIndex: number;
  policyException: ClaimPolicySummary | null;
  blockedReason: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lineItems: ClaimLineItemRow[];
  /** #74: SLA bucket + age in current state; stamped by every listing. */
  sla?: SlaSummary;
}

export interface SubmitResult {
  claim: ClaimRow;
  warnings: PolicyWarning[];
  summary: ClaimPolicySummary | null;
}

/* ------------------------------------------------------------- internals -- */

const MILEAGE_CATEGORY_ID = "mileage";

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Next human-readable reference, e.g. "EXP-2026-1004". */
function nextReference(db: DB): string {
  const year = new Date().getFullYear();
  const count = db
    .select({ id: claimsTable.id })
    .from(claimsTable)
    .all().length;
  // 1001 offset matches the seeded fixtures so new claims read naturally.
  const seq = (1001 + count).toString().padStart(4, "0");
  return `EXP-${year}-${seq}`;
}

function loadClaimRow(db: DB, id: string) {
  const row = db
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.id, id))
    .get();
  return row;
}

export function loadClaimOrThrow(db: DB, id: string) {
  const row = loadClaimRow(db, id);
  if (!row) throw new ClaimError(404, "not_found", `Claim ${id} not found`);
  return row;
}

export function toClaimRow(
  db: DB,
  row: typeof claimsTable.$inferSelect
): ClaimRow {
  const lines = db
    .select()
    .from(claimLineItemsTable)
    .where(eq(claimLineItemsTable.claimId, row.id))
    .orderBy(asc(claimLineItemsTable.createdAt))
    .all()
    .map((l) => ({
      id: l.id,
      claimId: l.claimId,
      categoryId: l.categoryId,
      description: l.description,
      date: l.date,
      amount: l.amount,
      currency: l.currency,
      quantity: l.quantity,
      unitLabel: l.unitLabel,
      unitRate: l.unitRate,
      hasReceipt: l.hasReceipt,
      note: l.note,
      policyFlag: l.policyFlag ? (JSON.parse(l.policyFlag) as PolicyWarning[]) : null,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    purpose: row.purpose,
    employeeId: row.employeeId,
    status: row.status,
    currency: row.currency,
    tripStart: row.tripStart,
    tripEnd: row.tripEnd,
    destination: row.destination,
    approvalRouteId: row.approvalRouteId,
    currentStepIndex: row.currentStepIndex,
    policyException: row.policyException
      ? (JSON.parse(row.policyException) as ClaimPolicySummary)
      : null,
    blockedReason: row.blockedReason ?? null,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lineItems: lines,
  };
}

function assertOwnedBy(
  row: typeof claimsTable.$inferSelect,
  employeeId: string
) {
  if (row.employeeId !== employeeId) {
    throw new ClaimError(
      403,
      "forbidden",
      "You do not own this claim"
    );
  }
}

function assertStatus(
  row: typeof claimsTable.$inferSelect,
  allowed: ClaimStatus[]
) {
  if (!allowed.includes(row.status)) {
    throw new ClaimError(
      409,
      "wrong_status",
      `Claim is ${row.status}; expected ${allowed.join(" or ")}`
    );
  }
}

/**
 * Resolve the server-side amount for a line item. Mileage categories compute
 * amount from `quantity × category.mileage_rate`; the client-supplied amount
 * is ignored for mileage. Non-mileage categories honour the client amount.
 */
function resolveLineAmount(
  db: DB,
  line: LineItemInput
): { amount: number; quantity: number | null; unitLabel: string | null; unitRate: number | null } {
  const category = db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.id, line.categoryId))
    .get();
  if (!category) {
    throw new ClaimError(
      400,
      "unknown_category",
      `Category ${line.categoryId} does not exist`
    );
  }

  if (category.id === MILEAGE_CATEGORY_ID || category.mileageRate != null) {
    const quantity = line.quantity;
    if (quantity == null || quantity < 0) {
      throw new ClaimError(
        400,
        "invalid_line",
        "Mileage line items require a non-negative quantity (distance in km)"
      );
    }
    const rate = category.mileageRate ?? 0;
    return {
      amount: quantity * rate,
      quantity,
      unitLabel: line.unitLabel ?? "km",
      unitRate: rate,
    };
  }

  const amount = line.amount;
  if (amount == null || !Number.isFinite(amount) || amount < 0) {
    throw new ClaimError(
      400,
      "invalid_line",
      "Line items require a non-negative numeric amount"
    );
  }
  return { amount: Math.round(amount), quantity: line.quantity ?? null, unitLabel: line.unitLabel ?? null, unitRate: null };
}

function validateLine(line: LineItemInput) {
  if (!line.categoryId || typeof line.categoryId !== "string") {
    throw new ClaimError(400, "invalid_line", "Each line item requires a category");
  }
  if (!line.date || typeof line.date !== "string") {
    throw new ClaimError(400, "invalid_line", "Each line item requires a date");
  }
}

function recordAction(
  db: DB,
  args: {
    claimId: string;
    actorId: string;
    action: ApprovalAction;
    stepId?: string | null;
    comment?: string | null;
  }
) {
  db.insert(approvalActionsTable)
    .values({
      id: newId("act"),
      claimId: args.claimId,
      stepId: args.stepId ?? null,
      actorId: args.actorId,
      action: args.action,
      comment: args.comment ?? null,
      createdAt: new Date(),
    })
    .run();
}

/* ----------------------------------------------------- webhook fan-out (#75) */

/**
 * #75 — best-effort Slack/Teams fan-out for a claim lifecycle event. Invoked
 * OUTSIDE the write transaction so a webhook failure can never roll back a
 * real claim change. No-op when neither webhook URL is configured. The
 * attempt (delivered or failed) is recorded to `webhook-history.log` and a
 * `claim.webhook_dispatched` audit row so the audit timeline reflects the
 * dispatcher's outcome. Never throws — every failure is captured.
 */
async function fireClaimWebhook(
  db: DB,
  args: {
    kind: ClaimEventKind;
    claimId: string;
    reference: string;
    employeeId: string;
    actorId: string;
    amount?: number;
    currency?: string;
  }
): Promise<void> {
  const cfg = getWebhookConfig();
  if (!cfg.slackWebhookUrl && !cfg.teamsWebhookUrl) return;
  const employee = db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, args.employeeId))
    .get();
  const actor = db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, args.actorId))
    .get();
  const evt: ClaimEvent = {
    kind: args.kind,
    claimId: args.claimId,
    reference: args.reference,
    employeeName: employee?.name ?? args.employeeId,
    amount: args.amount,
    currency: args.currency,
    actorName: actor?.name ?? args.actorId,
    occurredAt: new Date().toISOString(),
  };
  let delivered = false;
  let lastError: string | null = null;
  let attempts = 0;
  try {
    const result = await dispatchClaimEvent(cfg, evt);
    delivered = result.delivered.slack || result.delivered.teams;
    lastError = result.errors.slack ?? result.errors.teams ?? null;
    attempts =
      (cfg.slackWebhookUrl ? 1 : 0) + (cfg.teamsWebhookUrl ? 1 : 0);
  } catch (err) {
    lastError = err instanceof Error ? err.message : "dispatch error";
  }
  try {
    webhookHistory.record(undefined, {
      kind: evt.kind,
      claimId: evt.claimId,
      delivered,
      attempts,
      lastError,
    });
    writeAudit(db, {
      actorId: args.actorId,
      action: "claim.webhook_dispatched",
      entityType: "claim",
      entityId: args.claimId,
      before: null,
      after: { kind: evt.kind, delivered, lastError },
    });
  } catch {
    // best-effort — webhook history / audit must never break the claim mutation
  }
}

/* --------------------------------------------------------------- create ---- */

/**
 * Create a Draft claim owned by `employeeId`, optionally with initial line
 * items. Mileage line items have their amount computed server-side.
 */
export function createClaim(
  db: DB,
  employeeId: string,
  input: CreateClaimInput
): ClaimRow {
  if (!input.title?.trim()) {
    throw new ClaimError(400, "invalid_line", "Claim title is required");
  }
  const now = new Date();
  const id = newId("clm");
  const reference = nextReference(db);

  const lineRows: Array<{
    id: string;
    categoryId: string;
    description: string;
    date: string;
    amount: number;
    currency: string;
    quantity: number | null;
    unitLabel: string | null;
    unitRate: number | null;
  }> = [];

  for (const line of input.lineItems ?? []) {
    validateLine(line);
    const resolved = resolveLineAmount(db, line);
    lineRows.push({
      id: line.id ?? newId("li"),
      categoryId: line.categoryId,
      description: line.description ?? "",
      date: line.date,
      amount: resolved.amount,
      currency: line.currency ?? "IDR",
      quantity: resolved.quantity,
      unitLabel: resolved.unitLabel,
      unitRate: resolved.unitRate,
    });
  }

  db.transaction((tx) => {
    tx.insert(claimsTable)
      .values({
        id,
        reference,
        title: input.title.trim(),
        purpose: input.purpose?.trim() ?? "",
        employeeId,
        status: "draft",
        currency: input.currency ?? "IDR",
        tripStart: input.tripStart ?? null,
        tripEnd: input.tripEnd ?? null,
        destination: input.destination ?? null,
        approvalRouteId: null,
        currentStepIndex: 0,
        policyException: null,
        submittedAt: null,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const l of lineRows) {
      tx.insert(claimLineItemsTable)
        .values({
          id: l.id,
          claimId: id,
          categoryId: l.categoryId,
          description: l.description,
          date: l.date,
          amount: l.amount,
          currency: l.currency,
          quantity: l.quantity,
          unitLabel: l.unitLabel,
          unitRate: l.unitRate,
          hasReceipt: false,
          note: null,
          policyFlag: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    tx.insert(approvalActionsTable)
      .values({
        id: newId("act"),
        claimId: id,
        stepId: null,
        actorId: employeeId,
        action: "created",
        comment: null,
        createdAt: now,
      })
      .run();
  });

  const row = loadClaimOrThrow(db, id);
  return toClaimRow(db, row);
}

/* ----------------------------------------------------------------- get ---- */

/** Load a claim with its line items. Ownership/visibility is checked upstream. */
export function getClaim(db: DB, id: string): ClaimRow | null {
  const row = loadClaimRow(db, id);
  return row ? toClaimRow(db, row) : null;
}

/** Load + assert ownership (for employee self-service mutations). */
export function getOwnedClaim(
  db: DB,
  id: string,
  employeeId: string
): ClaimRow {
  const row = loadClaimOrThrow(db, id);
  assertOwnedBy(row, employeeId);
  return toClaimRow(db, row);
}

/* ----------------------------------------------------------------- edit ---- */

/** Edit a Draft claim's top-level fields (title/purpose/dates/etc). */
export function updateClaim(
  db: DB,
  id: string,
  employeeId: string,
  patch: UpdateClaimInput
): ClaimRow {
  const row = loadClaimOrThrow(db, id);
  assertOwnedBy(row, employeeId);
  assertStatus(row, ["draft", "action_required"]);
  const updates: Partial<typeof claimsTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.title != null) {
    if (!patch.title.trim()) {
      throw new ClaimError(400, "invalid_line", "Claim title cannot be empty");
    }
    updates.title = patch.title.trim();
  }
  if (patch.purpose != null) updates.purpose = patch.purpose.trim();
  if (patch.currency != null) updates.currency = patch.currency;
  if (patch.tripStart !== undefined) updates.tripStart = patch.tripStart ?? null;
  if (patch.tripEnd !== undefined) updates.tripEnd = patch.tripEnd ?? null;
  if (patch.destination !== undefined) updates.destination = patch.destination ?? null;
  db.update(claimsTable).set(updates).where(eq(claimsTable.id, id)).run();
  return toClaimRow(db, loadClaimOrThrow(db, id));
}

/** Add a line item to a Draft/Action Required claim. */
export function addLineItem(
  db: DB,
  claimId: string,
  employeeId: string,
  line: LineItemInput
): ClaimLineItemRow {
  const row = loadClaimOrThrow(db, claimId);
  assertOwnedBy(row, employeeId);
  assertStatus(row, ["draft", "action_required"]);
  validateLine(line);
  const resolved = resolveLineAmount(db, line);
  const id = line.id ?? newId("li");
  const now = new Date();
  db.insert(claimLineItemsTable)
    .values({
      id,
      claimId,
      categoryId: line.categoryId,
      description: line.description ?? "",
      date: line.date,
      amount: resolved.amount,
      currency: line.currency ?? row.currency,
      quantity: resolved.quantity,
      unitLabel: resolved.unitLabel,
      unitRate: resolved.unitRate,
      hasReceipt: false,
      note: line.note ?? null,
      policyFlag: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return toClaimRow(db, loadClaimOrThrow(db, claimId)).lineItems.find(
    (l) => l.id === id
  )!;
}

/** Edit an existing line item (Draft/Action Required only). */
export function updateLineItem(
  db: DB,
  claimId: string,
  lineId: string,
  employeeId: string,
  patch: Partial<LineItemInput> & { categoryId: string; date: string }
): ClaimLineItemRow {
  const row = loadClaimOrThrow(db, claimId);
  assertOwnedBy(row, employeeId);
  assertStatus(row, ["draft", "action_required"]);
  const existing = db
    .select()
    .from(claimLineItemsTable)
    .where(
      and(
        eq(claimLineItemsTable.id, lineId),
        eq(claimLineItemsTable.claimId, claimId)
      )
    )
    .get();
  if (!existing) {
    throw new ClaimError(404, "not_found", `Line item ${lineId} not found`);
  }
  const merged: LineItemInput = {
    categoryId: patch.categoryId,
    description: patch.description ?? existing.description,
    date: patch.date,
    quantity: patch.quantity ?? existing.quantity ?? undefined,
    unitLabel: patch.unitLabel ?? existing.unitLabel ?? undefined,
    note: patch.note ?? existing.note ?? undefined,
    currency: patch.currency ?? existing.currency,
  };
  const resolved = resolveLineAmount(db, merged);
  const now = new Date();
  db.update(claimLineItemsTable)
    .set({
      categoryId: merged.categoryId,
      description: merged.description ?? "",
      date: merged.date,
      amount: resolved.amount,
      currency: merged.currency ?? row.currency,
      quantity: resolved.quantity,
      unitLabel: resolved.unitLabel,
      unitRate: resolved.unitRate,
      note: merged.note ?? null,
      // Editing a line invalidates any previously-stamped policy flag; it will
      // be recomputed on next submit.
      policyFlag: null,
      updatedAt: now,
    })
    .where(eq(claimLineItemsTable.id, lineId))
    .run();
  return toClaimRow(db, loadClaimOrThrow(db, claimId)).lineItems.find(
    (l) => l.id === lineId
  )!;
}

/** Remove a line item (Draft/Action Required only). */
export function removeLineItem(
  db: DB,
  claimId: string,
  lineId: string,
  employeeId: string
): void {
  const row = loadClaimOrThrow(db, claimId);
  assertOwnedBy(row, employeeId);
  assertStatus(row, ["draft", "action_required"]);
  db.delete(claimLineItemsTable)
    .where(
      and(
        eq(claimLineItemsTable.id, lineId),
        eq(claimLineItemsTable.claimId, claimId)
      )
    )
    .run();
}

/* ------------------------------------------------------- submit/resubmit -- */

/**
 * Walk a resolved route's ordered steps and resolve each to a concrete
 * `approverId`, enforcing segregation-of-duties (#46):
 *  - `specific_user` → `step.approverId`; if it equals the submitter, throw
 *    `SoDError("self_approval")`.
 *  - `submitter_manager` → `submitter.managerId`; if `null`, throw
 *    `SoDError("no_manager")`; if it equals the submitter (defence in depth —
 *    the UI self-manager guard should already prevent this), throw
 *    `self_approval`.
 *  - `finance` → any active finance admin; the step is group-routed, so SoD
 *    fires only when the submitter is the sole finance user (no one else can
 *    action it). Otherwise the first non-submitter finance user is picked.
 *
 * Returns the steps with `resolvedApproverId` attached. Throws on the first
 * conflicting step; multi-step conflicts are not aggregated.
 */
export function resolveRouteSteps(
  db: DB,
  steps: RoutingStep[],
  submitter: { id: string; managerId: string | null }
): Array<RoutingStep & { resolvedApproverId: string | null }> {
  const out: Array<RoutingStep & { resolvedApproverId: string | null }> = [];
  for (const step of steps) {
    let resolvedApproverId: string | null = null;
    if (step.approverType === "specific_user") {
      resolvedApproverId = step.approverId ?? null;
    } else if (step.approverType === "submitter_manager") {
      resolvedApproverId = submitter.managerId;
      if (resolvedApproverId === null) {
        throw new SoDError(
          "no_manager",
          `Submitter has no manager; cannot route step "${step.label}"`
        );
      }
    } else if (step.approverType === "finance") {
      const others = db
        .select()
        .from(usersTable)
        .all()
        .filter(
          (u) =>
            parseRoles(u.roles).includes("finance") &&
            u.status === "active" &&
            u.id !== submitter.id
        );
      if (others.length === 0) {
        throw new SoDError(
          "self_approval",
          `Step "${step.label}" routes to the submitter (sole finance admin)`
        );
      }
      resolvedApproverId = others[0].id;
    }
    if (resolvedApproverId === submitter.id) {
      throw new SoDError(
        "self_approval",
        `Step "${step.label}" routes to the submitter`
      );
    }
    out.push({ ...step, resolvedApproverId });
  }
  return out;
}

function buildPolicyInputs(claim: ClaimRow) {
  return claim.lineItems.map((l) => ({
    id: l.id,
    categoryId: l.categoryId,
    amount: l.amount,
    currency: l.currency,
    hasAttachment: l.hasReceipt,
  }));
}

/**
 * Core submission: validate, compute policy warnings, resolve the approval
 * route, transition to Pending Approval, and stamp the resolved route + step
 * 0. Reused by submit (draft → pending) and resubmit (action_required → pending).
 *
 * All writes happen in a single transaction; policy flags are overwritten on
 * every (re)submit so duplicate flags can never accumulate (idempotent).
 */
function applySubmission(
  db: DB,
  claim: ClaimRow,
  employeeId: string,
  actionLabel: ApprovalAction
): SubmitResult {
  if (claim.lineItems.length === 0) {
    throw new ClaimError(
      400,
      "no_line_items",
      "A claim must have at least one line item before submission"
    );
  }

  const asOfIso = new Date().toISOString().slice(0, 10);
  const policies = listActivePolicies(db, asOfIso);
  const categories = listActiveCategories(db);
  const { warnings, summary } = evaluateClaim(
    buildPolicyInputs(claim),
    policies,
    claim.currency,
    categories
  );

  // Resolve route against the claim's current totals + the employee's dept.
  const employee = db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, employeeId))
    .get();
  const routes = loadApprovalRoutes(db);
  let routeMatch;
  try {
    routeMatch = resolveApprovalRoute(
      {
        totalAmount: claim.lineItems.reduce((s, l) => s + l.amount, 0),
        categoryIds: Array.from(
          new Set(claim.lineItems.map((l) => l.categoryId))
        ),
        department: employee?.department ?? null,
      },
      routes
    );
  } catch (err) {
    if (err instanceof RoutingError) {
      throw new ClaimError(503, "routing_failed", err.message);
    }
    throw err;
  }

  // Segregation-of-duties check (#46): walk the resolved steps and reject any
  // that would land at the submitter's own desk (or can't resolve at all). On
  // conflict the claim is written as `blocked_sod` instead of `pending`.
  let sodBlock: SoDError | null = null;
  try {
    resolveRouteSteps(db, routeMatch.steps, {
      id: employeeId,
      managerId: employee?.managerId ?? null,
    });
  } catch (err) {
    if (err instanceof SoDError) {
      sodBlock = err;
    } else {
      throw err;
    }
  }

  const now = new Date();
  const warningsByLine = new Map<string, PolicyWarning[]>();
  for (const w of warnings) {
    const list = warningsByLine.get(w.lineId) ?? [];
    list.push(w);
    warningsByLine.set(w.lineId, list);
  }

  db.transaction((tx) => {
    if (sodBlock) {
      tx.update(claimsTable)
        .set({
          status: "blocked_sod",
          approvalRouteId: routeMatch.route.id,
          currentStepIndex: 0,
          policyException: summary ? JSON.stringify(summary) : null,
          blockedReason: sodBlock.message,
          submittedAt: now,
          decidedAt: null,
          updatedAt: now,
        })
        .where(eq(claimsTable.id, claim.id))
        .run();
    } else {
      tx.update(claimsTable)
        .set({
          status: "pending",
          approvalRouteId: routeMatch.route.id,
          currentStepIndex: 0,
          policyException: summary ? JSON.stringify(summary) : null,
          submittedAt: now,
          decidedAt: null,
          updatedAt: now,
        })
        .where(eq(claimsTable.id, claim.id))
        .run();
    }

    // Overwrite (idempotent) policy flags per line.
    for (const line of claim.lineItems) {
      const ws = warningsByLine.get(line.id) ?? null;
      tx.update(claimLineItemsTable)
        .set({
          policyFlag: ws ? JSON.stringify(ws) : null,
          updatedAt: now,
        })
        .where(eq(claimLineItemsTable.id, line.id))
        .run();
    }

    tx.insert(approvalActionsTable)
      .values({
        id: newId("act"),
        claimId: claim.id,
        stepId: routeMatch.steps[0]?.id ?? null,
        actorId: employeeId,
        action: actionLabel,
        comment: null,
        createdAt: now,
      })
      .run();

    if (sodBlock) {
      writeAudit(tx, {
        actorId: employeeId,
        action: "claim.blocked_sod",
        entityType: "claim",
        entityId: claim.id,
        before: { status: claim.status },
        after: {
          status: "blocked_sod",
          routeId: routeMatch.route.id,
          code: sodBlock.code,
          reason: sodBlock.message,
        },
      });
    } else {
      writeAudit(tx, {
        actorId: employeeId,
        action: `claim.${actionLabel}`,
        entityType: "claim",
        entityId: claim.id,
        before: { status: claim.status },
        after: { status: "pending", routeId: routeMatch.route.id },
      });

      // Notify the first-step approver (resolved best-effort: manager /
      // specific user / every finance user). Non-blocking if the approver
      // can't resolve. Skipped when the claim is blocked (no live step).
      notifyFirstApprover(tx, claim, routeMatch.steps[0], employee?.managerId ?? null);
    }
  });

  // #75 — fire claim.submitted webhook OUTSIDE the write tx, only on the
  // non-blocked path (blocked_sod claims don't appear in the kind list).
  if (!sodBlock) {
    void fireClaimWebhook(db, {
      kind: "claim.submitted",
      claimId: claim.id,
      reference: claim.reference,
      employeeId,
      actorId: employeeId,
      amount: claim.lineItems.reduce((s, l) => s + l.amount, 0),
      currency: claim.currency,
    });
  }

  return {
    claim: toClaimRow(db, loadClaimOrThrow(db, claim.id)),
    warnings,
    summary,
  };
}

function notifyFirstApprover(
  db: DB,
  claim: ClaimRow,
  step: { approverType: string; approverId?: string | null } | undefined,
  employeeManagerId: string | null
) {
  if (!step) return;
  const title = `Claim ${claim.reference} submitted for approval`;
  const body = `"${claim.title}" is awaiting your review.`;
  if (step.approverType === "submitter_manager" && employeeManagerId) {
    writeNotification(db, {
      recipientId: employeeManagerId,
      category: "approval",
      title,
      body,
      claimId: claim.id,
    });
  } else if (step.approverType === "specific_user" && step.approverId) {
    writeNotification(db, {
      recipientId: step.approverId,
      category: "approval",
      title,
      body,
      claimId: claim.id,
    });
  } else if (step.approverType === "finance") {
    const financeUsers = db
      .select()
      .from(usersTable)
      .all()
      .filter((u) => parseRoles(u.roles).includes("finance"));
    for (const fu of financeUsers) {
      writeNotification(db, {
        recipientId: fu.id,
        category: "approval",
        title,
        body,
        claimId: claim.id,
      });
    }
  }
}

/** Submit a Draft claim for approval. */
export function submitClaim(
  db: DB,
  id: string,
  employeeId: string
): SubmitResult {
  const row = loadClaimOrThrow(db, id);
  assertOwnedBy(row, employeeId);
  assertStatus(row, ["draft"]);
  return applySubmission(db, toClaimRow(db, row), employeeId, "submitted");
}

/**
 * Resubmit a claim that was returned (Action Required). Re-runs validation,
 * policy evaluation, and route resolution; transitions back to Pending.
 */
export function resubmitClaim(
  db: DB,
  id: string,
  employeeId: string
): SubmitResult {
  const row = loadClaimOrThrow(db, id);
  assertOwnedBy(row, employeeId);
  assertStatus(row, ["action_required"]);
  return applySubmission(db, toClaimRow(db, row), employeeId, "resubmitted");
}

/* ----------------------------------------------------- finance unblock (#48) */

export interface UnblockInput {
  resolution: string;
  action: "assign_manager" | "reassign_step";
  managerId?: string;
  stepId?: string;
  newApproverId?: string;
}

/**
 * Resolve a `blocked_sod` claim (#46) by reassigning the route so it no longer
 * violates segregation of duties, then returning the claim to `pending`.
 *
 * Two actions:
 *  - `assign_manager`: stamp a new `managerId` on the submitter (unblocks a
 *    `no_manager` route) and re-resolve. The change persists on the user.
 *  - `reassign_step`: repoint a specific step's `approverId` to a new approver
 *    (unblocks a `self_approval` step) and re-resolve. The change persists on
 *    the route (see honest caveat in #48 — a copy-on-unblock is out of scope).
 *
 * Defence in depth: after mutating, the full route is re-resolved through
 * {@link resolveRouteSteps}. If the new assignment still trips SoD (e.g.
 * Finance picks themselves), the mutation is rolled back (the transaction
 * re-throws as a `still_blocked` ClaimError) and the claim stays blocked.
 *
 * `financeId` is the Finance Admin actor (audit). `body.resolution` is a
 * required free-text justification recorded on the audit entry.
 */
export function unblockClaim(
  db: DB,
  claimId: string,
  financeId: string,
  body: UnblockInput
): { claim: ClaimRow } {
  const row = loadClaimOrThrow(db, claimId);
  if (row.status !== "blocked_sod") {
    throw new ClaimError(
      409,
      "not_blocked",
      `Claim is ${row.status}; cannot unblock (expected blocked_sod)`
    );
  }

  const submitter = db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, row.employeeId))
    .get();
  if (!submitter) {
    throw new ClaimError(404, "not_found", `Submitter for claim ${claimId} not found`);
  }

  // Steps the claim was submitted against — the reassign_step action patches
  // one of these in place.
  const routeSteps = db
    .select()
    .from(approvalStepsTable)
    .where(eq(approvalStepsTable.routeId, row.approvalRouteId!))
    .orderBy(asc(approvalStepsTable.orderIndex))
    .all();

  // Validate the action's references before touching any state so a bad id
  // never leaves a half-applied mutation.
  let newManagerId: string | null = null;
  let stepToReassign: (typeof approvalStepsTable.$inferSelect) | null = null;
  let newApproverId: string | null = null;

  if (body.action === "assign_manager") {
    const manager = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, body.managerId!))
      .get();
    if (
      !manager ||
      manager.status !== "active" ||
      !parseRoles(manager.roles).includes("approver")
    ) {
      throw new ClaimError(
        404,
        "invalid_manager",
        `Manager ${body.managerId} is not an active approver`
      );
    }
    newManagerId = body.managerId!;
  } else {
    stepToReassign = routeSteps.find((s) => s.id === body.stepId) ?? null;
    if (!stepToReassign) {
      throw new ClaimError(
        404,
        "invalid_step",
        `Step ${body.stepId} is not on this claim's route`
      );
    }
    const approver = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, body.newApproverId!))
      .get();
    if (
      !approver ||
      approver.status !== "active" ||
      !parseRoles(approver.roles).includes("approver")
    ) {
      throw new ClaimError(
        404,
        "invalid_approver",
        `Approver ${body.newApproverId} is not an active approver`
      );
    }
    newApproverId = body.newApproverId!;
  }

  const now = new Date();

  db.transaction((tx) => {
    // Apply the reassignment inside the tx so a SoD re-trigger rolls it back.
    if (body.action === "assign_manager") {
      tx.update(usersTable)
        .set({ managerId: newManagerId, updatedAt: now })
        .where(eq(usersTable.id, submitter.id))
        .run();
    } else {
      tx.update(approvalStepsTable)
        .set({ approverId: newApproverId!, updatedAt: now })
        .where(eq(approvalStepsTable.id, stepToReassign!.id))
        .run();
    }

    // Reflect the mutation in the step view the SoD check walks, so a
    // still-conflicting assignment (self-approval, etc.) is caught here.
    const routingSteps: RoutingStep[] = routeSteps.map((s) => ({
      id: s.id,
      approverType: s.approverType,
      approverId:
        body.action === "reassign_step" && s.id === stepToReassign!.id
          ? newApproverId
          : s.approverId,
      label: s.label,
      orderIndex: s.orderIndex,
    }));
    const resolvedSubmitter = {
      id: submitter.id,
      managerId:
        body.action === "assign_manager" ? newManagerId! : submitter.managerId,
    };

    try {
      resolveRouteSteps(tx, routingSteps, resolvedSubmitter);
    } catch (err) {
      if (err instanceof SoDError) {
        // Re-throw as a typed ClaimError: the transaction rolls back the
        // managerId / approverId mutation AND the HTTP layer maps it to 409.
        throw new ClaimError(409, "still_blocked", err.message);
      }
      throw err;
    }

    // Success: return the claim to pending and clear the SoD block.
    tx.update(claimsTable)
      .set({
        status: "pending",
        currentStepIndex: 0,
        blockedReason: null,
        submittedAt: now,
        decidedAt: null,
        updatedAt: now,
      })
      .where(eq(claimsTable.id, claimId))
      .run();

    writeAudit(tx, {
      actorId: financeId,
      action: "claim.unblocked",
      entityType: "claim",
      entityId: claimId,
      before: {
        status: "blocked_sod",
        blocked_reason: row.blockedReason,
      },
      after: {
        status: "pending",
        resolution: body.resolution,
        action: body.action,
        routeId: row.approvalRouteId,
        ...(body.action === "assign_manager"
          ? { managerId: newManagerId }
          : { stepId: body.stepId, newApproverId }),
      },
    });

    // Notify the new first-step approver so the re-routed claim surfaces in
    // their inbox immediately (mirrors the submit path).
    const updatedRow = tx
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, claimId))
      .get()!;
    notifyFirstApprover(
      tx,
      toClaimRow(tx, updatedRow),
      routingSteps[0],
      body.action === "assign_manager" ? newManagerId : submitter.managerId
    );
  });

  // #75 — fire claim.unblocked webhook OUTSIDE the write tx.
  void fireClaimWebhook(db, {
    kind: "claim.unblocked",
    claimId,
    reference: row.reference,
    employeeId: row.employeeId,
    actorId: financeId,
    currency: row.currency,
  });

  return { claim: toClaimRow(db, loadClaimOrThrow(db, claimId)) };
}

/* ----------------------------------------------------------- withdraw ---- */

/**
 * Withdraw a Pending claim back to Action Required (employee pulls it from the
 * approver's queue to fix something). Records the lifecycle action.
 */
export function withdrawClaim(
  db: DB,
  id: string,
  employeeId: string,
  comment?: string
): ClaimRow {
  const row = loadClaimOrThrow(db, id);
  assertOwnedBy(row, employeeId);
  assertStatus(row, ["pending"]);
  const now = new Date();
  db.transaction((tx) => {
    tx.update(claimsTable)
      .set({
        status: "action_required",
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(claimsTable.id, id))
      .run();
    recordAction(tx, {
      claimId: id,
      actorId: employeeId,
      action: "withdrawn",
      comment: comment ?? null,
    });
    writeAudit(tx, {
      actorId: employeeId,
      action: "claim.withdrawn",
      entityType: "claim",
      entityId: id,
      before: { status: "pending" },
      after: { status: "action_required" },
    });
  });
  return toClaimRow(db, loadClaimOrThrow(db, id));
}

/* --------------------------------------------------------- delete claim -- */

/** Permanently delete a Draft claim (and its line items via cascade). */
export function deleteClaim(db: DB, id: string, employeeId: string): void {
  const row = loadClaimOrThrow(db, id);
  assertOwnedBy(row, employeeId);
  assertStatus(row, ["draft"]);
  db.delete(claimsTable).where(eq(claimsTable.id, id)).run();
}

/* --------------------------------------------------------- list / inbox -- */

/** Claims owned by an employee, newest first. Each row carries an SLA summary (#74). */
export function listClaimsForEmployee(
  db: DB,
  employeeId: string,
  filter?: { status?: ClaimStatus[] }
): ClaimRow[] {
  const rows = db
    .select()
    .from(claimsTable)
    .where(
      filter?.status?.length
        ? and(
            eq(claimsTable.employeeId, employeeId),
            inArray(claimsTable.status, filter.status)
          )
        : eq(claimsTable.employeeId, employeeId)
    )
    .orderBy(desc(claimsTable.createdAt))
    .all();
  return rows.map((r) => decorateClaimWithSla(toClaimRow(db, r)));
}

/* ----------------------------------------------------- bulk ops (#73) ---- */

/**
 * Bulk operations on claims (#73). Three batch entry points share a common
 * shape (`BulkResult`) and a common execution model:
 *
 *  1. Pre-validate every claim in the batch (load row, status check, step
 *     check) BEFORE opening the write transaction. Any per-claim failure is
 *     collected into `failed[]` with a typed code.
 *  2. If any failure was collected, return `{ processed: [], failed }` — no
 *     row is ever mutated, the whole batch is atomic.
 *  3. Otherwise open a single write transaction, apply every mutation, write
 *     per-claim audit + notification, commit. Returns `{ processed: claimIds,
 *     failed: [] }`.
 *
 * The actor's password is verified by the route layer through
 * `requirePasswordReauth` (#64) BEFORE the service runs; the service only
 * takes `actorId` for audit stamping.
 *
 * Per-claim failure codes (surfaced verbatim to the FE):
 *   - `not_found`        — claim id does not exist
 *   - `not_at_your_step` — bulk approve only; current step is not a Finance step
 *   - `wrong_status`     — claim is not in the status the operation expects
 *   - `not_approved`     — bulk pay only; claim is not `approved`
 *
 * `BulkClaimError` is for batch-level validation (empty batch, too many ids,
 * missing comment/reference). It bubbles up to a 400 through the route layer.
 */
export interface BulkApproveInput {
  claimIds: string[];
  password: string;
}
export interface BulkRejectInput {
  claimIds: string[];
  password: string;
  comment: string;
}
export interface BulkPayInput {
  claimIds: string[];
  password: string;
  paymentMethod: "bank_transfer" | "payroll";
  reference: string;
}

export interface BulkResult {
  processed: string[];
  failed: { claimId: string; code: string; message: string }[];
}

export class BulkClaimError extends Error {
  public status = 400;
  constructor(
    public code: "empty_batch" | "too_many" | "invalid_input",
    message: string
  ) {
    super(message);
    this.name = "BulkClaimError";
  }
}

/** Cap a single bulk batch at 100 claim ids so the write tx stays short. */
export const BULK_BATCH_MAX = 100;

function assertBulkBatch(claimIds: unknown): asserts claimIds is string[] {
  if (!Array.isArray(claimIds) || claimIds.length === 0) {
    throw new BulkClaimError(
      "empty_batch",
      "Bulk operation requires at least one claim id"
    );
  }
  if (claimIds.length > BULK_BATCH_MAX) {
    throw new BulkClaimError(
      "too_many",
      `Bulk operation accepts at most ${BULK_BATCH_MAX} claims per batch`
    );
  }
  for (const id of claimIds) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new BulkClaimError(
        "invalid_input",
        "Every claim id must be a non-empty string"
      );
    }
  }
}

/** Load the ordered steps of a claim's resolved route (empty if no route). */
function loadRouteSteps(db: DB, routeId: string | null) {
  if (!routeId) return [];
  return db
    .select()
    .from(approvalStepsTable)
    .where(eq(approvalStepsTable.routeId, routeId))
    .orderBy(asc(approvalStepsTable.orderIndex))
    .all();
}

/**
 * Bulk approve (#73). Every claim must be `pending` and currently sitting at
 * a `finance`-routed step (finance is the only bulk-approve actor). Each
 * surviving claim is advanced to its next step, or finalised to `approved`
 * if the finance step was the last one.
 *
 * Atomic per batch: any per-claim validation failure rolls back the whole
 * batch with no row touched.
 */
export function bulkApprove(
  db: DB,
  actorId: string,
  input: BulkApproveInput
): BulkResult {
  assertBulkBatch(input.claimIds);

  const failed: BulkResult["failed"] = [];
  type Plan = {
    row: typeof claimsTable.$inferSelect;
    currentStep: typeof approvalStepsTable.$inferSelect;
    isFinal: boolean;
  };
  const plan: Plan[] = [];

  for (const claimId of input.claimIds) {
    const row = db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, claimId))
      .get();
    if (!row) {
      failed.push({ claimId, code: "not_found", message: `Claim ${claimId} not found` });
      continue;
    }
    if (row.status !== "pending") {
      failed.push({
        claimId,
        code: "wrong_status",
        message: `Claim is ${row.status}; expected pending`,
      });
      continue;
    }
    const steps = loadRouteSteps(db, row.approvalRouteId);
    const currentStep = steps[row.currentStepIndex];
    if (!currentStep) {
      failed.push({
        claimId,
        code: "not_at_your_step",
        message: "Claim has no current approval step",
      });
      continue;
    }
    // Bulk approve is Finance-only: the step must route to the finance group.
    if (currentStep.approverType !== "finance") {
      failed.push({
        claimId,
        code: "not_at_your_step",
        message: `Claim is at step "${currentStep.label}" — not at a Finance step`,
      });
      continue;
    }
    plan.push({
      row,
      currentStep,
      isFinal: row.currentStepIndex >= steps.length - 1,
    });
  }

  if (failed.length > 0) return { processed: [], failed };

  const now = new Date();
  const processed: string[] = [];
  db.transaction((tx) => {
    for (const p of plan) {
      if (p.isFinal) {
        tx.update(claimsTable)
          .set({ status: "approved", decidedAt: now, updatedAt: now })
          .where(eq(claimsTable.id, p.row.id))
          .run();
        tx.insert(approvalActionsTable)
          .values({
            id: `act-${crypto.randomUUID()}`,
            claimId: p.row.id,
            stepId: p.currentStep.id,
            actorId,
            action: "approved",
            comment: null,
            createdAt: now,
          })
          .run();
        writeAudit(tx, {
          actorId,
          action: "claim.approved.final",
          entityType: "claim",
          entityId: p.row.id,
          before: { status: "pending", step: p.row.currentStepIndex },
          after: { status: "approved", bulk: true },
        });
      } else {
        const nextIndex = p.row.currentStepIndex + 1;
        tx.update(claimsTable)
          .set({ currentStepIndex: nextIndex, updatedAt: now })
          .where(eq(claimsTable.id, p.row.id))
          .run();
        tx.insert(approvalActionsTable)
          .values({
            id: `act-${crypto.randomUUID()}`,
            claimId: p.row.id,
            stepId: p.currentStep.id,
            actorId,
            action: "approved",
            comment: null,
            createdAt: now,
          })
          .run();
        writeAudit(tx, {
          actorId,
          action: "claim.approved.advance",
          entityType: "claim",
          entityId: p.row.id,
          before: { step: p.row.currentStepIndex },
          after: { step: nextIndex, bulk: true },
        });
      }
      processed.push(p.row.id);
    }
  });

  return { processed, failed: [] };
}

/**
 * Bulk reject (#73). Every claim must be `pending`; each is returned to the
 * employee as `action_required` with the shared `comment` (≥ 10 chars)
 * stamped on the audit + notification + approval_actions row.
 *
 * Atomic per batch: any per-claim failure rolls back the whole batch.
 */
export function bulkReject(
  db: DB,
  actorId: string,
  input: BulkRejectInput
): BulkResult {
  assertBulkBatch(input.claimIds);
  const comment = input.comment?.trim();
  if (!comment || comment.length < 10) {
    throw new BulkClaimError(
      "invalid_input",
      "A comment of at least 10 characters is required for bulk reject"
    );
  }

  const failed: BulkResult["failed"] = [];
  type Plan = { row: typeof claimsTable.$inferSelect; stepId: string | null };
  const plan: Plan[] = [];

  for (const claimId of input.claimIds) {
    const row = db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, claimId))
      .get();
    if (!row) {
      failed.push({ claimId, code: "not_found", message: `Claim ${claimId} not found` });
      continue;
    }
    if (row.status !== "pending") {
      failed.push({
        claimId,
        code: "wrong_status",
        message: `Claim is ${row.status}; expected pending`,
      });
      continue;
    }
    const steps = loadRouteSteps(db, row.approvalRouteId);
    const stepId = steps[row.currentStepIndex]?.id ?? null;
    plan.push({ row, stepId });
  }

  if (failed.length > 0) return { processed: [], failed };

  const now = new Date();
  const processed: string[] = [];
  db.transaction((tx) => {
    for (const p of plan) {
      tx.update(claimsTable)
        .set({ status: "action_required", decidedAt: now, updatedAt: now })
        .where(eq(claimsTable.id, p.row.id))
        .run();
      tx.insert(approvalActionsTable)
        .values({
          id: `act-${crypto.randomUUID()}`,
          claimId: p.row.id,
          stepId: p.stepId,
          actorId,
          action: "returned",
          comment,
          createdAt: now,
        })
        .run();
      writeAudit(tx, {
        actorId,
        action: "claim.bulk_returned",
        entityType: "claim",
        entityId: p.row.id,
        before: { status: "pending" },
        after: { status: "action_required", comment, bulk: true },
      });
      writeNotification(tx, {
        recipientId: p.row.employeeId,
        category: "action",
        title: `Claim ${p.row.reference} returned by Finance`,
        body: comment,
        claimId: p.row.id,
      });
      processed.push(p.row.id);
    }
  });

  return { processed, failed: [] };
}

/**
 * Bulk pay (#73). Every claim must be `approved`; each is moved directly to
 * `paid` (skipping the intermediate `processing` state since the bulk path
 * captures method + reference up front and finalises immediately). A
 * `payments` row is inserted per claim with `status: "paid"`, processed-by/at
 * stamped in the same write.
 *
 * Atomic per batch: any per-claim failure rolls back the whole batch.
 */
export function bulkPay(
  db: DB,
  actorId: string,
  input: BulkPayInput
): BulkResult {
  assertBulkBatch(input.claimIds);
  if (input.paymentMethod !== "bank_transfer" && input.paymentMethod !== "payroll") {
    throw new BulkClaimError(
      "invalid_input",
      "paymentMethod must be one of bank_transfer | payroll"
    );
  }
  const reference = input.reference?.trim();
  if (!reference) {
    throw new BulkClaimError(
      "invalid_input",
      "A reference number is required for bulk pay"
    );
  }

  const failed: BulkResult["failed"] = [];
  type Plan = { row: typeof claimsTable.$inferSelect; total: number };
  const plan: Plan[] = [];

  for (const claimId of input.claimIds) {
    const row = db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, claimId))
      .get();
    if (!row) {
      failed.push({ claimId, code: "not_found", message: `Claim ${claimId} not found` });
      continue;
    }
    if (row.status !== "approved") {
      failed.push({
        claimId,
        code: "not_approved",
        message: `Claim is ${row.status}; expected approved`,
      });
      continue;
    }
    const lines = db
      .select({ amount: claimLineItemsTable.amount })
      .from(claimLineItemsTable)
      .where(eq(claimLineItemsTable.claimId, claimId))
      .all();
    const total = lines.reduce((s, l) => s + l.amount, 0);
    plan.push({ row, total });
  }

  if (failed.length > 0) return { processed: [], failed };

  const now = new Date();
  const processed: string[] = [];
  db.transaction((tx) => {
    for (const p of plan) {
      tx.insert(paymentsTable)
        .values({
          id: `pay-${crypto.randomUUID()}`,
          claimId: p.row.id,
          method: input.paymentMethod,
          referenceNumber: reference,
          amount: p.total,
          currency: p.row.currency,
          status: "paid",
          processedBy: actorId,
          processedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.update(claimsTable)
        .set({ status: "paid", updatedAt: now })
        .where(eq(claimsTable.id, p.row.id))
        .run();
      writeAudit(tx, {
        actorId,
        action: "claim.bulk_paid",
        entityType: "claim",
        entityId: p.row.id,
        before: { status: "approved" },
        after: {
          status: "paid",
          method: input.paymentMethod,
          referenceNumber: reference,
          bulk: true,
        },
      });
      writeNotification(tx, {
        recipientId: p.row.employeeId,
        category: "payment",
        title: `Claim ${p.row.reference} has been paid`,
        body: `Your reimbursement for "${p.row.title}" has been paid (bulk batch).`,
        claimId: p.row.id,
      });
      processed.push(p.row.id);
    }
  });

  // #75 — fire claim.bulk_paid webhook per processed claim, OUTSIDE the tx.
  for (const p of plan) {
    void fireClaimWebhook(db, {
      kind: "claim.bulk_paid",
      claimId: p.row.id,
      reference: p.row.reference,
      employeeId: p.row.employeeId,
      actorId,
      amount: p.total,
      currency: p.row.currency,
    });
  }

  return { processed, failed: [] };
}

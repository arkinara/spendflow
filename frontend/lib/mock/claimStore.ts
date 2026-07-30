/* ============================================================================
   SpendFlow — In-memory claim store (Phase 1, mock persistence).
   "Persists" a submitted claim by inserting it into the live mock `claims`
   array so every selector (getClaim, claimsForEmployee, dashboard) reflects it
   immediately. Generates ids/references, builds line items + attachments, and
   stamps the approval timeline + any policy exception.
   ========================================================================== */

import {
  claims,
  comments,
  pushNotification,
  computeClaimTotal,
  getUser,
  getUserName,
  routingStepsForClaim,
  type Claim,
  type LineItem,
  type Attachment,
  type ExpenseCategoryId,
  type ClaimStatus,
} from "@/lib/mock/mock_data";
import type { CurrencyCode } from "@/lib/format";
import type { UploadedFile } from "@/components/ui/FileUpload";

export interface ClaimLineInput {
  categoryId: ExpenseCategoryId;
  description: string;
  date: string;
  amount: number;
  currency: CurrencyCode;
  merchant?: string;
  quantity?: number;
  unitLabel?: string;
  unitRate?: number;
  attachment?: UploadedFile;
}

export interface ClaimInput {
  employeeId: string;
  title: string;
  purpose: string;
  destination: string;
  tripStart: string;
  tripEnd: string;
  currency: CurrencyCode;
  lines: ClaimLineInput[];
  exception?: { type: "missing_receipt" | "over_policy"; message: string };
}

// Seeded above every existing fixture id/reference to stay collision-free.
let sequence = 2000;

function nextIds(): { id: string; reference: string } {
  sequence += 1;
  return { id: `clm-${sequence}`, reference: `EXP-2026-${sequence}` };
}

/**
 * Create, persist, and return a submitted claim. Throws on invalid input so
 * the submit hook can surface an explicit error state (never a silent drop).
 */
export function createClaim(input: ClaimInput): Claim {
  if (!input.employeeId) throw new Error("Claim is missing the employee.");
  if (!input.title.trim()) throw new Error("A claim title is required.");
  if (input.lines.length === 0) {
    throw new Error("At least one line item is required.");
  }

  const { id, reference } = nextIds();
  const now = new Date().toISOString();

  const lineItems: LineItem[] = input.lines.map((l, i) => ({
    id: `${id}-li-${i + 1}`,
    categoryId: l.categoryId,
    description: l.description,
    date: l.date,
    amount: l.amount,
    currency: l.currency,
    quantity: l.quantity,
    unitLabel: l.unitLabel,
    unitRate: l.unitRate,
    hasReceipt: !!l.attachment,
    note: l.merchant?.trim() ? `Merchant: ${l.merchant.trim()}` : undefined,
  }));

  const attachments: Attachment[] = input.lines
    .map((l, i) => ({ line: l, lineItemId: lineItems[i].id }))
    .filter(({ line }) => !!line.attachment)
    .map(({ line, lineItemId }, i) => ({
      id: `${id}-at-${i + 1}`,
      fileName: line.attachment!.fileName,
      sizeKb: line.attachment!.sizeKb,
      mimeType: line.attachment!.mimeType,
      lineItemId,
      uploadedAt: now,
    }));

  const status: ClaimStatus = "pending";

  const claim: Claim = {
    id,
    reference,
    title: input.title.trim(),
    purpose: input.purpose.trim(),
    employeeId: input.employeeId,
    status,
    currency: input.currency,
    createdAt: now,
    submittedAt: now,
    tripStart: input.tripStart || undefined,
    tripEnd: input.tripEnd || undefined,
    destination: input.destination.trim() || undefined,
    lineItems,
    attachments,
    approvals: [
      { id: `${id}-ap-1`, actorId: input.employeeId, action: "created", at: now },
      {
        id: `${id}-ap-2`,
        actorId: input.employeeId,
        action: "submitted",
        at: now,
        note: input.exception
          ? "Submitted with policy warnings — flagged for exception review."
          : "Submitted for approval.",
      },
    ],
    exception: input.exception
      ? {
          id: `${id}-exc-1`,
          type: input.exception.type,
          severity: input.exception.type === "missing_receipt" ? "high" : "medium",
          message: input.exception.message,
          flaggedAt: now,
          status: "open",
        }
      : undefined,
    // New claims enter the approval flow at step 0 (line manager).
    currentStepIndex: 0,
  };

  // Insert at the head so the freshly-submitted claim surfaces first in
  // history and dashboard selectors that read the live array.
  claims.unshift(claim);
  return claim;
}

/** Test/reset helper: remove a claim created during a test from the mock store. */
export function __removeClaim(id: string): void {
  const idx = claims.findIndex((c) => c.id === id);
  if (idx >= 0) claims.splice(idx, 1);
}

/**
 * Withdraw (delete) a draft claim owned by the employee. Mock-only: Phase 1 has
 * no persistence, so "withdraw" simply removes the claim from the live array.
 * Returns true if removed. Throws if the claim is missing, not a draft, or not
 * owned by the employee — the page surfaces that as an explicit error state.
 */
export function withdrawClaim(id: string, employeeId: string): boolean {
  const claim = claims.find((c) => c.id === id);
  if (!claim) throw new Error("That claim no longer exists.");
  if (claim.employeeId !== employeeId) throw new Error("Not allowed.");
  if (claim.status !== "draft") {
    throw new Error("Only draft claims can be withdrawn.");
  }
  __removeClaim(id);
  return true;
}

/**
 * Resubmit a claim that was returned (action_required) back into the approval
 * flow. Mutates the live store: clears the open exception, flips status to
 * pending, and stamps a `resubmitted` approval event so the status timeline
 * re-renders immediately with the new transition. Returns the updated claim.
 */
export function resubmitClaim(id: string, employeeId: string): Claim {
  const claim = claims.find((c) => c.id === id);
  if (!claim) throw new Error("That claim no longer exists.");
  if (claim.employeeId !== employeeId) throw new Error("Not allowed.");
  if (claim.status !== "action_required") {
    throw new Error("Only returned claims can be resubmitted.");
  }

  const now = new Date().toISOString();
  claim.status = "pending";
  claim.submittedAt = now;
  if (claim.exception && claim.exception.status === "open") {
    claim.exception = { ...claim.exception, status: "resolved" };
  }
  claim.approvals.push({
    id: `${claim.id}-ap-${claim.approvals.length + 1}`,
    actorId: employeeId,
    action: "resubmitted",
    at: now,
    note: "Resubmitted after addressing the reviewer's request.",
  });
  return claim;
}

/* ============================================================================
   Approver decisioning (Phase 1, mock).
   Each entry point mutates the live claim/comments/notifications arrays so the
   employee history, finance queue, and status timeline re-read the new state
   immediately. Throws with an explicit message when the action is invalid (a
   stale/already-decided claim, a missing required comment) so the caller can
   surface that as a conflict/validation error instead of a silent drop.
   ========================================================================== */

export type DecisionAction = "approve" | "reject" | "request_changes";

export interface DecisionInput {
  claimId: string;
  approverId: string;
  action: DecisionAction;
  /** Required for reject / request_changes; optional for approve. */
  note?: string;
}

export interface DecisionOutcome {
  claim: Claim;
  /** Whether the claim is now fully approved (no further approver steps). */
  finalised: boolean;
}

function assertActionable(claim: Claim | undefined, claimId: string): asserts claim is Claim {
  if (!claim) throw new Error("That claim no longer exists.");
  if (claim.status !== "pending") {
    throw new Error(
      "This claim has already been decided and is no longer awaiting your review."
    );
  }
  if ((claim.currentStepIndex ?? 0) !== 0) {
    throw new Error(
      "This claim has moved past your approval step and is no longer in your inbox."
    );
  }
}

/**
 * Apply an approver decision to a pending claim in the live store.
 *
 * - approve on the final routing step → status = approved, Finance notified.
 * - approve on a non-final step → advance currentStepIndex, claim stays pending
 *   but leaves the approver's inbox (now in Finance's court).
 * - reject → status = rejected; the employee is notified with the reason.
 * - request_changes → status = action_required (returned to the employee) with
 *   the requested note; the employee is notified.
 *
 * Reject and request_changes require a non-empty note. Approve accepts an
 * optional note that is recorded on the timeline.
 */
export function decideOnClaim(input: DecisionInput): DecisionOutcome {
  const claim = claims.find((c) => c.id === input.claimId);
  assertActionable(claim, input.claimId);

  const note = (input.note ?? "").trim();
  if (input.action !== "approve" && note.length === 0) {
    const label = input.action === "reject" ? "Reject" : "Request changes";
    throw new Error(
      `${label} requires a comment so the employee knows what to do.`
    );
  }

  const now = new Date().toISOString();
  const actorName = getUserName(input.approverId);
  const total = computeClaimTotal(claim);

  if (input.action === "approve") {
    const steps = routingStepsForClaim(claim);
    const nextStep = (claim.currentStepIndex ?? 0) + 1;
    if (nextStep < steps.length) {
      // Non-final step: advance to the next approver (mock Finance review).
      claim.currentStepIndex = nextStep;
      claim.approvals.push({
        id: `${claim.id}-ap-${claim.approvals.length + 1}`,
        actorId: input.approverId,
        action: "approved",
        at: now,
        note:
          note ||
          `Approved at ${steps[0]} — advanced to ${steps[nextStep]} for review.`,
      });
      pushNotification({
        audience: "finance",
        category: "approval",
        title: "Claim advanced to Finance review",
        body: `${actorName} approved ${claim.title} (${claim.reference}) and it is now awaiting your review.`,
        at: now,
        read: false,
        claimId: claim.id,
      });
      return { claim, finalised: false };
    }

    // Final step → fully approved, hand off to Finance for payment.
    claim.status = "approved";
    claim.decidedAt = now;
    claim.approvals.push({
      id: `${claim.id}-ap-${claim.approvals.length + 1}`,
      actorId: input.approverId,
      action: "approved",
      at: now,
      note: note || "Approved.",
    });
    pushNotification({
      audience: "finance",
      category: "approval",
      title: "Claim ready to pay",
      body: `${claim.title} (${claim.reference}) was approved by ${actorName} and is queued for payment (${Math.round(total).toLocaleString("id-ID")}).`,
      at: now,
      read: false,
      claimId: claim.id,
    });
    pushNotification({
      audience: "employee",
      category: "approval",
      title: "Claim approved",
      body: `${actorName} approved ${claim.title} (${claim.reference}). It is now with Finance for payment.`,
      at: now,
      read: false,
      claimId: claim.id,
    });
    return { claim, finalised: true };
  }

  if (input.action === "reject") {
    claim.status = "rejected";
    claim.decidedAt = now;
    if (claim.exception && claim.exception.status === "open") {
      claim.exception = { ...claim.exception, status: "resolved" };
    }
    claim.approvals.push({
      id: `${claim.id}-ap-${claim.approvals.length + 1}`,
      actorId: input.approverId,
      action: "rejected",
      at: now,
      note,
    });
    pushNotification({
      audience: "employee",
      category: "action",
      title: "Claim rejected",
      body: `${actorName} rejected ${claim.title} (${claim.reference}). ${note}`,
      at: now,
      read: false,
      claimId: claim.id,
    });
    return { claim, finalised: true };
  }

  // request_changes → return to the employee for edits.
  claim.status = "action_required";
  claim.decidedAt = now;
  claim.approvals.push({
    id: `${claim.id}-ap-${claim.approvals.length + 1}`,
    actorId: input.approverId,
    action: "returned",
    at: now,
    note,
  });
  pushNotification({
    audience: "employee",
    category: "action",
    title: "Changes requested",
    body: `${actorName} requested changes on ${claim.title} (${claim.reference}). ${note}`,
    at: now,
    read: false,
    claimId: claim.id,
  });
  return { claim, finalised: true };
}

let commentSeq = 9900;

export interface CommentInput {
  claimId: string;
  authorId: string;
  body: string;
}

/**
 * Post a comment on a claim into the live comments array. Independent of the
 * formal decision flow: it never changes the claim status or timeline, so the
 * approver can ask a clarifying question without deciding.
 */
export function addClaimComment(input: CommentInput) {
  const claim = claims.find((c) => c.id === input.claimId);
  if (!claim) throw new Error("That claim no longer exists.");
  const body = input.body.trim();
  if (!body) throw new Error("Comment cannot be empty.");
  const now = new Date().toISOString();
  const entry = {
    id: `cm-${++commentSeq}`,
    claimId: input.claimId,
    authorId: input.authorId,
    body,
    at: now,
  };
  comments.push(entry);
  return entry;
}

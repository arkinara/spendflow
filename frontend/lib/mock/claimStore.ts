/* ============================================================================
   SpendFlow — In-memory claim store (Phase 1, mock persistence).
   "Persists" a submitted claim by inserting it into the live mock `claims`
   array so every selector (getClaim, claimsForEmployee, dashboard) reflects it
   immediately. Generates ids/references, builds line items + attachments, and
   stamps the approval timeline + any policy exception.
   ========================================================================== */

import {
  claims,
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

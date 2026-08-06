/* ============================================================================
   SpendFlow — Pre-submit policy engine (Phase 1, mock rules).
   Pure evaluation of draft line items against the mock category & policy
   fixtures. Produces inline warnings; never blocks submission. The submit
   path carries any flagged line items forward as a ClaimException for
   downstream Finance review.
   ========================================================================== */

import { getCategory } from "@/lib/mock/mock_data";
import type { ExpenseCategoryId } from "@/lib/types";
import { formatCurrency, type CurrencyCode } from "@/lib/format";

export type PolicyType =
  | "missing_receipt"
  | "over_category_max"
  | "currency_mismatch";

export type PolicySeverity = "high" | "medium";

export interface PolicyViolation {
  lineId: string;
  type: PolicyType;
  severity: PolicySeverity;
  message: string;
}

export interface PolicyInputLine {
  id: string;
  categoryId: ExpenseCategoryId;
  amount: number;
  currency: CurrencyCode;
  hasAttachment: boolean;
}

/**
 * Evaluate a single draft line against the mock policy rules.
 * Rules (mock fixtures in mock_data.ts):
 *  - missing_receipt: amount above the category `receiptThreshold` with no
 *    attached receipt (mileage threshold is 0 so it never triggers).
 *  - over_category_max: amount above the category `perItemCap`, if defined.
 *  - currency_mismatch: line currency differs from the claim currency.
 */
export function evaluateLinePolicy(
  line: PolicyInputLine,
  claimCurrency: CurrencyCode
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const cat = getCategory(line.categoryId);
  if (!cat) return violations;

  if (
    cat.receiptThreshold > 0 &&
    line.amount > cat.receiptThreshold &&
    !line.hasAttachment
  ) {
    violations.push({
      lineId: line.id,
      type: "missing_receipt",
      severity: "high",
      message: `Receipt required above ${formatCurrency(
        cat.receiptThreshold
      )}. Attach one or this line will be flagged for review.`,
    });
  }

  if (cat.perItemCap && line.amount > cat.perItemCap) {
    violations.push({
      lineId: line.id,
      type: "over_category_max",
      severity: "medium",
      message: `Exceeds the ${cat.name} cap of ${formatCurrency(
        cat.perItemCap
      )}. Submitting flags this line for exception review.`,
    });
  }

  if (line.currency !== claimCurrency) {
    violations.push({
      lineId: line.id,
      type: "currency_mismatch",
      severity: "medium",
      message: `Currency ${line.currency} differs from the claim currency (${claimCurrency}).`,
    });
  }

  return violations;
}

/** Evaluate every line; preserves line order in output. */
export function evaluatePolicy(
  lines: PolicyInputLine[],
  claimCurrency: CurrencyCode
): PolicyViolation[] {
  return lines.flatMap((l) => evaluateLinePolicy(l, claimCurrency));
}

export function violationsForLine(
  violations: PolicyViolation[],
  lineId: string
): PolicyViolation[] {
  return violations.filter((v) => v.lineId === lineId);
}

/** Highest-severity summary used to derive the persisted ClaimException. */
export function deriveException(
  violations: PolicyViolation[]
): { type: "missing_receipt" | "over_policy"; message: string } | undefined {
  const hasMissingReceipt = violations.some((v) => v.type === "missing_receipt");
  const hasOverCap = violations.some((v) => v.type === "over_category_max");
  if (hasMissingReceipt) {
    return {
      type: "missing_receipt",
      message:
        "One or more line items above the receipt threshold were submitted without a receipt.",
    };
  }
  if (hasOverCap) {
    return {
      type: "over_policy",
      message:
        "One or more line items exceed the category cap and are flagged for exception review.",
    };
  }
  return undefined;
}

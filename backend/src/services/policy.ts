/* ============================================================================
 * SpendFlow — Policy evaluation engine (ticket #11).
 *
 * Pure module: takes line items + the active policy configuration and returns
 * a list of non-blocking warnings. The claim submission path calls this, then
 * persists the resulting warnings as `policy_flag` on each flagged line item
 * and as `policy_exception` on the claim. Warnings NEVER block submission —
 * they surface flagged lines for downstream exception review.
 *
 * Kept deliberately DB-free so Phase 2 (mobile) can reuse the exact same call
 * against the same inputs without duplicating the rules.
 * ========================================================================== */

export type PolicyWarningType =
  | "missing_receipt_above_threshold"
  | "over_category_max"
  | "currency_mismatch";

export type PolicySeverity = "high" | "medium";

export interface PolicyWarning {
  lineId: string;
  type: PolicyWarningType;
  severity: PolicySeverity;
  message: string;
  /** Policy id that triggered the warning, when applicable (audit/dedupe key). */
  policyId?: string;
}

/**
 * Normalised policy used by the engine. The caller (claimStore) loads rows
 * from the `policies` table and maps them into this shape; the engine never
 * touches the DB so it stays pure + reusable.
 */
export interface PolicyConfig {
  id: string;
  /** When set, the policy only applies to lines with this category. */
  categoryId?: string | null;
  /** Max reimbursable amount; exceeded → `over_category_max`. */
  limitAmount?: number | null;
  /** Amount at/above which a receipt becomes mandatory. */
  receiptRequiredAbove?: number | null;
  /** Whether a receipt is required at all for matching lines. */
  receiptRequired?: boolean | null;
  /** Amount at/above which a written justification is mandatory. */
  justificationRequiredAbove?: number | null;
}

/**
 * Optional category-level caps. Folded into the engine so a category's
 * `perItemCap` is enforced even when no explicit policy row covers it.
 */
export interface CategoryCap {
  id: string;
  name: string;
  perItemCap?: number | null;
  receiptThreshold?: number | null;
}

/** Minimal line shape the engine needs. */
export interface PolicyLineInput {
  id: string;
  categoryId: string;
  amount: number;
  currency: string;
  hasAttachment: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Evaluate a single line item against the supplied policies + category caps.
 *
 * Rules:
 *  - `missing_receipt_above_threshold`: a policy (or category receipt
 *    threshold) marks a receipt mandatory at/above an amount and the line
 *    has no attachment.
 *  - `over_category_max`: line amount exceeds a policy `limitAmount` (scoped
 *    to the line's category) or the category's `perItemCap`.
 *  - `currency_mismatch`: line currency differs from the claim currency.
 *
 * Warnings are deduplicated by `(type, policyId|categoryId)` so re-evaluating
 * the same line never produces duplicate entries (idempotent submission).
 */
export function evaluateLinePolicy(
  line: PolicyLineInput,
  policies: PolicyConfig[],
  claimCurrency: string,
  categories: CategoryCap[] = []
): PolicyWarning[] {
  const out: PolicyWarning[] = [];
  const seen = new Set<string>();
  const remember = (w: PolicyWarning) => {
    const key = `${w.type}:${w.policyId ?? w.lineId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(w);
  };

  // Category-level caps (independent of policy rows).
  const cat = categories.find((c) => c.id === line.categoryId);
  if (cat) {
    if (cat.perItemCap != null && line.amount > cat.perItemCap) {
      remember({
        lineId: line.id,
        type: "over_category_max",
        severity: "medium",
        message: `Exceeds the ${cat.name} cap of ${fmt(cat.perItemCap)}.`,
        policyId: `category:${cat.id}`,
      });
    }
    if (
      cat.receiptThreshold != null &&
      cat.receiptThreshold > 0 &&
      line.amount >= cat.receiptThreshold &&
      !line.hasAttachment
    ) {
      remember({
        lineId: line.id,
        type: "missing_receipt_above_threshold",
        severity: "high",
        message: `Receipt required at/above ${fmt(cat.receiptThreshold)} and none is attached.`,
        policyId: `category:${cat.id}`,
      });
    }
  }

  // Policy rows (category-scoped when categoryId is set, else global).
  for (const p of policies) {
    if (p.categoryId != null && p.categoryId !== line.categoryId) continue;

    if (
      p.receiptRequired &&
      p.receiptRequiredAbove != null &&
      line.amount >= p.receiptRequiredAbove &&
      !line.hasAttachment
    ) {
      remember({
        lineId: line.id,
        type: "missing_receipt_above_threshold",
        severity: "high",
        message: `Receipt required at/above ${fmt(p.receiptRequiredAbove)} (policy ${p.id}) and none is attached.`,
        policyId: p.id,
      });
    }

    if (p.limitAmount != null && line.amount > p.limitAmount) {
      remember({
        lineId: line.id,
        type: "over_category_max",
        severity: "medium",
        message: `Exceeds policy ${p.id} limit of ${fmt(p.limitAmount)}.`,
        policyId: p.id,
      });
    }
  }

  // Currency mismatch is claim-level, evaluated once per line independent of
  // any policy row.
  if (line.currency !== claimCurrency) {
    remember({
      lineId: line.id,
      type: "currency_mismatch",
      severity: "medium",
      message: `Line currency ${line.currency} differs from the claim currency (${claimCurrency}).`,
    });
  }

  return out;
}

/**
 * Evaluate every line of a claim and aggregate the warnings. Returns both the
 * flat list (keyed by line id) and a summary exception description used to
 * stamp `claims.policy_exception` at submission time.
 */
export function evaluateClaim(
  lines: PolicyLineInput[],
  policies: PolicyConfig[],
  claimCurrency: string,
  categories: CategoryCap[] = []
): { warnings: PolicyWarning[]; summary: ClaimPolicySummary | null } {
  const warnings: PolicyWarning[] = [];
  const byLine = new Map<string, PolicyWarning[]>();
  for (const line of lines) {
    const ws = evaluateLinePolicy(line, policies, claimCurrency, categories);
    if (ws.length) {
      warnings.push(...ws);
      byLine.set(line.id, ws);
    }
  }
  return { warnings, summary: deriveException(warnings) };
}

/** Highest-severity summary persisted onto the claim as `policy_exception`. */
export function deriveException(
  warnings: PolicyWarning[]
): ClaimPolicySummary | null {
  if (warnings.length === 0) return null;
  const types = new Set(warnings.map((w) => w.type));
  if (types.has("missing_receipt_above_threshold")) {
    return {
      type: "missing_receipt",
      severity: "high",
      message:
        "One or more line items above the receipt threshold were submitted without a receipt.",
      count: warnings.filter((w) => w.type === "missing_receipt_above_threshold").length,
    };
  }
  if (types.has("over_category_max")) {
    return {
      type: "over_policy",
      severity: "medium",
      message:
        "One or more line items exceed a configured category limit and are flagged for exception review.",
      count: warnings.filter((w) => w.type === "over_category_max").length,
    };
  }
  return {
    type: "currency_mismatch",
    severity: "medium",
    message: "One or more line items use a currency different from the claim.",
    count: warnings.filter((w) => w.type === "currency_mismatch").length,
  };
}

export interface ClaimPolicySummary {
  type: "missing_receipt" | "over_policy" | "currency_mismatch";
  severity: PolicySeverity;
  message: string;
  count: number;
}

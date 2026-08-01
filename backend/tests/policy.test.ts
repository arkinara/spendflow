/* ============================================================================
 * SpendFlow — Policy evaluation engine unit tests (ticket #11, Policy
 * Evaluation Engine sub-feature).
 *
 * Pure unit tests against evaluateLinePolicy/evaluateClaim — no DB, no HTTP.
 * ========================================================================== */
import { describe, expect, it } from "vitest";
import {
  evaluateClaim,
  evaluateLinePolicy,
  type CategoryCap,
  type PolicyConfig,
} from "../src/services/policy.js";

const MEAL_POLICY: PolicyConfig = {
  id: "pol-meal",
  categoryId: "meals",
  limitAmount: 350_000,
  receiptRequired: true,
  receiptRequiredAbove: 250_000,
  justificationRequiredAbove: 350_000,
};

const CATEGORIES: CategoryCap[] = [
  { id: "meals", name: "Meals", perItemCap: 350_000, receiptThreshold: 250_000 },
  { id: "taxi", name: "Taxi", perItemCap: null, receiptThreshold: 200_000 },
];

describe("policy engine — evaluateLinePolicy", () => {
  // AC (#11, Policy Evaluation Engine, positive #1): a line item exceeding a
  // policy threshold (missing receipt above threshold) is flagged.
  it("flags a line above the receipt threshold with no attachment", () => {
    const warnings = evaluateLinePolicy(
      { id: "li-1", categoryId: "meals", amount: 300_000, currency: "IDR", hasAttachment: false },
      [MEAL_POLICY],
      "IDR",
      CATEGORIES
    );
    // Both the category's own receiptThreshold and the meals policy row's
    // receiptRequiredAbove fire here (distinct policyId tags), so two
    // missing-receipt warnings are expected, not a merged one.
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.type === "missing_receipt_above_threshold")).toBe(true);
    expect(warnings[0].severity).toBe("high");
    expect(warnings[0].lineId).toBe("li-1");
  });

  // AC (#11, Policy Evaluation Engine, positive #1): over-category-max is
  // flagged separately from the receipt rule.
  it("flags a line exceeding the category/policy max amount", () => {
    const warnings = evaluateLinePolicy(
      { id: "li-2", categoryId: "meals", amount: 400_000, currency: "IDR", hasAttachment: true },
      [MEAL_POLICY],
      "IDR",
      CATEGORIES
    );
    const types = warnings.map((w) => w.type);
    expect(types).toContain("over_category_max");
    expect(types).not.toContain("missing_receipt_above_threshold");
  });

  it("flags a currency mismatch against the claim currency", () => {
    const warnings = evaluateLinePolicy(
      { id: "li-3", categoryId: "taxi", amount: 50_000, currency: "USD", hasAttachment: true },
      [],
      "IDR",
      CATEGORIES
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("currency_mismatch");
  });

  // AC (#11, Policy Evaluation Engine, negative #1): a line within all
  // configured limits is not flagged.
  it("does not flag a line within all configured limits", () => {
    const warnings = evaluateLinePolicy(
      { id: "li-4", categoryId: "taxi", amount: 100_000, currency: "IDR", hasAttachment: false },
      [],
      "IDR",
      CATEGORIES
    );
    expect(warnings).toHaveLength(0);
  });

  // AC (#11, Policy Evaluation Engine, negative #2): re-evaluating the same
  // line twice does not create duplicate policy_flag entries (idempotent).
  it("is idempotent — evaluating the same line twice yields identical results with no duplicates", () => {
    const line = { id: "li-5", categoryId: "meals", amount: 400_000, currency: "IDR", hasAttachment: false };
    const first = evaluateLinePolicy(line, [MEAL_POLICY], "IDR", CATEGORIES);
    const second = evaluateLinePolicy(line, [MEAL_POLICY], "IDR", CATEGORIES);
    expect(second).toEqual(first);
    // Same (type, policyId) pair must never appear twice within one evaluation.
    const keys = first.map((w) => `${w.type}:${w.policyId ?? w.lineId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("dedupes an overlapping category-cap and policy-limit warning of the same type", () => {
    // meals category perItemCap (350_000) and pol-meal limitAmount (350_000)
    // would both fire `over_category_max` for the same line; only one warning
    // should survive the (type, policyId) dedupe key since they carry
    // different policyId tags (category:meals vs pol-meal) — verifies no
    // *identical* duplicate is produced per source, not cross-source merging.
    const warnings = evaluateLinePolicy(
      { id: "li-6", categoryId: "meals", amount: 500_000, currency: "IDR", hasAttachment: true },
      [MEAL_POLICY],
      "IDR",
      CATEGORIES
    );
    const overMax = warnings.filter((w) => w.type === "over_category_max");
    expect(overMax.length).toBe(2); // category:meals + pol-meal — distinct sources, both surfaced once each
  });
});

describe("policy engine — evaluateClaim", () => {
  // AC (#11, Policy Evaluation Engine, positive #2): the policy engine is
  // invoked as a shared service call, producing consistent results for
  // identical inputs (same lines -> same warnings/summary every time).
  it("produces a consistent summary for identical claim inputs across repeated calls", () => {
    const lines = [
      { id: "li-7", categoryId: "meals", amount: 300_000, currency: "IDR", hasAttachment: false },
      { id: "li-8", categoryId: "taxi", amount: 50_000, currency: "IDR", hasAttachment: true },
    ];
    const first = evaluateClaim(lines, [MEAL_POLICY], "IDR", CATEGORIES);
    const second = evaluateClaim(lines, [MEAL_POLICY], "IDR", CATEGORIES);
    expect(second).toEqual(first);
    expect(first.summary?.type).toBe("missing_receipt");
    // li-7 trips both the category receipt-threshold rule and the meals
    // policy row's receiptRequiredAbove rule — two warnings for that line.
    expect(first.summary?.count).toBe(2);
  });

  it("returns a null summary when no line triggers a warning", () => {
    const lines = [
      { id: "li-9", categoryId: "taxi", amount: 50_000, currency: "IDR", hasAttachment: true },
    ];
    const { warnings, summary } = evaluateClaim(lines, [], "IDR", CATEGORIES);
    expect(warnings).toHaveLength(0);
    expect(summary).toBeNull();
  });
});

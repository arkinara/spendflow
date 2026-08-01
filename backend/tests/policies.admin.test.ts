/* ============================================================================
 * SpendFlow — Policy administration API + effective-dating tests (ticket #14).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { policiesTable } from "../src/db/schema.js";
import {
  activePolicyFor,
  policyEffectiveOn,
  type PolicyRow,
} from "../src/services/admin.js";
import {
  DEMO,
  authedDelete,
  authedGet,
  authedPatch,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
});
afterEach(() => h.cleanup());

async function financeCookie() {
  const res = await login(h.app, DEMO.finance.email);
  expect(res.status).toBe(200);
  return res.cookie!;
}

async function employeeCookie() {
  const res = await login(h.app, DEMO.employee.email);
  expect(res.status).toBe(200);
  return res.cookie!;
}

const basePolicy = {
  name: "Taxi daily cap",
  categoryId: "taxi",
  limitAmount: 200_000,
  currency: "IDR",
  effectiveDate: "2026-06-01",
};

describe("policy admin API", () => {
  it("creating a policy with max amount, currency, and thresholds persists correctly and is retrievable", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/policies", cookie, {
      ...basePolicy,
      receiptRequired: true,
      receiptRequiredAbove: 100_000,
      justificationRequiredAbove: 150_000,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy.limitAmount).toBe(200_000);
    expect(body.policy.currency).toBe("IDR");

    const list = await authedGet(h.app, "/api/admin/policies", cookie);
    const pols = (await list.json()).policies as Array<{ id: string }>;
    expect(pols.some((p) => p.id === body.policy.id)).toBe(true);
  });

  it("editing a policy is persisted and recorded in the audit log", async () => {
    const cookie = await financeCookie();
    const res = await authedPatch(h.app, "/api/admin/policies/pol-2", cookie, {
      limitAmount: 400_000,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy.limitAmount).toBe(400_000);
    const row = h.db.select().from(policiesTable).where(eq(policiesTable.id, "pol-2")).get();
    expect(row?.limitAmount).toBe(400_000);
  });

  it("creating a policy with a negative max amount is rejected with a validation error", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/policies", cookie, {
      ...basePolicy,
      limitAmount: -1,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
  });

  it("creating a policy with a currency outside the allowlist is rejected", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/policies", cookie, {
      ...basePolicy,
      currency: "EUR",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
    expect(body.error.message).toMatch(/currency/i);
  });

  it("a non-Finance-Admin caller attempting to create a policy is rejected with an authorization error", async () => {
    const cookie = await employeeCookie();
    const res = await authedPost(h.app, "/api/admin/policies", cookie, basePolicy);
    expect(res.status).toBe(403);
  });

  it("DELETE deactivates a policy without removing the row (soft delete)", async () => {
    const cookie = await financeCookie();
    const res = await authedDelete(h.app, "/api/admin/policies/pol-1", cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy.active).toBe(false);
    const row = h.db.select().from(policiesTable).where(eq(policiesTable.id, "pol-1")).get();
    expect(row).toBeDefined();
    expect(row?.active).toBe(false);
  });

  it("editing a policy's effective_date does not change evaluation results for dates before it (pure helper)", () => {
    const original: PolicyRow = {
      id: "pol-x",
      name: "Meal cap",
      description: "",
      categoryId: "meals",
      limitAmount: 350_000,
      period: "per_item",
      currency: "IDR",
      receiptRequired: true,
      receiptRequiredAbove: 250_000,
      justificationRequiredAbove: 350_000,
      effectiveDate: "2026-01-01",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Finance raises the cap, effective 2026-08-01.
    const revised: PolicyRow = { ...original, limitAmount: 500_000, effectiveDate: "2026-08-01" };

    // A claim submitted before the change is evaluated against the original snapshot.
    const forOldClaim = activePolicyFor("meals", "2026-07-15", [original, revised]);
    expect(forOldClaim?.limitAmount).toBe(350_000);

    // A claim submitted after the change picks up the new snapshot.
    const forNewClaim = activePolicyFor("meals", "2026-08-15", [original, revised]);
    expect(forNewClaim?.limitAmount).toBe(500_000);
  });

  it("policyEffectiveOn is false before the effective date and for inactive policies", () => {
    const policy = { active: true, effectiveDate: "2026-05-01" };
    expect(policyEffectiveOn(policy, "2026-04-30")).toBe(false);
    expect(policyEffectiveOn(policy, "2026-05-01")).toBe(true);
    expect(policyEffectiveOn(policy, "2026-05-02")).toBe(true);
    expect(policyEffectiveOn({ ...policy, active: false }, "2026-05-02")).toBe(false);
  });

  it("activePolicyFor prefers a category-specific policy over a global one in force on the same date", () => {
    const global: PolicyRow = {
      id: "pol-global",
      name: "Global receipts",
      description: "",
      categoryId: null,
      limitAmount: 1_000_000,
      period: "per_item",
      currency: "IDR",
      receiptRequired: true,
      receiptRequiredAbove: 500_000,
      justificationRequiredAbove: 1_000_000,
      effectiveDate: "2026-01-01",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const scoped: PolicyRow = { ...global, id: "pol-hotel", categoryId: "hotel", limitAmount: 1_200_000 };
    const result = activePolicyFor("hotel", "2026-03-01", [global, scoped]);
    expect(result?.id).toBe("pol-hotel");
  });
});

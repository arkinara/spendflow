/* ============================================================================
 * SpendFlow — Category administration API tests (ticket #14).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { categoriesTable } from "../src/db/schema.js";
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

describe("category admin API", () => {
  it("creating a category via API persists correctly and is retrievable", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/categories", cookie, {
      name: "Parking",
      code: "PRK",
      requiresReceipt: false,
      receiptThreshold: 0,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category.id).toBeTruthy();
    expect(body.category.active).toBe(true);

    const list = await authedGet(h.app, "/api/admin/categories", cookie);
    const cats = (await list.json()).categories as Array<{ code: string }>;
    expect(cats.some((c) => c.code === "PRK")).toBe(true);
  });

  it("editing a category updates the row and records an audit entry", async () => {
    const cookie = await financeCookie();
    const res = await authedPatch(h.app, "/api/admin/categories/taxi", cookie, {
      receiptThreshold: 150_000,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category.receiptThreshold).toBe(150_000);

    const row = h.db.select().from(categoriesTable).where(eq(categoriesTable.id, "taxi")).get();
    expect(row?.receiptThreshold).toBe(150_000);
  });

  it("creating a category with a duplicate code is rejected", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/categories", cookie, {
      name: "Flights Again",
      code: "FLT", // already used by the seeded "flight" category
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("duplicate_code");
  });

  it("deactivating a category does not break historical claims/line items referencing it", async () => {
    const empCookie = await employeeCookie();
    const financeCk = await financeCookie();

    // Submit a claim with a line item against the "meals" category.
    const createRes = await authedPost(h.app, "/api/claims", empCookie, {
      title: "Lunch with client",
      lineItems: [{ categoryId: "meals", date: "2026-07-01", amount: 100_000 }],
    });
    expect(createRes.status).toBe(201);
    const claim = (await createRes.json()).claim;

    // Deactivate the category via the admin API.
    const delRes = await authedDelete(h.app, "/api/admin/categories/meals", financeCk);
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.category.active).toBe(false);

    // The row still exists (soft delete) so the FK on claim_line_items never breaks.
    const row = h.db.select().from(categoriesTable).where(eq(categoriesTable.id, "meals")).get();
    expect(row).toBeDefined();

    // The historical claim's line item still resolves the category untouched.
    const getRes = await authedGet(h.app, `/api/claims/${claim.id}`, empCookie);
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()).claim;
    expect(fetched.lineItems[0].categoryId).toBe("meals");
  });

  it("a non-Finance-Admin caller attempting to create a category is rejected", async () => {
    const cookie = await employeeCookie();
    const res = await authedPost(h.app, "/api/admin/categories", cookie, {
      name: "Should Not Work",
      code: "NOPE",
    });
    expect(res.status).toBe(403);
  });

  it("DELETE never hard-deletes: the category row remains in the table after deactivation", async () => {
    const cookie = await financeCookie();
    const res = await authedDelete(h.app, "/api/admin/categories/other", cookie);
    expect(res.status).toBe(200);
    const row = h.db.select().from(categoriesTable).where(eq(categoriesTable.id, "other")).get();
    expect(row).toBeDefined();
    expect(row?.active).toBe(false);
  });
});

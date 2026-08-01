/* ============================================================================
 * SpendFlow — Claim & line-item lifecycle tests (ticket #11, Claim & Line
 * Item Schema/API sub-feature).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO,
  authedGet,
  authedPatch,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";

let h: Harness;
let employeeCookie: string;

beforeEach(async () => {
  h = await bootstrap();
  const res = await login(h.app, DEMO.employee.email);
  expect(res.status).toBe(200);
  employeeCookie = res.cookie!;
});
afterEach(() => h.cleanup());

describe("claim creation + retrieval", () => {
  // AC (#11, Claim & Line Item Schema/API, positive #1): creating a claim
  // with multiple line items persists correctly and is retrievable via API.
  it("creates a claim with multiple line items and retrieves it via GET", async () => {
    const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "Jakarta client trip",
      purpose: "Client renewal meeting",
      currency: "IDR",
      lineItems: [
        { categoryId: "taxi", date: "2026-07-01", amount: 80_000 },
        { categoryId: "meals", date: "2026-07-01", amount: 120_000 },
      ],
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.claim.status).toBe("draft");
    expect(created.claim.lineItems).toHaveLength(2);

    const getRes = await authedGet(h.app, `/api/claims/${created.claim.id}`, employeeCookie);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.claim.id).toBe(created.claim.id);
    expect(fetched.claim.lineItems.map((l: { categoryId: string }) => l.categoryId).sort()).toEqual([
      "meals",
      "taxi",
    ]);
  });

  // AC (#11, Attachment Storage & Manual Metadata API, positive #2): a
  // mileage line item's amount is correctly computed from distance × category
  // rate server-side (client-supplied amount must be ignored).
  it("computes a mileage line item's amount server-side from distance × rate", async () => {
    const res = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "Client site visit",
      lineItems: [
        {
          categoryId: "mileage",
          date: "2026-07-02",
          quantity: 42,
          amount: 999_999, // must be ignored — server computes from rate
        },
      ],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const line = body.claim.lineItems[0];
    // Seeded mileage rate is 1_200 IDR/km (see tests/helpers.ts seedCatalog).
    expect(line.amount).toBe(42 * 1_200);
    expect(line.unitRate).toBe(1_200);
    expect(line.quantity).toBe(42);
  });
});

describe("claim submission lifecycle", () => {
  // AC (#11, Claim & Line Item Schema/API, positive #2): submitting a claim
  // with all required fields succeeds and transitions status to Pending
  // Approval.
  it("submits a valid claim and transitions it to pending", async () => {
    const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "Bandung workshop",
      lineItems: [{ categoryId: "taxi", date: "2026-07-03", amount: 60_000 }],
    });
    const created = await createRes.json();

    const submitRes = await authedPost(
      h.app,
      `/api/claims/${created.claim.id}/submit`,
      employeeCookie,
      {}
    );
    expect(submitRes.status).toBe(200);
    const submitted = await submitRes.json();
    expect(submitted.claim.status).toBe("pending");
    expect(submitted.claim.submittedAt).not.toBeNull();
    expect(submitted.claim.approvalRouteId).toBeTruthy();
  });

  // AC (#11, Claim & Line Item Schema/API, negative #1): submitting a claim
  // with zero line items is rejected with a clear validation error.
  it("rejects submitting a claim with zero line items", async () => {
    const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "Empty claim",
    });
    const created = await createRes.json();

    const submitRes = await authedPost(
      h.app,
      `/api/claims/${created.claim.id}/submit`,
      employeeCookie,
      {}
    );
    expect(submitRes.status).toBe(400);
    const body = await submitRes.json();
    expect(body.error.code).toBe("no_line_items");
  });

  // AC (#11, Claim & Line Item Schema/API, negative #2): submitting/creating
  // a line item with a missing required field (category, amount, date) is
  // rejected with field-level validation errors.
  it("rejects a line item missing a required field (category)", async () => {
    const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "Bad line item claim",
    });
    const created = await createRes.json();

    const addRes = await authedPost(
      h.app,
      `/api/claims/${created.claim.id}/line-items`,
      employeeCookie,
      { date: "2026-07-04", amount: 10_000 } // missing categoryId
    );
    expect(addRes.status).toBe(400);
    const body = await addRes.json();
    expect(body.error.code).toBe("invalid_body");
  });

  // AC (#11, Attachment Storage & Manual Metadata API, negative #2): editing
  // a line item on a claim that is no longer in Draft status (e.g. already
  // Pending Approval) is rejected.
  it("rejects editing a line item once the claim is no longer Draft", async () => {
    const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "Submitted then edited",
      lineItems: [{ categoryId: "taxi", date: "2026-07-05", amount: 40_000 }],
    });
    const created = await authedGet(h.app, `/api/claims/${(await createRes.json()).claim.id}`, employeeCookie).then((r) => r.json());
    const lineId = created.claim.lineItems[0].id;
    const claimId = created.claim.id;

    const submitRes = await authedPost(h.app, `/api/claims/${claimId}/submit`, employeeCookie, {});
    expect(submitRes.status).toBe(200);

    const editRes = await authedPatch(
      h.app,
      `/api/claims/${claimId}/line-items/${lineId}`,
      employeeCookie,
      { categoryId: "taxi", date: "2026-07-05", amount: 999_999 }
    );
    expect(editRes.status).toBe(409);
    const body = await editRes.json();
    expect(body.error.code).toBe("wrong_status");
  });
});

describe("claim ownership scoping", () => {
  it("rejects an employee editing another employee's draft claim", async () => {
    // A second employee (self-provisioned as a fresh draft owner) attempts to
    // patch the first employee's claim.
    const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "Owner-only claim",
      lineItems: [{ categoryId: "taxi", date: "2026-07-06", amount: 10_000 }],
    });
    const created = await createRes.json();

    const approverLogin = await login(h.app, DEMO.approver.email);
    const patchRes = await authedPatch(
      h.app,
      `/api/claims/${created.claim.id}`,
      approverLogin.cookie,
      { title: "Hijacked title" }
    );
    expect(patchRes.status).toBe(403);
    const body = await patchRes.json();
    expect(body.error.code).toBe("forbidden");
  });
});

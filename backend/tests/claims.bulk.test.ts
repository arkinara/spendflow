/* ============================================================================
 * SpendFlow — Finance Admin bulk-claim operations tests (ticket #73).
 *
 * Covers the three bulk endpoints mounted on the admin router:
 *   POST /api/admin/claims/bulk-approve
 *   POST /api/admin/claims/bulk-reject
 *   POST /api/admin/claims/bulk-pay
 *
 * Each batch is atomic — any per-claim validation failure rolls back the whole
 * batch (no row is mutated) and the response carries a typed `failed[]` entry.
 * The actor's own password is re-verified (#64) before any work; a wrong
 * password surfaces as 401 `invalid_password`.
 * ========================================================================== */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvalRoutesTable,
  approvalStepsTable,
  claimsTable,
  paymentsTable,
} from "../src/db/schema.js";
import { auditForEntity } from "../src/services/audit.js";
import {
  DEMO,
  authedPost,
  bootstrap,
  login,
  provisionSeedUser,
  type Harness,
} from "./helpers.js";

let h: Harness;
let financeCookie: string;
let employeeCookie: string;
let approverCookie: string;

beforeEach(async () => {
  h = await bootstrap();
  financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
  employeeCookie = (await login(h.app, DEMO.employee.email)).cookie!;
  approverCookie = (await login(h.app, DEMO.approver.email)).cookie!;
});
afterEach(() => h.cleanup());

/** Insert an active non-fallback route with a single finance-routed step. */
function insertFinanceRoute(
  opts: { routeId?: string; stepId?: string; withManagerStep?: boolean } = {}
) {
  const routeId = opts.routeId ?? "rt-bulk-fin";
  const stepId = opts.stepId ?? "rt-bulk-fin-s0";
  const now = new Date();
  const exists = h.db
    .select({ id: approvalRoutesTable.id })
    .from(approvalRoutesTable)
    .where(eq(approvalRoutesTable.id, routeId))
    .get();
  if (exists) return { routeId, stepId };
  h.db.transaction((tx) => {
    tx.insert(approvalRoutesTable)
      .values({
        id: routeId,
        name: "Bulk finance route",
        matchMinAmount: 0,
        matchMaxAmount: null,
        matchDepartment: null,
        isFallback: false,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (opts.withManagerStep) {
      tx.insert(approvalStepsTable)
        .values({
          id: `${stepId}-mgr`,
          routeId,
          orderIndex: 0,
          approverType: "submitter_manager",
          approverId: null,
          label: "Line manager",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(approvalStepsTable)
        .values({
          id: stepId,
          routeId,
          orderIndex: 1,
          approverType: "finance",
          approverId: null,
          label: "Finance review",
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } else {
      tx.insert(approvalStepsTable)
        .values({
          id: stepId,
          routeId,
          orderIndex: 0,
          approverType: "finance",
          approverId: null,
          label: "Finance review",
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  });
  return { routeId, stepId };
}

/** Create + submit a clean taxi claim as the default employee, return its id. */
async function createPendingClaim(
  title = "Bulk test claim",
  cookie: string = employeeCookie
): Promise<string> {
  const createRes = await authedPost(h.app, "/api/claims", cookie, {
    title,
    lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 30_000 }],
  });
  const created = await createRes.json();
  const submitRes = await authedPost(
    h.app,
    `/api/claims/${created.claim.id}/submit`,
    cookie,
    {}
  );
  expect(submitRes.status).toBe(200);
  return created.claim.id as string;
}

/**
 * Submit + approve through the single-finance-step route so the claim lands
 * on `approved`. The route is inserted once per test (idempotent on the
 * routeId) so multiple calls in the same test reuse it.
 */
async function createApprovedClaim(title = "Bulk pay claim"): Promise<string> {
  insertFinanceRoute({ stepId: "rt-bulk-pay-s0", routeId: "rt-bulk-pay" });
  const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
    title,
    lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 30_000 }],
  });
  const created = await createRes.json();
  const claimId = created.claim.id as string;
  await authedPost(h.app, `/api/claims/${claimId}/submit`, employeeCookie, {});
  const decideRes = await authedPost(
    h.app,
    `/api/approver/claims/${claimId}/decisions`,
    financeCookie,
    { action: "approve" }
  );
  expect(decideRes.status).toBe(200);
  expect((await decideRes.json()).claim.status).toBe("approved");
  return claimId;
}

/* ======================================================================== ==
 * bulkApprove
 * ======================================================================== == */

describe("bulkApprove", () => {
  it("advances 5 finance-step claims to approved in one batch", async () => {
    insertFinanceRoute();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      // Each claim routes through the finance-only route (matchMinAmount=0).
      const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
        title: `Bulk approve ${i + 1}`,
        lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 10_000 }],
      });
      const created = await createRes.json();
      const claimId = created.claim.id as string;
      await authedPost(
        h.app,
        `/api/claims/${claimId}/submit`,
        employeeCookie,
        {}
      );
      ids.push(claimId);
    }

    const res = await authedPost(
      h.app,
      "/api/admin/claims/bulk-approve",
      financeCookie,
      { claimIds: ids, password: DEMO.password }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed.sort()).toEqual([...ids].sort());
    expect(body.failed).toEqual([]);

    for (const id of ids) {
      const row = h.db
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.id, id))
        .get();
      expect(row?.status).toBe("approved");
      const audit = auditForEntity(h.db, "claim", id);
      expect(audit.some((a) => a.action === "claim.approved.final")).toBe(true);
    }
  });

  it("rolls back the whole batch when one claim is not_at_your_step", async () => {
    // Multi-step route: manager (step 0) → finance (step 1).
    insertFinanceRoute({
      routeId: "rt-bulk-multi",
      stepId: "rt-bulk-multi-fin",
      withManagerStep: true,
    });
    const financeIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
        title: `Should roll back ${i + 1}`,
        lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 10_000 }],
      });
      const created = await createRes.json();
      const claimId = created.claim.id as string;
      await authedPost(h.app, `/api/claims/${claimId}/submit`, employeeCookie, {});
      // Advance past the manager step so this claim is now at the finance step.
      const adv = await authedPost(
        h.app,
        `/api/approver/claims/${claimId}/decisions`,
        approverCookie,
        { action: "approve" }
      );
      expect(adv.status).toBe(200);
      financeIds.push(claimId);
    }

    // A pending claim that's still at the manager step — finance bulk-approve
    // must trip not_at_your_step.
    const managerStepCreate = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "At manager step",
      lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 10_000 }],
    });
    const managerStepClaimId = (await managerStepCreate.json()).claim.id as string;
    await authedPost(
      h.app,
      `/api/claims/${managerStepClaimId}/submit`,
      employeeCookie,
      {}
    );

    const res = await authedPost(
      h.app,
      "/api/admin/claims/bulk-approve",
      financeCookie,
      { claimIds: [...financeIds, managerStepClaimId], password: DEMO.password }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toEqual([]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].claimId).toBe(managerStepClaimId);
    expect(body.failed[0].code).toBe("not_at_your_step");

    // The whole batch rolled back — none of the finance-step claims advanced.
    for (const id of financeIds) {
      const row = h.db
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.id, id))
        .get();
      expect(row?.status).toBe("pending");
    }
  });

  it("rolls back when one claim is wrong_status (already approved)", async () => {
    insertFinanceRoute();
    const pendingIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
        title: `Pending ${i + 1}`,
        lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 10_000 }],
      });
      const created = await createRes.json();
      await authedPost(
        h.app,
        `/api/claims/${created.claim.id}/submit`,
        employeeCookie,
        {}
      );
      pendingIds.push(created.claim.id as string);
    }
    const approvedId = await createApprovedClaim("Already approved");

    const res = await authedPost(
      h.app,
      "/api/admin/claims/bulk-approve",
      financeCookie,
      { claimIds: [...pendingIds, approvedId], password: DEMO.password }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toEqual([]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].code).toBe("wrong_status");
    expect(body.failed[0].claimId).toBe(approvedId);

    // The pending claims stay pending (rolled back).
    for (const id of pendingIds) {
      const row = h.db
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.id, id))
        .get();
      expect(row?.status).toBe("pending");
    }
  });

  it("returns 401 invalid_password when the actor password is wrong", async () => {
    insertFinanceRoute();
    const id = await createPendingClaim("Bad password");
    const res = await authedPost(
      h.app,
      "/api/admin/claims/bulk-approve",
      financeCookie,
      { claimIds: [id], password: "wrong-password" }
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_password");
  });
});

/* ======================================================================== ==
 * bulkReject
 * ======================================================================== == */

describe("bulkReject", () => {
  it("returns 5 pending claims to action_required with the shared comment", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await createPendingClaim(`Reject ${i + 1}`));
    }
    const comment = "Q4 budget freeze — please resubmit in January.";
    const res = await authedPost(
      h.app,
      "/api/admin/claims/bulk-reject",
      financeCookie,
      { claimIds: ids, password: DEMO.password, comment }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed.sort()).toEqual([...ids].sort());
    expect(body.failed).toEqual([]);

    for (const id of ids) {
      const row = h.db
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.id, id))
        .get();
      expect(row?.status).toBe("action_required");
      const audit = auditForEntity(h.db, "claim", id);
      expect(audit.some((a) => a.action === "claim.bulk_returned")).toBe(true);
    }
  });

  it("returns 400 invalid_body when the comment is shorter than 10 chars", async () => {
    const id = await createPendingClaim("Short comment");
    const res = await authedPost(
      h.app,
      "/api/admin/claims/bulk-reject",
      financeCookie,
      { claimIds: [id], password: DEMO.password, comment: "short" }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_body");
  });

  it("rolls back when one claim is wrong_status (already approved, not pending)", async () => {
    const approvedId = await createApprovedClaim("Already approved");
    const pendingId = await createPendingClaim("Still pending");

    const res = await authedPost(
      h.app,
      "/api/admin/claims/bulk-reject",
      financeCookie,
      {
        claimIds: [pendingId, approvedId],
        password: DEMO.password,
        comment: "Returning these for Q4 budget reasons.",
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toEqual([]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].code).toBe("wrong_status");
    expect(body.failed[0].claimId).toBe(approvedId);

    // The pending claim stays pending (rolled back).
    const pendingRow = h.db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, pendingId))
      .get();
    expect(pendingRow?.status).toBe("pending");
  });
});

/* ======================================================================== ==
 * bulkPay
 * ======================================================================== == */

describe("bulkPay", () => {
  it("moves 5 approved claims to paid + writes a payments row each", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await createApprovedClaim(`Pay ${i + 1}`));
    }

    const res = await authedPost(
      h.app,
      "/api/admin/claims/bulk-pay",
      financeCookie,
      {
        claimIds: ids,
        password: DEMO.password,
        paymentMethod: "bank_transfer",
        reference: "BATCH-2026-08-001",
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed.sort()).toEqual([...ids].sort());
    expect(body.failed).toEqual([]);

    for (const id of ids) {
      const row = h.db
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.id, id))
        .get();
      expect(row?.status).toBe("paid");
      const payment = h.db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.claimId, id))
        .get();
      expect(payment).toBeDefined();
      expect(payment?.status).toBe("paid");
      expect(payment?.method).toBe("bank_transfer");
      expect(payment?.referenceNumber).toBe("BATCH-2026-08-001");
      expect(payment?.processedBy).toBe(DEMO.finance.id);
      const audit = auditForEntity(h.db, "claim", id);
      expect(audit.some((a) => a.action === "claim.bulk_paid")).toBe(true);
    }
  });

  it("rolls back when one claim is not_approved (still pending)", async () => {
    const approvedIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      approvedIds.push(await createApprovedClaim(`Approved ${i + 1}`));
    }
    const pendingId = await createPendingClaim("Not approved yet");

    const res = await authedPost(
      h.app,
      "/api/admin/claims/bulk-pay",
      financeCookie,
      {
        claimIds: [...approvedIds, pendingId],
        password: DEMO.password,
        paymentMethod: "payroll",
        reference: "BATCH-ROLLBACK",
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toEqual([]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].code).toBe("not_approved");
    expect(body.failed[0].claimId).toBe(pendingId);

    // The approved claims stay approved (rolled back) — no payments row written.
    for (const id of approvedIds) {
      const row = h.db
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.id, id))
        .get();
      expect(row?.status).toBe("approved");
      const payment = h.db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.claimId, id))
        .get();
      expect(payment).toBeUndefined();
    }
  });
});

/* ======================================================================== ==
 * Authorisation
 * ======================================================================== == */

describe("bulk ops authorisation", () => {
  it("returns 403 forbidden when a non-Finance role calls any bulk endpoint", async () => {
    const id = await createPendingClaim();
    for (const endpoint of [
      "/api/admin/claims/bulk-approve",
      "/api/admin/claims/bulk-reject",
      "/api/admin/claims/bulk-pay",
    ]) {
      const res = await authedPost(h.app, endpoint, approverCookie, {
        claimIds: [id],
        password: DEMO.password,
        comment: "Should be blocked",
        paymentMethod: "bank_transfer",
        reference: "x",
      });
      expect(res.status).toBe(403);
    }
  });
});

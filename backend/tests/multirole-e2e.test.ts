/* ============================================================================
 * SpendFlow — Multi-role end-to-end verification (ticket #47, cycle 4).
 *
 * Single integration test that walks the full multi-role + segregation-of-duties
 * composition with real seed data (no service-level mocks): an employee claim
 * flows manager → finance → paid; an approver who is also an employee submits
 * their own claim, gets SoD-blocked (no manager), then — once Finance wires up
 * a reporting line — re-submits and the claim flows the same path to `paid`.
 *
 * PASS signal for the cycle: "an approver can submit their own claim without
 * violating SoD, as long as someone else sits at each step."
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalRoutesTable, approvalStepsTable } from "../src/db/schema.js";
import { auditForEntity } from "../src/services/audit.js";
import {
  DEMO,
  authedGet,
  authedPatch,
  authedPost,
  bootstrap,
  login,
  provisionSeedUser,
  type Harness,
} from "./helpers.js";

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
});
afterEach(() => h.cleanup());

/**
 * Insert a two-step active route matching every claim (minAmount 0, so it wins
 * over the seeded fallback): submitter_manager → finance. This is the route
 * that lets a single claim exercise BOTH the manager approval step and the
 * finance review step before payment.
 */
function insertTwoStepRoute(routeId = "rt-e2e") {
  const now = new Date();
  h.db.transaction((tx) => {
    tx.insert(approvalRoutesTable)
      .values({
        id: routeId,
        name: "E2E route (manager → finance)",
        matchMinAmount: 0,
        matchMaxAmount: null,
        matchDepartment: null,
        isFallback: false,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(approvalStepsTable)
      .values({
        id: `${routeId}-s0`,
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
        id: `${routeId}-s1`,
        routeId,
        orderIndex: 1,
        approverType: "finance",
        approverId: null,
        label: "Finance review",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}

/** Create + submit a single-line taxi claim as the given cookie holder. */
async function submitClaim(cookie: string, title: string) {
  const createRes = await authedPost(h.app, "/api/claims", cookie, {
    title,
    lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 40_000 }],
  });
  expect(createRes.status).toBe(201);
  const created = await createRes.json();
  const submitRes = await authedPost(
    h.app,
    `/api/claims/${created.claim.id}/submit`,
    cookie,
    {}
  );
  return { submitRes, claimId: created.claim.id as string };
}

/** Approve the claim's current step as `cookie`; return the parsed body. */
async function approveStep(claimId: string, cookie: string) {
  const res = await authedPost(
    h.app,
    `/api/approver/claims/${claimId}/decisions`,
    cookie,
    { action: "approve" }
  );
  expect(res.status).toBe(200);
  return res.json();
}

/** Drive an approved claim through processing → paid; return the paid body. */
async function payClaim(claimId: string, financeCookie: string, reference: string) {
  const procRes = await authedPost(
    h.app,
    `/api/finance/payments/${claimId}/processing`,
    financeCookie,
    { method: "bank_transfer", reference }
  );
  expect(procRes.status).toBe(200);
  expect((await procRes.json()).claim.status).toBe("processing");
  const paidRes = await authedPost(
    h.app,
    `/api/finance/payments/${claimId}/paid`,
    financeCookie,
    {}
  );
  expect(paidRes.status).toBe(200);
  return paidRes.json();
}

describe("multi-role end-to-end (#47): approver submits own claim without SoD violation", () => {
  it("walks aulia's claim manager → finance → paid, and bob's blocked → fixed → paid", async () => {
    insertTwoStepRoute();

    // alice: a second approver reporting to dewi (so dewi stays top of chain).
    await provisionSeedUser(h, {
      id: "u-alice",
      name: "Alice Approver",
      email: "alice@spendflow.example",
      role: "approver",
      roles: ["approver"],
      managerId: DEMO.approver.id,
    });
    // bob: multi-role employee + approver, deliberately seeded WITHOUT a
    // manager so the first submission triggers the SoD no_manager block.
    await provisionSeedUser(h, {
      id: "u-bob",
      name: "Bob Dual Role",
      email: "bob@spendflow.example",
      role: "employee",
      roles: ["employee", "approver"],
    });

    const aulia = (await login(h.app, DEMO.employee.email)).cookie!;
    const dewi = (await login(h.app, DEMO.approver.email)).cookie!;
    const ridwan = (await login(h.app, DEMO.finance.email)).cookie!;
    const alice = (await login(h.app, "alice@spendflow.example")).cookie!;
    const bob = (await login(h.app, "bob@spendflow.example")).cookie!;

    // -------- Leg 1: aulia (employee) → dewi (manager) → finance → paid --
    const leg1 = await submitClaim(aulia, "Aulia taxi (e2e)");
    expect(leg1.submitRes.status).toBe(200);
    const leg1Body = await leg1.submitRes.json();
    expect(leg1Body.claim.status).toBe("pending");
    expect(leg1Body.claim.approvalRouteId).toBe("rt-e2e");

    // dewi (aulia's line manager) approves step 0 → advances to finance step.
    const advDewi = await approveStep(leg1.claimId, dewi);
    expect(advDewi.claim.status).toBe("pending");
    expect(advDewi.claim.currentStepIndex).toBe(1);
    expect(advDewi.advanced).toBe(true);

    // ridwan (finance admin) clears the final finance step → approved.
    const finApprove = await approveStep(leg1.claimId, ridwan);
    expect(finApprove.claim.status).toBe("approved");
    expect(finApprove.finalised).toBe(true);

    // ridwan processes + pays aulia's claim.
    const leg1Paid = await payClaim(leg1.claimId, ridwan, "TRX-E2E-1");
    expect(leg1Paid.claim.status).toBe("paid");

    // -------- Leg 2: bob (multi-role, no manager) → blocked_sod ----------
    const bobBlocked = await submitClaim(bob, "Bob own claim (no manager)");
    const bobBlockedBody = await bobBlocked.submitRes.json();
    expect(bobBlockedBody.claim.status).toBe("blocked_sod");
    expect(bobBlockedBody.claim.blockedReason).toContain("no manager");
    const blockAudit = auditForEntity(h.db, "claim", bobBlocked.claimId);
    expect(
      blockAudit.some(
        (a) => a.action === "claim.blocked_sod" && a.after.code === "no_manager"
      )
    ).toBe(true);

    // The blocked claim surfaces in Finance's exception queue (#46).
    const exceptions = await authedGet(h.app, "/api/finance/exceptions", ridwan);
    const excBody = await exceptions.json();
    expect(excBody.items.map((i: { id: string }) => i.id)).toContain(
      bobBlocked.claimId
    );

    // -------- Finance wires bob's reporting line to alice (approver) ------
    // Uses the real admin API (not a direct DB write) so the full path —
    // including the approver-role + cycle guards in setManager — is exercised.
    const mgrRes = await authedPatch(
      h.app,
      "/api/admin/users/u-bob/manager",
      ridwan,
      { managerId: "u-alice" }
    );
    expect(mgrRes.status).toBe(200);

    // -------- Leg 3: bob re-submits a fresh claim → routes to alice ------
    // bob's first claim stays blocked_sod (no unblock path shipped in #46);
    // the SoD resolution is demonstrated by a new submission now that bob
    // has a non-self manager at every step.
    const bobClaim = await submitClaim(bob, "Bob own claim (with manager)");
    const bobClaimBody = await bobClaim.submitRes.json();
    expect(bobClaimBody.claim.status).toBe("pending");
    expect(bobClaimBody.claim.blockedReason).toBeNull();

    // alice (bob's manager, NOT bob) approves step 0 → finance step. bob
    // holds the approver role but cannot self-approve (SoD): he is not his
    // own manager, so the claim never appears in his approver inbox.
    const bobInbox = await authedGet(h.app, "/api/approver/inbox", bob);
    const bobInboxBody = await bobInbox.json();
    expect(bobInboxBody.items.map((i: { id: string }) => i.id)).not.toContain(
      bobClaim.claimId
    );

    const advAlice = await approveStep(bobClaim.claimId, alice);
    expect(advAlice.claim.status).toBe("pending");
    expect(advAlice.claim.currentStepIndex).toBe(1);

    // ridwan clears the finance step → approved → processing → paid.
    const bobFinApprove = await approveStep(bobClaim.claimId, ridwan);
    expect(bobFinApprove.claim.status).toBe("approved");

    const bobPaid = await payClaim(bobClaim.claimId, ridwan, "TRX-E2E-2");
    expect(bobPaid.claim.status).toBe("paid");
  });
});

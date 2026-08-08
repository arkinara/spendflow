/* ============================================================================
 * SpendFlow — Finance exception resolution + payment lifecycle tests (#13).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paymentsTable } from "../src/db/schema.js";
import { notificationsFor } from "../src/services/notifications.js";
import { auditForEntity } from "../src/services/audit.js";
import {
  DEMO,
  authedGet,
  authedPost,
  bootstrap,
  login,
  provisionSeedUser,
  type Harness,
} from "./helpers.js";

let h: Harness;
let employeeCookie: string;
let approverCookie: string;
let financeCookie: string;

beforeEach(async () => {
  h = await bootstrap();
  employeeCookie = (await login(h.app, DEMO.employee.email)).cookie!;
  approverCookie = (await login(h.app, DEMO.approver.email)).cookie!;
  financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
});
afterEach(() => h.cleanup());

/**
 * Submit a claim with a single line item and approve it through the default
 * (single-step, submitter_manager) fallback route so it lands on `approved`.
 */
async function createApprovedClaim(
  categoryId: string,
  amount: number,
  title = "Finance test claim"
): Promise<string> {
  const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
    title,
    lineItems: [{ categoryId, date: "2026-07-15", amount }],
  });
  const created = await createRes.json();
  const claimId = created.claim.id;
  const submitRes = await authedPost(h.app, `/api/claims/${claimId}/submit`, employeeCookie, {});
  expect(submitRes.status).toBe(200);
  const decideRes = await authedPost(
    h.app,
    `/api/approver/claims/${claimId}/decisions`,
    approverCookie,
    { action: "approve" }
  );
  expect(decideRes.status).toBe(200);
  const decideBody = await decideRes.json();
  expect(decideBody.claim.status).toBe("approved");
  return claimId;
}

/** Hotel above the receipt threshold, no attachment → carries a policy flag. */
async function createFlaggedClaim(title = "Flagged hotel claim") {
  return createApprovedClaim("hotel", 600_000, title);
}

/** Taxi below any threshold → clears with no policy flag. */
async function createCleanClaim(title = "Clean taxi claim") {
  return createApprovedClaim("taxi", 50_000, title);
}

describe("exception queue", () => {
  // (a) getFinanceExceptions filters by open flag.
  it("includes an approved claim with an open flag and excludes one with none", async () => {
    const flaggedId = await createFlaggedClaim();
    const cleanId = await createCleanClaim();

    const res = await authedGet(h.app, "/api/finance/exceptions", financeCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(flaggedId);
    expect(ids).not.toContain(cleanId);

    const flaggedItem = body.items.find((i: { id: string }) => i.id === flaggedId);
    expect(flaggedItem.openFlagCount).toBeGreaterThan(0);
    expect(flaggedItem.employeeName).toBe(DEMO.employee.name);
    const flaggedLine = flaggedItem.lineItems.find((l: { policyFlag: unknown }) => l.policyFlag);
    expect(flaggedLine.policyFlag[0].type).toBeDefined();
  });

  // (a) a claim drops out of the queue once its flag is resolved.
  it("excludes a claim from the queue once its flag has been overridden", async () => {
    const claimId = await createFlaggedClaim();
    let res = await authedGet(h.app, "/api/finance/exceptions", financeCookie);
    let body = await res.json();
    expect(body.items.map((i: { id: string }) => i.id)).toContain(claimId);

    await authedPost(h.app, `/api/finance/exceptions/${claimId}/resolve`, financeCookie, {
      action: "override",
      comment: "Approved by finance — reasonable expense given circumstances.",
    });

    res = await authedGet(h.app, "/api/finance/exceptions", financeCookie);
    body = await res.json();
    expect(body.items.map((i: { id: string }) => i.id)).not.toContain(claimId);
  });

  // (#46) a SoD-blocked claim surfaces in the exception queue with its reason.
  it("includes a blocked_sod claim with its blocked reason", async () => {
    // Employee with no manager + the default submitter_manager fallback route
    // → submission lands in blocked_sod (no_manager).
    await provisionSeedUser(h, {
      id: "u-fin-nomgr",
      name: "Finance SoD Probe",
      email: "fin-nomgr@spendflow.example",
      role: "employee",
    });
    const cookie = (await login(h.app, "fin-nomgr@spendflow.example")).cookie!;
    const createRes = await authedPost(h.app, "/api/claims", cookie, {
      title: "Blocked by SoD",
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
    expect((await submitRes.json()).claim.status).toBe("blocked_sod");

    const res = await authedGet(h.app, "/api/finance/exceptions", financeCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(created.claim.id);
    const item = body.items.find(
      (i: { id: string }) => i.id === created.claim.id
    );
    expect(item.status).toBe("blocked_sod");
    expect(item.blockedReason).toContain("no manager");
  });
});

describe("override", () => {
  // (b) override clears the flag, writes audit, updates the claim.
  it("clears the line item's flag, writes an audit entry, and keeps the claim approved", async () => {
    const claimId = await createFlaggedClaim();
    const res = await authedPost(h.app, `/api/finance/exceptions/${claimId}/resolve`, financeCookie, {
      action: "override",
      comment: "Justified — client requested late upgrade.",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claim.status).toBe("approved");
    expect(body.claim.lineItems.every((l: { policyFlag: unknown }) => !l.policyFlag)).toBe(true);

    const audit = auditForEntity(h.db, "claim", claimId);
    expect(audit.some((a) => a.action === "claim.exception_override")).toBe(true);

    const notifs = notificationsFor(h.db, DEMO.employee.id);
    expect(notifs.some((n) => n.claimId === claimId)).toBe(true);
  });

  // (b) override without a justification comment is rejected.
  it("rejects an override submitted without a justification comment", async () => {
    const claimId = await createFlaggedClaim();
    const res = await authedPost(h.app, `/api/finance/exceptions/${claimId}/resolve`, financeCookie, {
      action: "override",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("comment_required");
  });
});

describe("reject", () => {
  // (c) reject requires a comment.
  it("rejects a reject decision submitted without a comment", async () => {
    const claimId = await createFlaggedClaim();
    const res = await authedPost(h.app, `/api/finance/exceptions/${claimId}/resolve`, financeCookie, {
      action: "reject",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("comment_required");
  });

  // (c) reject returns the claim to the employee as Action Required and notifies them.
  it("returns the claim to the employee as action_required and notifies them", async () => {
    const claimId = await createFlaggedClaim();
    const res = await authedPost(h.app, `/api/finance/exceptions/${claimId}/resolve`, financeCookie, {
      action: "reject",
      comment: "Missing an itemised bill — please resubmit with receipt.",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claim.status).toBe("action_required");

    const audit = auditForEntity(h.db, "claim", claimId);
    expect(audit.some((a) => a.action === "claim.exception_rejected")).toBe(true);

    const notifs = notificationsFor(h.db, DEMO.employee.id);
    expect(notifs.some((n) => n.claimId === claimId && n.category === "action")).toBe(true);

    // The employee can now resubmit it, distinct from the #12 approvals flow.
    const claimRes = await authedGet(h.app, `/api/claims/${claimId}/owned`, employeeCookie);
    expect((await claimRes.json()).claim.status).toBe("action_required");
  });
});

describe("payment lifecycle — processing", () => {
  // (d) markClaimProcessing captures method + reference.
  it("captures the payment method and reference when transitioning to processing", async () => {
    const claimId = await createCleanClaim();
    const res = await authedPost(h.app, `/api/finance/payments/${claimId}/processing`, financeCookie, {
      method: "bank_transfer",
      reference: "TRX-00123",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claim.status).toBe("processing");
    expect(body.payment.method).toBe("bank_transfer");
    expect(body.payment.referenceNumber).toBe("TRX-00123");
    expect(body.payment.status).toBe("processing");

    const row = h.db.select().from(paymentsTable).all().find((p) => p.claimId === claimId);
    expect(row?.method).toBe("bank_transfer");

    const notifs = notificationsFor(h.db, DEMO.employee.id);
    expect(notifs.some((n) => n.claimId === claimId && n.category === "payment")).toBe(true);
  });

  // (d) processing without a preceding Approved state is a stale conflict.
  it("rejects marking a draft/pending claim as processing", async () => {
    const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "Not yet approved",
      lineItems: [{ categoryId: "taxi", date: "2026-07-15", amount: 20_000 }],
    });
    const created = await createRes.json();
    const res = await authedPost(h.app, `/api/finance/payments/${created.claim.id}/processing`, financeCookie, {
      method: "bank_transfer",
      reference: "TRX-1",
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("stale_decision");
  });
});

describe("payment lifecycle — paid", () => {
  // (e) markClaimPaid transitions + notifies.
  it("transitions a processing claim to paid and notifies the employee", async () => {
    const claimId = await createCleanClaim();
    await authedPost(h.app, `/api/finance/payments/${claimId}/processing`, financeCookie, {
      method: "check",
      reference: "CHK-1",
    });
    const res = await authedPost(h.app, `/api/finance/payments/${claimId}/paid`, financeCookie, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claim.status).toBe("paid");
    expect(body.payment.status).toBe("paid");
    expect(body.payment.processedBy).toBe(DEMO.finance.id);
    expect(body.payment.processedAt).toBeTruthy();

    const audit = auditForEntity(h.db, "claim", claimId);
    expect(audit.some((a) => a.action === "claim.paid")).toBe(true);

    const notifs = notificationsFor(h.db, DEMO.employee.id);
    expect(notifs.some((n) => n.claimId === claimId && n.title.includes("paid"))).toBe(true);
  });

  // (e)/(f) paid without a preceding processing state is a stale conflict.
  it("rejects marking an approved (never-processed) claim as paid", async () => {
    const claimId = await createCleanClaim();
    const res = await authedPost(h.app, `/api/finance/payments/${claimId}/paid`, financeCookie, {});
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("stale_decision");
  });
});

describe("stale-decision conflicts", () => {
  // (f) resolving an exception on a claim that has moved past Approved.
  it("rejects resolving an exception on a claim no longer approved", async () => {
    const claimId = await createFlaggedClaim();
    await authedPost(h.app, `/api/finance/payments/${claimId}/processing`, financeCookie, {
      method: "bank_transfer",
      reference: "TRX-9",
    });
    const res = await authedPost(h.app, `/api/finance/exceptions/${claimId}/resolve`, financeCookie, {
      action: "override",
      comment: "Too late — already processing.",
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("stale_decision");
  });

  // (f) a second processing attempt on the same claim is a stale conflict.
  it("rejects a second attempt to mark the same claim processing", async () => {
    const claimId = await createCleanClaim();
    const first = await authedPost(h.app, `/api/finance/payments/${claimId}/processing`, financeCookie, {
      method: "bank_transfer",
      reference: "TRX-A",
    });
    expect(first.status).toBe(200);
    const second = await authedPost(h.app, `/api/finance/payments/${claimId}/processing`, financeCookie, {
      method: "bank_transfer",
      reference: "TRX-B",
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("stale_decision");
  });
});

describe("authorization", () => {
  // (g) non-Finance-Admin rejected on the exception queue.
  it("rejects a non-finance caller querying the exception queue", async () => {
    const res = await authedGet(h.app, "/api/finance/exceptions", employeeCookie);
    expect(res.status).toBe(403);
    const resApprover = await authedGet(h.app, "/api/finance/exceptions", approverCookie);
    expect(resApprover.status).toBe(403);
  });

  // (g) non-Finance-Admin rejected on payment endpoints.
  it("rejects a non-finance caller acting on payment endpoints", async () => {
    const claimId = await createCleanClaim();
    const res = await authedPost(h.app, `/api/finance/payments/${claimId}/processing`, employeeCookie, {
      method: "bank_transfer",
      reference: "TRX-Z",
    });
    expect(res.status).toBe(403);
    const paidRes = await authedPost(h.app, `/api/finance/payments/${claimId}/paid`, approverCookie, {});
    expect(paidRes.status).toBe(403);
  });
});

/* ============================================================================
 * SpendFlow — Approval routing + decisioning tests (ticket #12).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvalRoutesTable,
  approvalStepsTable,
} from "../src/db/schema.js";
import { notificationsFor } from "../src/services/notifications.js";
import { auditForEntity } from "../src/services/audit.js";
import {
  DEMO,
  authedGet,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";

let h: Harness;
let employeeCookie: string;
let approverCookie: string;
let financeCookie: string;

/** Insert a route + ordered steps directly (route CRUD is BE-admin, #13-16). */
function insertRoute(
  h: Harness,
  args: {
    id: string;
    categoryId?: string | null;
    isFallback?: boolean;
    steps: Array<{ approverType: "submitter_manager" | "specific_user" | "finance"; approverId?: string | null; label: string }>;
  }
) {
  const now = new Date();
  h.db
    .insert(approvalRoutesTable)
    .values({
      id: args.id,
      name: args.id,
      matchMinAmount: null,
      matchMaxAmount: null,
      matchCategoryId: args.categoryId ?? null,
      matchDepartment: null,
      isFallback: args.isFallback ?? false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  args.steps.forEach((s, i) => {
    h.db
      .insert(approvalStepsTable)
      .values({
        id: `${args.id}-s${i}`,
        routeId: args.id,
        orderIndex: i,
        approverType: s.approverType,
        approverId: s.approverId ?? null,
        label: s.label,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}

async function createAndSubmit(
  cookie: string,
  categoryId: string,
  amount: number,
  title = "Route test claim"
): Promise<{ claimId: string }> {
  const res = await authedPost(h.app, "/api/claims", cookie, {
    title,
    lineItems: [{ categoryId, date: "2026-07-15", amount }],
  });
  const created = await res.json();
  const submitRes = await authedPost(h.app, `/api/claims/${created.claim.id}/submit`, cookie, {});
  expect(submitRes.status).toBe(200);
  return { claimId: created.claim.id };
}

beforeEach(async () => {
  h = await bootstrap();
  employeeCookie = (await login(h.app, DEMO.employee.email)).cookie!;
  approverCookie = (await login(h.app, DEMO.approver.email)).cookie!;
  financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
});
afterEach(() => h.cleanup());

describe("approval route resolution", () => {
  // AC (#12, Route/Step Resolution Engine, positive #1): a claim submitted
  // with a given category resolves to the correct configured route + first
  // step (not the fallback).
  it("resolves a claim to the specific matching route over the fallback", async () => {
    insertRoute(h, {
      id: "rt-hotel",
      categoryId: "hotel",
      steps: [{ approverType: "submitter_manager", label: "Manager" }],
    });
    const { claimId } = await createAndSubmit(employeeCookie, "hotel", 300_000);
    const claim = await authedGet(h.app, `/api/claims/${claimId}`, employeeCookie).then((r) => r.json());
    expect(claim.claim.approvalRouteId).toBe("rt-hotel");
    expect(claim.claim.currentStepIndex).toBe(0);
  });

  // AC (#12, Route/Step Resolution Engine, positive #2): a claim matching no
  // specific route falls back to the default route rather than failing.
  it("falls back to the default route when no specific route matches", async () => {
    insertRoute(h, {
      id: "rt-hotel-2",
      categoryId: "hotel",
      steps: [{ approverType: "submitter_manager", label: "Manager" }],
    });
    const { claimId } = await createAndSubmit(employeeCookie, "other", 40_000);
    const claim = await authedGet(h.app, `/api/claims/${claimId}`, employeeCookie).then((r) => r.json());
    expect(claim.claim.approvalRouteId).toBe("rt-default");
  });

  // AC (#12, Route/Step Resolution Engine, negative #1): no matching route
  // and no configured fallback fails submission with a clear config error.
  it("fails submission with a configuration error when no route (incl. fallback) matches", async () => {
    // Disable the seeded fallback so nothing can resolve.
    h.db
      .update(approvalRoutesTable)
      .set({ active: false })
      .run();
    insertRoute(h, {
      id: "rt-hotel-3",
      categoryId: "hotel",
      steps: [{ approverType: "submitter_manager", label: "Manager" }],
    });
    const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
      title: "Unroutable claim",
      lineItems: [{ categoryId: "other", date: "2026-07-15", amount: 10_000 }],
    });
    const created = await createRes.json();
    const submitRes = await authedPost(h.app, `/api/claims/${created.claim.id}/submit`, employeeCookie, {});
    expect(submitRes.status).toBe(503);
    const body = await submitRes.json();
    expect(body.error.code).toBe("routing_failed");
  });

  // AC (#12, Route/Step Resolution Engine, negative #2): re-resolving the
  // same claim's route twice (e.g. resubmit) yields the same assignment.
  it("re-resolving via resubmit yields the same route deterministically", async () => {
    insertRoute(h, {
      id: "rt-hotel-4",
      categoryId: "hotel",
      steps: [
        { approverType: "submitter_manager", label: "Manager" },
        { approverType: "finance", label: "Finance" },
      ],
    });
    const { claimId } = await createAndSubmit(employeeCookie, "hotel", 300_000);
    // Approver returns it for changes, employee resubmits without altering it.
    await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, approverCookie, {
      action: "request_changes",
      comment: "Please add a note",
    });
    const resubmitRes = await authedPost(h.app, `/api/claims/${claimId}/resubmit`, employeeCookie, {});
    expect(resubmitRes.status).toBe(200);
    const body = await resubmitRes.json();
    expect(body.claim.approvalRouteId).toBe("rt-hotel-4");
    expect(body.claim.currentStepIndex).toBe(0);
  });
});

describe("approver inbox scoping", () => {
  // AC (#12, Approver Inbox Query API, positive #1 / negative #2): two
  // approvers with non-overlapping steps each see only their own claims.
  it("scopes inbox results to the authenticated approver's step, not the other approver's", async () => {
    insertRoute(h, {
      id: "rt-hotel-5",
      categoryId: "hotel",
      steps: [{ approverType: "submitter_manager", label: "Manager" }],
    });
    insertRoute(h, {
      id: "rt-flight-5",
      categoryId: "flight",
      steps: [{ approverType: "specific_user", approverId: DEMO.finance.id, label: "Finance review" }],
    });
    const { claimId: hotelClaimId } = await createAndSubmit(employeeCookie, "hotel", 300_000, "Hotel claim");
    const { claimId: flightClaimId } = await createAndSubmit(employeeCookie, "flight", 300_000, "Flight claim");

    const approverInbox = await authedGet(h.app, "/api/approver/inbox", approverCookie).then((r) => r.json());
    const approverIds = approverInbox.items.map((i: { id: string }) => i.id);
    expect(approverIds).toContain(hotelClaimId);
    expect(approverIds).not.toContain(flightClaimId);

    const financeInbox = await authedGet(h.app, "/api/approver/inbox", financeCookie).then((r) => r.json());
    const financeIds = financeInbox.items.map((i: { id: string }) => i.id);
    expect(financeIds).toContain(flightClaimId);
    expect(financeIds).not.toContain(hotelClaimId);
  });

  // AC (#12, Approver Inbox Query API, positive #2): inbox results sort by
  // submission date or amount per the requested sort parameter.
  it("sorts inbox results by amount ascending/descending on request", async () => {
    await createAndSubmit(employeeCookie, "other", 50_000, "Small claim");
    await createAndSubmit(employeeCookie, "other", 500_000, "Big claim");

    const asc = await authedGet(h.app, "/api/approver/inbox?sort_by=amount&sort_dir=asc", approverCookie).then((r) => r.json());
    const ascAmounts = asc.items.map((i: { totalAmount: number }) => i.totalAmount);
    expect(ascAmounts).toEqual([...ascAmounts].sort((a, b) => a - b));

    const desc = await authedGet(h.app, "/api/approver/inbox?sort_by=amount&sort_dir=desc", approverCookie).then((r) => r.json());
    const descAmounts = desc.items.map((i: { totalAmount: number }) => i.totalAmount);
    expect(descAmounts).toEqual([...descAmounts].sort((a, b) => b - a));
  });

  // AC (#12, Approver Inbox Query API, negative #1): a decided claim no
  // longer appears in any subsequent inbox query for that approver.
  it("removes a decided claim from the inbox on subsequent queries", async () => {
    const { claimId } = await createAndSubmit(employeeCookie, "other", 50_000);
    let inbox = await authedGet(h.app, "/api/approver/inbox", approverCookie).then((r) => r.json());
    expect(inbox.items.map((i: { id: string }) => i.id)).toContain(claimId);

    await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, approverCookie, { action: "approve" });

    inbox = await authedGet(h.app, "/api/approver/inbox", approverCookie).then((r) => r.json());
    expect(inbox.items.map((i: { id: string }) => i.id)).not.toContain(claimId);
  });
});

describe("decision API", () => {
  // AC (#12, Decision API, positive #1): approving through all steps of a
  // multi-step route advances the claim to Approved and notifies Finance.
  it("advances a multi-step route on approve and finalises to Approved on the last step", async () => {
    insertRoute(h, {
      id: "rt-multi",
      categoryId: "hotel",
      steps: [
        { approverType: "submitter_manager", label: "Manager" },
        { approverType: "finance", label: "Finance" },
      ],
    });
    const { claimId } = await createAndSubmit(employeeCookie, "hotel", 300_000);

    const step1 = await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, approverCookie, { action: "approve" });
    expect(step1.status).toBe(200);
    const step1Body = await step1.json();
    expect(step1Body.advanced).toBe(true);
    expect(step1Body.finalised).toBe(false);
    expect(step1Body.claim.currentStepIndex).toBe(1);
    // Next approver (finance) should have been notified.
    const financeNotifs = notificationsFor(h.db, DEMO.finance.id);
    expect(financeNotifs.some((n) => n.claimId === claimId)).toBe(true);

    const step2 = await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, financeCookie, { action: "approve" });
    expect(step2.status).toBe(200);
    const step2Body = await step2.json();
    expect(step2Body.finalised).toBe(true);
    expect(step2Body.claim.status).toBe("approved");
  });

  // AC (#12, Decision API, positive #2): rejecting a claim attaches the
  // comment and writes an audit_log entry.
  it("rejects a claim, records the comment, and writes an audit_log entry", async () => {
    const { claimId } = await createAndSubmit(employeeCookie, "other", 50_000);
    const res = await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, approverCookie, {
      action: "reject",
      comment: "Missing business justification",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claim.status).toBe("rejected");

    const audit = auditForEntity(h.db, "claim", claimId);
    expect(audit.some((a) => a.action === "claim.rejected")).toBe(true);
  });

  // AC (#12, Decision API, negative #1): reject/request-changes without a
  // comment is rejected with a validation error.
  it("rejects a reject/request_changes decision submitted without a comment", async () => {
    const { claimId } = await createAndSubmit(employeeCookie, "other", 50_000);
    const res = await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, approverCookie, {
      action: "reject",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("comment_required");
  });

  // AC (#12, Decision API, negative #2): an approver deciding on a claim not
  // currently at their step is rejected with an authorization error.
  it("rejects a decision from an approver not at the claim's current step", async () => {
    insertRoute(h, {
      id: "rt-flight-only-finance",
      categoryId: "flight",
      steps: [{ approverType: "specific_user", approverId: DEMO.finance.id, label: "Finance review" }],
    });
    const { claimId } = await createAndSubmit(employeeCookie, "flight", 300_000);
    // DEMO.approver is not the specific_user assigned to this route/step.
    const res = await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, approverCookie, {
      action: "approve",
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("stale_decision");
  });

  // AC (#12, Decision API, negative #3): attempting to act twice on the same
  // claim/step is rejected on the second attempt with a conflict error.
  it("rejects a second decision attempt once the claim has already moved past that step", async () => {
    insertRoute(h, {
      id: "rt-multi-2",
      categoryId: "hotel",
      steps: [
        { approverType: "submitter_manager", label: "Manager" },
        { approverType: "finance", label: "Finance" },
      ],
    });
    const { claimId } = await createAndSubmit(employeeCookie, "hotel", 300_000);
    const first = await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, approverCookie, { action: "approve" });
    expect(first.status).toBe(200);

    // The approver tries to decide again — the claim already advanced past
    // their step, so this must fail even though it's the same claim/actor.
    const second = await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, approverCookie, { action: "approve" });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("stale_decision");

    // Also rejected once the claim is fully finalised (no longer pending).
    await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, financeCookie, { action: "approve" });
    const third = await authedPost(h.app, `/api/approver/claims/${claimId}/decisions`, financeCookie, { action: "approve" });
    expect(third.status).toBe(409);
  });
});

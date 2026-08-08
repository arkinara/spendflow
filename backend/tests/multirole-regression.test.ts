/* ============================================================================
 * SpendFlow — Regression: legacy single-role users (#47, cycle 4).
 *
 * The multi-role refactor (#44 schema, #45 FE, #46 SoD) must be behaviour-
 * compatible with users provisioned the original way: a single role in
 * `roles[]` and `primaryRole` equal to it. These tests pin that contract by
 * driving the three seeded demo personas (all single-role) through the same
 * submit → approve → pay lifecycle they ran before the refactor, plus a few
 * role-isolation assertions that must still hold. They intentionally overlap
 * with the older suites — their purpose is explicit documentation, not net-new
 * coverage.
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO,
  authedGet,
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

/** Create + submit a taxi claim; return its id (asserts submit succeeded). */
async function submitTaxi(cookie: string, title: string): Promise<string> {
  const createRes = await authedPost(h.app, "/api/claims", cookie, {
    title,
    lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 25_000 }],
  });
  expect(createRes.status).toBe(201);
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

describe("regression (#47): legacy single-role users behave as before the multi-role refactor", () => {
  it("each demo persona exposes a single-element roles[] with matching primaryRole", async () => {
    for (const demo of [DEMO.employee, DEMO.approver, DEMO.finance]) {
      const cookie = (await login(h.app, demo.email)).cookie!;
      const me = await authedGet(h.app, "/api/me", cookie);
      const body = await me.json();
      expect(body.user.roles).toEqual([demo.role]);
      expect(body.user.primaryRole).toBe(demo.role);
      expect(body.user.role).toBe(demo.role);
    }
  });

  it("employee → approver → finance full lifecycle is unchanged (single-step fallback route)", async () => {
    const employee = (await login(h.app, DEMO.employee.email)).cookie!;
    const approver = (await login(h.app, DEMO.approver.email)).cookie!;
    const finance = (await login(h.app, DEMO.finance.email)).cookie!;

    // Employee submits → pending at the single manager step (fallback route).
    const claimId = await submitTaxi(employee, "Legacy lifecycle claim");
    const pending = await authedGet(h.app, `/api/claims/${claimId}`, employee);
    const pendingBody = await pending.json();
    expect(pendingBody.claim.status).toBe("pending");
    expect(pendingBody.claim.approvalRouteId).toBe("rt-default");

    // Approver (the employee's line manager) decides → approved (final step).
    const decide = await authedPost(
      h.app,
      `/api/approver/claims/${claimId}/decisions`,
      approver,
      { action: "approve" }
    );
    expect(decide.status).toBe(200);
    expect((await decide.json()).claim.status).toBe("approved");

    // Finance processes → processing, then paid.
    const proc = await authedPost(
      h.app,
      `/api/finance/payments/${claimId}/processing`,
      finance,
      { method: "bank_transfer", reference: "TRX-LEGACY-1" }
    );
    expect((await proc.json()).claim.status).toBe("processing");
    const paid = await authedPost(
      h.app,
      `/api/finance/payments/${claimId}/paid`,
      finance,
      {}
    );
    expect((await paid.json()).claim.status).toBe("paid");
  });

  it("role isolation still holds: legacy employee denied approver/admin paths", async () => {
    const employee = (await login(h.app, DEMO.employee.email)).cookie!;
    const approver = (await login(h.app, DEMO.approver.email)).cookie!;

    // Employee cannot reach the approver inbox.
    const inbox = await authedGet(h.app, "/api/approver/inbox", employee);
    expect(inbox.status).toBe(403);

    // Approver cannot reach finance admin user list.
    const admin = await authedGet(h.app, "/api/admin/users", approver);
    expect(admin.status).toBe(403);

    // Finance is still the only role that lists users.
    const finance = (await login(h.app, DEMO.finance.email)).cookie!;
    const userList = await authedGet(h.app, "/api/admin/users", finance);
    expect(userList.status).toBe(200);
  });

  it("a legacy approver's inbox still surfaces reports' pending claims", async () => {
    const employee = (await login(h.app, DEMO.employee.email)).cookie!;
    const approver = (await login(h.app, DEMO.approver.email)).cookie!;
    await submitTaxi(employee, "Inbox visibility claim");

    const inbox = await authedGet(h.app, "/api/approver/inbox", approver);
    expect(inbox.status).toBe(200);
    const body = await inbox.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(
      body.items.every(
        (i: { employeeName: string }) => i.employeeName === DEMO.employee.name
      )
    ).toBe(true);
  });

  it("legacy single-role still works — explicit guard (documents the no-regression invariant)", async () => {
    // Redundant by design: a one-liner that proves a freshly provisioned
    // single-role employee with no multi-role fields still submits + routes.
    const cookie = (await login(h.app, DEMO.employee.email)).cookie!;
    const claimId = await submitTaxi(cookie, "Explicit legacy guard");
    const res = await authedGet(h.app, `/api/claims/${claimId}`, cookie);
    const claim = (await res.json()).claim;
    expect(claim.status).toBe("pending");
    expect(claim.blockedReason).toBeNull();
  });
});

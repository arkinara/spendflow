/* ============================================================================
 * SpendFlow — mobile inbox decision tests (ticket #100).
 *
 * Exercises POST /api/mobile/inbox/:id/decide end-to-end. The mobile inbox
 * item id IS the claim id; the endpoint reuses the web's decision engine, so
 * the state transition + audit + notification rows match the web path exactly.
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";

let h: Harness;
let approverCookie: string;

const WARUNG_DRAFT = {
  merchant: "Warung Sederhana",
  date: "15/07/2026",
  amount: "150.000",
  tax: "15.000",
  currency: "IDR",
  category: "Meals",
  description: "Team dinner with PT Nusantara",
};

/** Submit a claim as the demo employee and return its id (routed to the manager approver). */
async function submitPendingClaim(h: Harness, employeeCookie: string): Promise<string> {
  const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, WARUNG_DRAFT);
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.claim.status).toBe("pending");
  return body.claim.id;
}

beforeEach(async () => {
  h = await bootstrap();
  const approverLogin = await login(h.app, DEMO.approver.email);
  expect(approverLogin.status).toBe(200);
  approverCookie = approverLogin.cookie!;
});
afterEach(() => h.cleanup());

describe("POST /api/mobile/inbox/:id/decide", () => {
  it("approves a pending claim at the approver's step (200 + outcome)", async () => {
    const employeeLogin = await login(h.app, DEMO.employee.email);
    const claimId = await submitPendingClaim(h, employeeLogin.cookie!);

    const res = await authedPost(h.app, `/api/mobile/inbox/${claimId}/decide`, approverCookie, {
      decision: "approve",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome.action).toBe("approve");
    expect(body.outcome.finalised).toBe(true);
    expect(body.outcome.claim.status).toBe("approved");
    expect(body.outcome.claim.id).toBe(claimId);
  });

  it("rejects a pending claim (200, claim → rejected)", async () => {
    const employeeLogin = await login(h.app, DEMO.employee.email);
    const claimId = await submitPendingClaim(h, employeeLogin.cookie!);

    const res = await authedPost(h.app, `/api/mobile/inbox/${claimId}/decide`, approverCookie, {
      decision: "reject",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome.action).toBe("reject");
    expect(body.outcome.finalised).toBe(true);
    expect(body.outcome.claim.status).toBe("rejected");
  });

  it("rejects an invalid decision value with 400 invalid_decision", async () => {
    const employeeLogin = await login(h.app, DEMO.employee.email);
    const claimId = await submitPendingClaim(h, employeeLogin.cookie!);

    const res = await authedPost(h.app, `/api/mobile/inbox/${claimId}/decide`, approverCookie, {
      decision: "maybe",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_decision");
  });

  it("rejects an employee with 403 (approvers + finance only)", async () => {
    const employeeLogin = await login(h.app, DEMO.employee.email);
    const claimId = await submitPendingClaim(h, employeeLogin.cookie!);

    const res = await authedPost(h.app, `/api/mobile/inbox/${claimId}/decide`, employeeLogin.cookie!, {
      decision: "approve",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 404 for a nonexistent claim id", async () => {
    const res = await authedPost(h.app, "/api/mobile/inbox/clm-does-not-exist/decide", approverCookie, {
      decision: "approve",
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });
});

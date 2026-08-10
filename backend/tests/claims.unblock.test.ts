/* ============================================================================
 * SpendFlow — Finance Admin SoD-unblock tests (ticket #48).
 *
 * Covers PATCH /api/admin/claims/:id/unblock: a `blocked_sod` claim (#46) is
 * returned to `pending` by either assigning the submitter a manager or
 * reassigning a route step's approver. Defence in depth — if the chosen
 * assignment still trips SoD, the mutation rolls back and the BE returns 409
 * `still_blocked`.
 * ========================================================================== */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvalRoutesTable,
  approvalStepsTable,
  claimsTable,
  usersTable,
} from "../src/db/schema.js";
import { auditForEntity } from "../src/services/audit.js";
import {
  DEMO,
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

/** Insert an active, non-fallback route matching every claim (minAmount 0). */
function insertRoute(
  steps: Array<{
    id: string;
    approverType: "submitter_manager" | "specific_user" | "finance";
    approverId?: string | null;
    label: string;
  }>,
  routeId = "rt-unblock-test"
) {
  const now = new Date();
  h.db.transaction((tx) => {
    tx.insert(approvalRoutesTable)
      .values({
        id: routeId,
        name: "Unblock test route",
        matchMinAmount: 0,
        matchMaxAmount: null,
        matchDepartment: null,
        isFallback: false,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    steps.forEach((s, i) => {
      tx.insert(approvalStepsTable)
        .values({
          id: s.id,
          routeId,
          orderIndex: i,
          approverType: s.approverType,
          approverId: s.approverId ?? null,
          label: s.label,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  });
}

/** Create + submit a taxi claim as the logged-in employee, return the claim id. */
async function submitClaim(cookie: string): Promise<string> {
  const createRes = await authedPost(h.app, "/api/claims", cookie, {
    title: "Unblock test claim",
    lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 30_000 }],
  });
  const created = await createRes.json();
  const submitRes = await authedPost(
    h.app,
    `/api/claims/${created.claim.id}/submit`,
    cookie,
    {}
  );
  const body = await submitRes.json();
  expect(body.claim.status).toBe("blocked_sod");
  return created.claim.id as string;
}

/**
 * Land a claim in `blocked_sod` via the `no_manager` path: a submitter with no
 * manager on the default `submitter_manager` fallback route. Returns the claim
 * id and the submitter's id.
 */
async function blockByNoManager(
  submitterId: string,
  email: string
): Promise<{ claimId: string; submitterId: string }> {
  const cookie = (await login(h.app, email)).cookie!;
  return { claimId: await submitClaim(cookie), submitterId };
}

/**
 * Land a claim in `blocked_sod` via the `self_approval` path: a single
 * `specific_user` step pinned to the submitter themselves. Returns the claim id
 * and the step id (for the reassign_step action).
 */
async function blockBySelfPinnedStep(
  submitterId: string,
  email: string,
  opts: { stepId?: string; routeId?: string } = {}
): Promise<{ claimId: string; stepId: string; submitterId: string }> {
  const stepId = opts.stepId ?? "rt-self-s0";
  const routeId = opts.routeId ?? "rt-self-pin";
  insertRoute(
    [
      {
        id: stepId,
        approverType: "specific_user",
        approverId: submitterId,
        label: "Self approve",
      },
    ],
    routeId
  );
  const cookie = (await login(h.app, email)).cookie!;
  const claimId = await submitClaim(cookie);
  return { claimId, stepId, submitterId };
}

/* ======================================================================== == */
/* Happy paths                                                                  */
/* ======================================================================== == */

describe("unblock: happy paths", () => {
  it("assign_manager — blocked (no_manager) → pending + audit + submitter gains manager", async () => {
    await provisionSeedUser(h, {
      id: "u-nomgr",
      name: "No Manager",
      email: "nomgr@spendflow.example",
      role: "employee",
    });
    const { claimId, submitterId } = await blockByNoManager(
      "u-nomgr",
      "nomgr@spendflow.example"
    );

    const financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedPatch(
      h.app,
      `/api/admin/claims/${claimId}/unblock`,
      financeCookie,
      {
        resolution: "Assigned Dewi as Aulia's manager after the org change.",
        action: "assign_manager",
        managerId: DEMO.approver.id,
        password: DEMO.password,
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claim.status).toBe("pending");
    expect(body.claim.blockedReason).toBeNull();

    // The managerId mutation persists on the submitter (SoD-clear assignment).
    const submitter = h.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, submitterId))
      .get();
    expect(submitter?.managerId).toBe(DEMO.approver.id);

    const audit = auditForEntity(h.db, "claim", claimId);
    expect(audit.some((a) => a.action === "claim.unblocked")).toBe(true);
  });

  it("reassign_step — blocked (self_approval) → pending + step approver updated + audit", async () => {
    await provisionSeedUser(h, {
      id: "u-selfpin",
      name: "Self Pin",
      email: "selfpin@spendflow.example",
      role: "employee",
      managerId: DEMO.approver.id,
    });
    const { claimId, stepId } = await blockBySelfPinnedStep(
      "u-selfpin",
      "selfpin@spendflow.example"
    );

    const financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedPatch(
      h.app,
      `/api/admin/claims/${claimId}/unblock`,
      financeCookie,
      {
        resolution: "Repointed the self-pinned step to a different approver.",
        action: "reassign_step",
        stepId,
        newApproverId: DEMO.approver.id,
        password: DEMO.password,
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claim.status).toBe("pending");

    // The step mutation persists on the route (the self-pin is overwritten).
    const step = h.db
      .select()
      .from(approvalStepsTable)
      .where(eq(approvalStepsTable.id, stepId))
      .get();
    expect(step?.approverId).toBe(DEMO.approver.id);

    const audit = auditForEntity(h.db, "claim", claimId);
    expect(audit.some((a) => a.action === "claim.unblocked")).toBe(true);
  });
});

/* ======================================================================== == */
/* Defence in depth: still_blocked rollback                                     */
/* ======================================================================== == */

describe("unblock: still_blocked rollback", () => {
  it("assign_manager to the submitter themselves → 409 still_blocked, managerId rolled back", async () => {
    // A multi-role employee+approver so the manager-validation gate passes,
    // but the SoD check still catches the self-reference.
    await provisionSeedUser(h, {
      id: "u-selfmgr",
      name: "Self Manager",
      email: "selfmgr@spendflow.example",
      role: "employee",
      roles: ["employee", "approver"],
    });
    const { claimId, submitterId } = await blockByNoManager(
      "u-selfmgr",
      "selfmgr@spendflow.example"
    );

    const financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedPatch(
      h.app,
      `/api/admin/claims/${claimId}/unblock`,
      financeCookie,
      {
        resolution: "Trying to set the submitter as their own manager.",
        action: "assign_manager",
        managerId: "u-selfmgr",
        password: DEMO.password,
      }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("still_blocked");

    // The managerId mutation was rolled back inside the transaction.
    const submitter = h.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, submitterId))
      .get();
    expect(submitter?.managerId).toBeNull();

    // The claim stays blocked (nothing committed).
    const claimRow = h.db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, claimId))
      .get();
    expect(claimRow?.status).toBe("blocked_sod");
  });
});

/* ======================================================================== == */
/* Authorization + validation                                                    */
/* ======================================================================== == */

describe("unblock: authorization + validation", () => {
  it("403 — a non-Finance role cannot unblock", async () => {
    await provisionSeedUser(h, {
      id: "u-nomgr",
      name: "No Manager",
      email: "nomgr@spendflow.example",
      role: "employee",
    });
    const { claimId } = await blockByNoManager(
      "u-nomgr",
      "nomgr@spendflow.example"
    );

    // The employee themselves (not Finance) tries to unblock their own claim.
    const employeeCookie = (await login(h.app, "nomgr@spendflow.example")).cookie!;
    const res = await authedPatch(
      h.app,
      `/api/admin/claims/${claimId}/unblock`,
      employeeCookie,
      {
        resolution: "please",
        action: "assign_manager",
        managerId: DEMO.approver.id,
      }
    );
    expect(res.status).toBe(403);
  });

  it("404 — unknown claim id", async () => {
    const financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedPatch(
      h.app,
      `/api/admin/claims/clm-does-not-exist/unblock`,
      financeCookie,
      {
        resolution: "x",
        action: "assign_manager",
        managerId: DEMO.approver.id,
        password: DEMO.password,
      }
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("400 — empty resolution rejected at the schema layer", async () => {
    await provisionSeedUser(h, {
      id: "u-nomgr",
      name: "No Manager",
      email: "nomgr@spendflow.example",
      role: "employee",
    });
    const { claimId } = await blockByNoManager(
      "u-nomgr",
      "nomgr@spendflow.example"
    );

    const financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedPatch(
      h.app,
      `/api/admin/claims/${claimId}/unblock`,
      financeCookie,
      {
        resolution: "",
        action: "assign_manager",
        managerId: DEMO.approver.id,
      }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_body");
  });

  it("400 — invalid action enum rejected", async () => {
    await provisionSeedUser(h, {
      id: "u-nomgr",
      name: "No Manager",
      email: "nomgr@spendflow.example",
      role: "employee",
    });
    const { claimId } = await blockByNoManager(
      "u-nomgr",
      "nomgr@spendflow.example"
    );

    const financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedPatch(
      h.app,
      `/api/admin/claims/${claimId}/unblock`,
      financeCookie,
      {
        resolution: "x",
        action: "magic",
        managerId: DEMO.approver.id,
      }
    );
    expect(res.status).toBe(400);
  });

  it("409 not_blocked — a non-blocked claim cannot be unblocked", async () => {
    // Submit a clean claim (employee with a manager → pending).
    const empCookie = (await login(h.app, DEMO.employee.email)).cookie!;
    const createRes = await authedPost(h.app, "/api/claims", empCookie, {
      title: "Clean claim",
      lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 30_000 }],
    });
    const created = await createRes.json();
    await authedPost(
      h.app,
      `/api/claims/${created.claim.id}/submit`,
      empCookie,
      {}
    );

    const financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedPatch(
      h.app,
      `/api/admin/claims/${created.claim.id}/unblock`,
      financeCookie,
      {
        resolution: "x",
        action: "assign_manager",
        managerId: DEMO.approver.id,
        password: DEMO.password,
      }
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("not_blocked");
  });
});

/* ======================================================================== == */
/* Audit shape                                                                  */
/* ======================================================================== == */

describe("unblock: audit entry", () => {
  it("records claim.unblocked with before (blocked_sod) + after (pending, resolution, action, managerId, routeId)", async () => {
    await provisionSeedUser(h, {
      id: "u-nomgr",
      name: "No Manager",
      email: "nomgr@spendflow.example",
      role: "employee",
    });
    const { claimId } = await blockByNoManager(
      "u-nomgr",
      "nomgr@spendflow.example"
    );

    const financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
    await authedPatch(
      h.app,
      `/api/admin/claims/${claimId}/unblock`,
      financeCookie,
      {
        resolution: "Audit trail check — assigned Dewi as manager.",
        action: "assign_manager",
        managerId: DEMO.approver.id,
        password: DEMO.password,
      }
    );

    const audit = auditForEntity(h.db, "claim", claimId);
    const entry = audit.find((a) => a.action === "claim.unblocked");
    expect(entry).toBeDefined();
    expect(entry!.actorId).toBe(DEMO.finance.id);
    expect(entry!.before.status).toBe("blocked_sod");
    expect(entry!.before.blocked_reason).toBeTruthy();
    expect(entry!.after.status).toBe("pending");
    expect(entry!.after.action).toBe("assign_manager");
    expect(entry!.after.managerId).toBe(DEMO.approver.id);
    expect(entry!.after.resolution).toContain("assigned Dewi");
    expect(entry!.after.routeId).toBeTruthy();
  });
});

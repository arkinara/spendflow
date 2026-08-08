/* ============================================================================
 * SpendFlow — Segregation-of-duties enforcement tests (ticket #46).
 *
 * Covers resolveRouteSteps + the applySubmission SoD branch: a claim whose
 * route resolves a step to the submitter (or needs a manager the submitter
 * lacks) lands in `blocked_sod` with an audit entry instead of `pending`.
 * ========================================================================== */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalRoutesTable, approvalStepsTable, usersTable } from "../src/db/schema.js";
import { auditForEntity } from "../src/services/audit.js";
import { resolveRouteSteps, SoDError } from "../src/services/claims.js";
import {
  DEMO,
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
  routeId = "rt-sod-test"
) {
  const now = new Date();
  h.db.transaction((tx) => {
    tx.insert(approvalRoutesTable)
      .values({
        id: routeId,
        name: "SoD test route",
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

/** Create + submit a taxi claim as the given logged-in employee. */
async function submitClaim(cookie: string) {
  const createRes = await authedPost(h.app, "/api/claims", cookie, {
    title: "SoD test claim",
    lineItems: [{ categoryId: "taxi", date: "2026-08-01", amount: 30_000 }],
  });
  const created = await createRes.json();
  const submitRes = await authedPost(
    h.app,
    `/api/claims/${created.claim.id}/submit`,
    cookie,
    {}
  );
  return { createRes, submitRes, claimId: created.claim.id as string };
}

describe("SoD: claim submission", () => {
  it("happy path — submitter with a manager routes to pending", async () => {
    const cookie = (await login(h.app, DEMO.employee.email)).cookie!;
    const { submitRes } = await submitClaim(cookie);
    expect(submitRes.status).toBe(200);
    const body = await submitRes.json();
    expect(body.claim.status).toBe("pending");
    expect(body.claim.blockedReason).toBeNull();
  });

  it("no_manager — submitter with no manager on a submitter_manager route lands blocked_sod", async () => {
    await provisionSeedUser(h, {
      id: "u-nomgr",
      name: "No Manager",
      email: "nomgr@spendflow.example",
      role: "employee",
    });
    const cookie = (await login(h.app, "nomgr@spendflow.example")).cookie!;
    const { submitRes, claimId } = await submitClaim(cookie);
    expect(submitRes.status).toBe(200);
    const body = await submitRes.json();
    expect(body.claim.status).toBe("blocked_sod");
    expect(body.claim.blockedReason).toContain("no manager");

    const audit = auditForEntity(h.db, "claim", claimId);
    expect(audit.some((a) => a.action === "claim.blocked_sod")).toBe(true);
    const blockEntry = audit.find((a) => a.action === "claim.blocked_sod")!;
    expect(blockEntry.after.code).toBe("no_manager");
  });

  it("self_approval — specific_user step pinned to the submitter lands blocked_sod", async () => {
    insertRoute([
      {
        id: "rt-sod-spec",
        approverType: "specific_user",
        approverId: DEMO.employee.id,
        label: "Self approve",
      },
    ]);
    const cookie = (await login(h.app, DEMO.employee.email)).cookie!;
    const { submitRes, claimId } = await submitClaim(cookie);
    expect(submitRes.status).toBe(200);
    const body = await submitRes.json();
    expect(body.claim.status).toBe("blocked_sod");
    expect(body.claim.blockedReason).toContain("Self approve");

    const audit = auditForEntity(h.db, "claim", claimId);
    const blockEntry = audit.find((a) => a.action === "claim.blocked_sod")!;
    expect(blockEntry.after.code).toBe("self_approval");
  });

  it("self_approval — submitter_manager step where managerId === submitter (defence in depth)", async () => {
    await provisionSeedUser(h, {
      id: "u-selfmgr",
      name: "Self Manager",
      email: "selfmgr@spendflow.example",
      role: "employee",
      managerId: DEMO.approver.id,
    });
    // Force the self-reference the UI guard would normally block (#43). The
    // runtime SoD check is the backstop.
    h.db.update(usersTable)
      .set({ managerId: "u-selfmgr" })
      .where(eq(usersTable.id, "u-selfmgr"))
      .run();
    const cookie = (await login(h.app, "selfmgr@spendflow.example")).cookie!;
    const { submitRes } = await submitClaim(cookie);
    expect(submitRes.status).toBe(200);
    const body = await submitRes.json();
    expect(body.claim.status).toBe("blocked_sod");
    expect(body.claim.blockedReason).toContain("Line manager");
  });

  it("self_approval — finance step where the submitter is the sole finance admin lands blocked_sod", async () => {
    insertRoute([
      {
        id: "rt-sod-fin",
        approverType: "finance",
        approverId: null,
        label: "Finance review",
      },
    ]);
    // Ridwan is the only seeded finance user; a finance step he submits can
    // only be actioned by himself → SoD block.
    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const { submitRes, claimId } = await submitClaim(cookie);
    expect(submitRes.status).toBe(200);
    const body = await submitRes.json();
    expect(body.claim.status).toBe("blocked_sod");
    expect(body.claim.blockedReason).toContain("finance admin");

    const audit = auditForEntity(h.db, "claim", claimId);
    expect(audit.some((a) => a.action === "claim.blocked_sod")).toBe(true);
  });
});

describe("SoD: resolveRouteSteps unit", () => {
  it("throws self_approval for a specific_user step pinned to the submitter", () => {
    expect(() =>
      resolveRouteSteps(h.db, [
        { id: "s1", approverType: "specific_user", approverId: DEMO.employee.id, label: "L1", orderIndex: 0 },
      ], { id: DEMO.employee.id, managerId: DEMO.approver.id })
    ).toThrow(SoDError);
  });

  it("throws no_manager for a submitter_manager step when the submitter has no manager", () => {
    try {
      resolveRouteSteps(h.db, [
        { id: "s1", approverType: "submitter_manager", approverId: null, label: "Mgr", orderIndex: 0 },
      ], { id: DEMO.employee.id, managerId: null });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SoDError);
      expect((err as SoDError).code).toBe("no_manager");
    }
  });

  it("passes a clean route through with resolved ids attached", () => {
    const out = resolveRouteSteps(h.db, [
      { id: "s1", approverType: "submitter_manager", approverId: null, label: "Mgr", orderIndex: 0 },
      { id: "s2", approverType: "specific_user", approverId: DEMO.approver.id, label: "Spec", orderIndex: 1 },
    ], { id: DEMO.employee.id, managerId: DEMO.approver.id });
    expect(out).toHaveLength(2);
    expect(out[0].resolvedApproverId).toBe(DEMO.approver.id);
    expect(out[1].resolvedApproverId).toBe(DEMO.approver.id);
  });
});

/* ============================================================================
 * SoD routing matrix (#47). One cell per (submitter role set × step type)
 * combination, each asserting the resolved outcome (pending vs blocked_sod)
 * and, where relevant, the block code. Cells are intentionally compact (~5
 * lines): they exist to document the full decision grid, not to re-prove the
 * service internals already covered above.
 * ========================================================================== */

describe("SoD matrix (#47): submitter roles × step type → outcome", () => {
  /** Provision a submitter with an explicit role set + optional manager. */
  async function seedSubmitter(
    id: string,
    roles: import("../src/types.js").Role[],
    managerId?: string
  ) {
    await provisionSeedUser(h, {
      id,
      name: id,
      email: `${id}@spendflow.example`,
      role: roles[0],
      roles,
      managerId,
    });
    return (await login(h.app, `${id}@spendflow.example`)).cookie!;
  }

  /** Create + submit a matrix claim; return the parsed submit body + id. */
  async function submitAs(cookie: string, title = "Matrix claim") {
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
    return { body: await submitRes.json(), claimId: created.claim.id as string };
  }

  /** Single-step route of the given type, matching every claim. */
  function oneStepRoute(
    approverType: "submitter_manager" | "specific_user" | "finance",
    approverId: string | null = null,
    routeId = "rt-matrix"
  ) {
    insertRoute(
      [{ id: `${routeId}-s0`, approverType, approverId, label: "Matrix step" }],
      routeId
    );
  }

  // row: [employee] + submitter_manager → pending (routes to manager)
  it("[employee] × submitter_manager → pending (routes to manager)", async () => {
    const cookie = await seedSubmitter("u-mx-emp", ["employee"], DEMO.approver.id);
    oneStepRoute("submitter_manager");
    const { body } = await submitAs(cookie);
    expect(body.claim.status).toBe("pending");
    expect(body.claim.blockedReason).toBeNull();
  });

  // row: [employee] + specific_user pinned to another approver → pending
  it("[employee] × specific_user (other approver) → pending", async () => {
    const cookie = await seedSubmitter("u-mx-spec", ["employee"], DEMO.approver.id);
    oneStepRoute("specific_user", DEMO.approver.id);
    const { body } = await submitAs(cookie);
    expect(body.claim.status).toBe("pending");
  });

  // row: [employee] + finance step with >1 finance user → pending
  it("[employee] × finance (multiple finance users) → pending", async () => {
    await provisionSeedUser(h, {
      id: "u-fin-extra",
      name: "Extra Finance",
      email: "finextra@spendflow.example",
      role: "finance",
      roles: ["finance"],
    });
    const cookie = await seedSubmitter("u-mx-finstep", ["employee"], DEMO.approver.id);
    oneStepRoute("finance");
    const { body } = await submitAs(cookie);
    expect(body.claim.status).toBe("pending");
  });

  // row: [employee] + specific_user pinned to self → blocked_sod self_approval
  it("[employee] × specific_user (self) → blocked_sod self_approval", async () => {
    await provisionSeedUser(h, {
      id: "u-mx-self",
      name: "Self Pin",
      email: "selfpin@spendflow.example",
      role: "employee",
      roles: ["employee"],
      managerId: DEMO.approver.id,
    });
    oneStepRoute("specific_user", "u-mx-self", "rt-matrix-self");
    const cookie = (await login(h.app, "selfpin@spendflow.example")).cookie!;
    const { body, claimId } = await submitAs(cookie);
    expect(body.claim.status).toBe("blocked_sod");
    expect(
      auditForEntity(h.db, "claim", claimId).find(
        (a) => a.action === "claim.blocked_sod"
      )!.after.code
    ).toBe("self_approval");
  });

  // row: [employee, approver] + submitter_manager → pending (multi-role routes normally)
  it("[employee, approver] × submitter_manager → pending", async () => {
    const cookie = await seedSubmitter(
      "u-mx-dual",
      ["employee", "approver"],
      DEMO.approver.id
    );
    oneStepRoute("submitter_manager", null, "rt-matrix-dual");
    const { body } = await submitAs(cookie);
    expect(body.claim.status).toBe("pending");
  });

  // row: [employee, approver] + specific_user pinned to self → still blocked (multi-role does not bypass SoD)
  it("[employee, approver] × specific_user (self) → blocked_sod self_approval", async () => {
    await provisionSeedUser(h, {
      id: "u-mx-dual-self",
      name: "Dual Self",
      email: "dualself@spendflow.example",
      role: "employee",
      roles: ["employee", "approver"],
      managerId: DEMO.approver.id,
    });
    oneStepRoute("specific_user", "u-mx-dual-self", "rt-matrix-dual-self");
    const cookie = (await login(h.app, "dualself@spendflow.example")).cookie!;
    const { body } = await submitAs(cookie);
    expect(body.claim.status).toBe("blocked_sod");
  });

  // row: [approver] (with manager) + submitter_manager → pending (an approver can submit too)
  it("[approver] (with manager) × submitter_manager → pending", async () => {
    const cookie = await seedSubmitter(
      "u-mx-appr",
      ["approver"],
      DEMO.approver.id
    );
    oneStepRoute("submitter_manager", null, "rt-matrix-appr");
    const { body } = await submitAs(cookie);
    expect(body.claim.status).toBe("pending");
  });

  // row: [approver] (no manager) + submitter_manager → blocked_sod no_manager
  it("[approver] (no manager) × submitter_manager → blocked_sod no_manager", async () => {
    const cookie = await seedSubmitter("u-mx-appr-nomgr", ["approver"]);
    oneStepRoute("submitter_manager", null, "rt-matrix-appr-nomgr");
    const { body, claimId } = await submitAs(cookie);
    expect(body.claim.status).toBe("blocked_sod");
    expect(
      auditForEntity(h.db, "claim", claimId).find(
        (a) => a.action === "claim.blocked_sod"
      )!.after.code
    ).toBe("no_manager");
  });

  // row: [finance] sole + finance step → blocked_sod self_approval
  it("[finance] (sole) × finance step → blocked_sod self_approval", async () => {
    oneStepRoute("finance", null, "rt-matrix-fin-sole");
    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const { body } = await submitAs(cookie);
    expect(body.claim.status).toBe("blocked_sod");
  });

  // row: [finance] + finance step with another finance present → pending
  it("[finance] (with peer) × finance step → pending", async () => {
    await provisionSeedUser(h, {
      id: "u-fin-peer",
      name: "Finance Peer",
      email: "finpeer@spendflow.example",
      role: "finance",
      roles: ["finance"],
    });
    oneStepRoute("finance", null, "rt-matrix-fin-peer");
    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const { body } = await submitAs(cookie);
    expect(body.claim.status).toBe("pending");
  });

  // row: multi-step route where the FIRST step self-collides → blocked (first conflict wins)
  it("multi-step: first conflicting step blocks even if later steps are clean", async () => {
    await provisionSeedUser(h, {
      id: "u-mx-multi",
      name: "Multi Step",
      email: "multistep@spendflow.example",
      role: "employee",
      roles: ["employee"],
      managerId: DEMO.approver.id,
    });
    insertRoute(
      [
        { id: "ms-s0", approverType: "specific_user", approverId: "u-mx-multi", label: "Self" },
        { id: "ms-s1", approverType: "submitter_manager", label: "Manager" },
      ],
      "rt-matrix-multi"
    );
    const cookie = (await login(h.app, "multistep@spendflow.example")).cookie!;
    const { body, claimId } = await submitAs(cookie);
    expect(body.claim.status).toBe("blocked_sod");
    expect(
      auditForEntity(h.db, "claim", claimId).find(
        (a) => a.action === "claim.blocked_sod"
      )!.after.code
    ).toBe("self_approval");
  });

  // row: [employee] + clean two-step route (manager + other finance) → pending
  it("[employee] × clean multi-step (manager + finance peer) → pending", async () => {
    await provisionSeedUser(h, {
      id: "u-fin-peer2",
      name: "Finance Peer Two",
      email: "finpeer2@spendflow.example",
      role: "finance",
      roles: ["finance"],
    });
    insertRoute(
      [
        { id: "cl-s0", approverType: "submitter_manager", label: "Manager" },
        { id: "cl-s1", approverType: "finance", label: "Finance" },
      ],
      "rt-matrix-clean"
    );
    const cookie = await seedSubmitter(
      "u-mx-clean",
      ["employee"],
      DEMO.approver.id
    );
    const createRes = await authedPost(h.app, "/api/claims", cookie, {
      title: "Clean multi-step",
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
    expect(body.claim.status).toBe("pending");
  });
});

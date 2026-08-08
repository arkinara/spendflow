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

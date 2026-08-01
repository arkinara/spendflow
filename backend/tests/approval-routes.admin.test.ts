/* ============================================================================
 * SpendFlow — Approval route/step administration API tests (ticket #14).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { approvalRoutesTable, approvalStepsTable } from "../src/db/schema.js";
import { matchRouteForClaim, type RouteRow } from "../src/services/admin.js";
import {
  DEMO,
  authedDelete,
  authedGet,
  authedPatch,
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

async function financeCookie() {
  const res = await login(h.app, DEMO.finance.email);
  expect(res.status).toBe(200);
  return res.cookie!;
}

async function employeeCookie() {
  const res = await login(h.app, DEMO.employee.email);
  expect(res.status).toBe(200);
  return res.cookie!;
}

describe("approval route admin API", () => {
  it("a route created with three ordered steps returns those steps in the correct order on read", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/routes", cookie, {
      name: "Big spend, 3 approvers",
      matchMinAmount: 5_000_000,
      steps: [
        { approverType: "submitter_manager", label: "Line manager" },
        { approverType: "specific_user", approverId: DEMO.finance.id, label: "Controller" },
        { approverType: "finance", label: "Finance sign-off" },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route.steps.map((s: { label: string }) => s.label)).toEqual([
      "Line manager",
      "Controller",
      "Finance sign-off",
    ]);
    expect(body.route.steps.map((s: { orderIndex: number }) => s.orderIndex)).toEqual([0, 1, 2]);

    const get = await authedGet(h.app, "/api/admin/routes", cookie);
    const routes = (await get.json()).routes as RouteRow[];
    const found = routes.find((r) => r.id === body.route.id)!;
    expect(found.steps.map((s) => s.label)).toEqual(["Line manager", "Controller", "Finance sign-off"]);
  });

  it("each step's approver_type (manager, named approver, Finance Admin) is correctly persisted and returned", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/routes", cookie, {
      name: "Mixed approver types",
      steps: [
        { approverType: "submitter_manager", label: "Manager" },
        { approverType: "specific_user", approverId: DEMO.finance.id, label: "Named" },
        { approverType: "finance", label: "Finance" },
      ],
    });
    const body = await res.json();
    expect(body.route.steps[0].approverType).toBe("submitter_manager");
    expect(body.route.steps[1].approverType).toBe("specific_user");
    expect(body.route.steps[1].approverId).toBe(DEMO.finance.id);
    expect(body.route.steps[2].approverType).toBe("finance");
  });

  it("creating a route with zero steps is rejected with a validation error", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/routes", cookie, {
      name: "No steps",
      steps: [],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_steps");
  });

  it("match_min_amount greater than match_max_amount is rejected", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/routes", cookie, {
      name: "Bad range",
      matchMinAmount: 1_000_000,
      matchMaxAmount: 500_000,
      steps: [{ approverType: "finance", label: "Finance" }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
  });

  it("reordering a route's steps persists the new order", async () => {
    const cookie = await financeCookie();
    const create = await authedPost(h.app, "/api/admin/routes", cookie, {
      name: "Reorder me",
      steps: [
        { approverType: "submitter_manager", label: "A" },
        { approverType: "finance", label: "B" },
      ],
    });
    const route = (await create.json()).route;
    const [stepA, stepB] = route.steps;

    const res = await authedPost(h.app, `/api/admin/routes/${route.id}/reorder`, cookie, {
      stepIds: [stepB.id, stepA.id],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route.steps.map((s: { id: string }) => s.id)).toEqual([stepB.id, stepA.id]);
    expect(body.route.steps.map((s: { orderIndex: number }) => s.orderIndex)).toEqual([0, 1]);
  });

  it("reordering with a step id that doesn't belong to the route is rejected", async () => {
    const cookie = await financeCookie();
    const create = await authedPost(h.app, "/api/admin/routes", cookie, {
      name: "Reorder guard",
      steps: [{ approverType: "finance", label: "Only step" }],
    });
    const route = (await create.json()).route;
    const res = await authedPost(h.app, `/api/admin/routes/${route.id}/reorder`, cookie, {
      stepIds: ["not-a-real-step-id"],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_steps");
  });

  it("a non-Finance-Admin caller attempting to create a route is rejected", async () => {
    const cookie = await employeeCookie();
    const res = await authedPost(h.app, "/api/admin/routes", cookie, {
      name: "Should not work",
      steps: [{ approverType: "finance", label: "Finance" }],
    });
    expect(res.status).toBe(403);
  });

  it("deactivating a route referenced by an already-routed historical claim does not alter that claim's reference", async () => {
    const empCookie = await employeeCookie();
    const financeCk = await financeCookie();

    // The seeded fallback route ("rt-default") resolves any claim submitted.
    const createRes = await authedPost(h.app, "/api/claims", empCookie, {
      title: "Routed via fallback",
      lineItems: [{ categoryId: "taxi", date: "2026-07-01", amount: 50_000 }],
    });
    const claim = (await createRes.json()).claim;
    const submitRes = await authedPost(h.app, `/api/claims/${claim.id}/submit`, empCookie, {});
    expect(submitRes.status).toBe(200);
    const submitted = (await submitRes.json()).claim;
    expect(submitted.approvalRouteId).toBe("rt-default");

    const delRes = await authedDelete(h.app, "/api/admin/routes/rt-default", financeCk);
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).route.active).toBe(false);

    // The route row (and its steps) still exist; the claim's reference is untouched.
    const routeRow = h.db
      .select()
      .from(approvalRoutesTable)
      .where(eq(approvalRoutesTable.id, "rt-default"))
      .get();
    expect(routeRow).toBeDefined();
    const getClaim = await authedGet(h.app, `/api/claims/${claim.id}`, empCookie);
    const fetched = (await getClaim.json()).claim;
    expect(fetched.approvalRouteId).toBe("rt-default");
  });

  it("editing a route's steps replaces the step set without touching approval_routes.id (historical claim keeps resolving the route)", async () => {
    const cookie = await financeCookie();
    const create = await authedPost(h.app, "/api/admin/routes", cookie, {
      name: "Editable route",
      steps: [{ approverType: "submitter_manager", label: "Manager" }],
    });
    const route = (await create.json()).route;

    const editRes = await authedPatch(h.app, `/api/admin/routes/${route.id}`, cookie, {
      steps: [
        { approverType: "finance", label: "Finance only now" },
      ],
    });
    expect(editRes.status).toBe(200);
    const body = await editRes.json();
    expect(body.route.id).toBe(route.id);
    expect(body.route.steps).toHaveLength(1);
    expect(body.route.steps[0].approverType).toBe("finance");

    const oldStepRow = h.db
      .select()
      .from(approvalStepsTable)
      .where(eq(approvalStepsTable.id, route.steps[0].id))
      .get();
    expect(oldStepRow).toBeUndefined();
  });

  it("matchRouteForClaim (pure) picks the most specific matching route over the fallback", () => {
    const fallback: RouteRow = {
      id: "rt-fallback",
      name: "Fallback",
      matchMinAmount: null,
      matchMaxAmount: null,
      matchCategoryId: null,
      matchDepartment: null,
      isFallback: true,
      active: true,
      steps: [{ id: "s1", orderIndex: 0, approverType: "submitter_manager", approverId: null, label: "Manager" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const specific: RouteRow = {
      id: "rt-big",
      name: "Big spend",
      matchMinAmount: 1_000_000,
      matchMaxAmount: null,
      matchCategoryId: null,
      matchDepartment: null,
      isFallback: false,
      active: true,
      steps: [{ id: "s2", orderIndex: 0, approverType: "finance", approverId: null, label: "Finance" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const bigClaim = matchRouteForClaim(
      { totalAmount: 2_000_000, categoryIds: ["hotel"], department: null },
      [specific, fallback]
    );
    expect(bigClaim?.route.id).toBe("rt-big");
    expect(bigClaim?.isFallback).toBe(false);

    const smallClaim = matchRouteForClaim(
      { totalAmount: 100_000, categoryIds: ["taxi"], department: null },
      [specific, fallback]
    );
    expect(smallClaim?.route.id).toBe("rt-fallback");
    expect(smallClaim?.isFallback).toBe(true);
  });

  it("matchRouteForClaim (pure) returns null instead of throwing when no route matches and there is no fallback", () => {
    const specific: RouteRow = {
      id: "rt-big",
      name: "Big spend",
      matchMinAmount: 1_000_000,
      matchMaxAmount: null,
      matchCategoryId: null,
      matchDepartment: null,
      isFallback: false,
      active: true,
      steps: [{ id: "s2", orderIndex: 0, approverType: "finance", approverId: null, label: "Finance" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = matchRouteForClaim(
      { totalAmount: 100, categoryIds: ["taxi"], department: null },
      [specific]
    );
    expect(result).toBeNull();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  listCategories,
  addCategory,
  editCategory,
  deactivateCategory,
  listPolicies,
  addPolicy,
  editPolicy,
  deactivatePolicy,
  listRoutes,
  addRoute,
  editRoute,
  reorderRouteSteps,
  deactivateRoute,
  toFECategory,
  toFEPolicy,
  toFERoute,
  summarizeMatch,
  approverTypeLabel,
  AdminApiError,
  type BackendCategory,
  type BackendPolicy,
  type BackendRoute,
} from "@/lib/api/admin";
import { BE_URL } from "@/lib/auth/apiClient";

/**
 * Unit tests for the Admin HTTP client (ticket #21). `fetch` is stubbed per
 * test so nothing hits a real backend. Error envelopes use the same
 * `{ error: { code, message } }` shape `jsonError` (routes/claims.ts) emits,
 * mounted on the admin router via `adminErrorHandler` (routes/admin.ts).
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* --------------------------------------------------------------- fixtures */

function backendCategory(overrides: Partial<BackendCategory> = {}): BackendCategory {
  return {
    id: "cat-1",
    name: "Taxi / Ride-hailing",
    code: "TAX",
    requiresReceipt: true,
    receiptThreshold: 250_000,
    perItemCap: null,
    mileageRate: null,
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function backendPolicy(overrides: Partial<BackendPolicy> = {}): BackendPolicy {
  return {
    id: "pol-1",
    name: "Hotel nightly cap",
    description: "Caps a single hotel night.",
    categoryId: "cat-hotel",
    limitAmount: 1_200_000,
    period: "per_item",
    currency: "IDR",
    receiptRequired: true,
    receiptRequiredAbove: 500_000,
    justificationRequiredAbove: 1_200_000,
    effectiveDate: "2026-01-01",
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function backendRoute(overrides: Partial<BackendRoute> = {}): BackendRoute {
  return {
    id: "rt-1",
    name: "High-value claim",
    matchMinAmount: 5_000_000,
    matchMaxAmount: null,
    matchCategoryId: null,
    matchDepartment: null,
    isFallback: false,
    active: true,
    steps: [
      {
        id: "rt-1-s1",
        orderIndex: 0,
        approverType: "submitter_manager",
        approverId: null,
        label: "Submitter's manager",
      },
      {
        id: "rt-1-s2",
        orderIndex: 1,
        approverType: "finance",
        approverId: null,
        label: "Finance Admin",
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/* ---------------------------------------------------------------- categories */

describe("listCategories", () => {
  it("GETs /api/admin/categories with credentials and adapts rows", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { categories: [backendCategory(), backendCategory({ id: "cat-2", mileageRate: 3000 })] }),
    );
    const result = await listCategories();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/categories`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(result).toHaveLength(2);
    expect(result[0].requiresMileage).toBe(false);
    expect(result[1].requiresMileage).toBe(true);
  });

  it("throws AdminApiError 403 forbidden for a non-Finance-Admin session", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } }),
    );
    await expect(listCategories()).rejects.toMatchObject({
      name: "AdminApiError",
      status: 403,
      code: "forbidden",
    });
  });
});

describe("addCategory", () => {
  it("POSTs the mapped body and returns the adapted category", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { category: backendCategory({ id: "cat-new" }) }));
    const result = await addCategory({
      name: "Training",
      code: "TRN",
      requiresMileage: false,
      requiresReceipt: true,
      receiptThreshold: 250_000,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/categories`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      name: "Training",
      code: "TRN",
      requiresReceipt: true,
      receiptThreshold: 250_000,
      mileageRate: null,
    });
    expect(result.id).toBe("cat-new");
  });

  it("throws a 409 duplicate_code typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: "duplicate_code", message: 'Code "TAX" is already in use.' } }),
    );
    const err = await addCategory({
      name: "Dup",
      code: "TAX",
      requiresMileage: false,
      requiresReceipt: true,
      receiptThreshold: 0,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect((err as AdminApiError).status).toBe(409);
    expect((err as AdminApiError).code).toBe("duplicate_code");
  });

  it("throws a 403 forbidden typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } }),
    );
    await expect(
      addCategory({
        name: "Training",
        code: "TRN",
        requiresMileage: false,
        requiresReceipt: true,
        receiptThreshold: 0,
      }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("editCategory", () => {
  it("PATCHes only the provided fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { category: backendCategory({ name: "Renamed" }) }));
    const result = await editCategory("cat-1", { name: "Renamed" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/categories/cat-1`);
    expect(init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: "Renamed" });
    expect(result.name).toBe("Renamed");
  });
});

describe("deactivateCategory", () => {
  it("DELETEs and returns the row marked inactive", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { category: backendCategory({ active: false }) }));
    const result = await deactivateCategory("cat-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/categories/cat-1`);
    expect(init).toMatchObject({ method: "DELETE" });
    expect(result.active).toBe(false);
  });

  it("encodes the id into the path segment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { category: backendCategory() }));
    await deactivateCategory("cat/slash");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/admin/categories/cat%2Fslash`);
  });
});

/* ------------------------------------------------------------------ policies */

describe("listPolicies", () => {
  it("GETs /api/admin/policies and adapts limitAmount -> limit", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { policies: [backendPolicy()] }));
    const result = await listPolicies();
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/admin/policies`);
    expect(result[0].limit).toBe(1_200_000);
    expect(result[0].currency).toBe("IDR");
  });
});

describe("addPolicy", () => {
  const validInput = {
    name: "Team event cap",
    limit: 750_000,
    currency: "IDR" as const,
    receiptRequiredAbove: 250_000,
    justificationRequiredAbove: 750_000,
    effectiveDate: "2026-08-01",
  };

  it("POSTs the mapped body (limit -> limitAmount) and returns the adapted policy", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { policy: backendPolicy({ id: "pol-new" }) }));
    const result = await addPolicy(validInput);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/policies`);
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      name: "Team event cap",
      limitAmount: 750_000,
      currency: "IDR",
    });
    expect(result.id).toBe("pol-new");
  });

  it("throws a 400 validation typed error when min amount >= max amount", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "validation", message: "Receipt-required threshold cannot exceed the max amount." },
      }),
    );
    const err = await addPolicy({ ...validInput, receiptRequiredAbove: 900_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect((err as AdminApiError).status).toBe(400);
    expect((err as AdminApiError).code).toBe("validation");
    expect((err as AdminApiError).message).toMatch(/exceed the max amount/i);
  });

  it("throws a 400 validation typed error for an unsupported currency", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "validation", message: "Currency \"EUR\" is not supported." },
      }),
    );
    const err = await addPolicy({ ...validInput, currency: "EUR" as never }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect((err as AdminApiError).code).toBe("validation");
    expect((err as AdminApiError).message).toMatch(/not supported/i);
  });

  it("throws a 403 forbidden typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } }),
    );
    await expect(addPolicy(validInput)).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("editPolicy", () => {
  it("PATCHes the effective date and returns the updated row", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { policy: backendPolicy({ effectiveDate: "2026-09-01" }) }),
    );
    const result = await editPolicy("pol-1", { effectiveDate: "2026-09-01" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/policies/pol-1`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ effectiveDate: "2026-09-01" });
    expect(result.effectiveDate).toBe("2026-09-01");
  });
});

describe("deactivatePolicy", () => {
  it("DELETEs and returns the row marked inactive", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { policy: backendPolicy({ active: false }) }));
    const result = await deactivatePolicy("pol-1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(result.active).toBe(false);
  });
});

/* -------------------------------------------------------------------- routes */

describe("listRoutes", () => {
  it("GETs /api/admin/routes and sorts steps by orderIndex", async () => {
    const scrambled = backendRoute({
      steps: [
        { id: "s2", orderIndex: 1, approverType: "finance", approverId: null, label: "Finance Admin" },
        { id: "s1", orderIndex: 0, approverType: "submitter_manager", approverId: null, label: "Manager" },
      ],
    });
    fetchMock.mockResolvedValue(jsonResponse(200, { routes: [scrambled] }));
    const result = await listRoutes();
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/admin/routes`);
    expect(result[0].steps.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("addRoute", () => {
  const validInput = {
    name: "Marketing cap",
    match: { minAmount: 2_000_000 },
    steps: [{ approverType: "submitter_manager" as const, label: "Submitter's manager" }],
  };

  it("POSTs the mapped match + steps and returns the adapted route", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { route: backendRoute({ id: "rt-new" }) }));
    const result = await addRoute(validInput);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/routes`);
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      name: "Marketing cap",
      matchMinAmount: 2_000_000,
      matchMaxAmount: null,
      steps: [{ approverType: "submitter_manager", approverId: null, label: "Submitter's manager" }],
    });
    expect(result.id).toBe("rt-new");
  });

  it("throws a 400 invalid_steps typed error for zero steps", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "invalid_steps", message: "A route needs at least one approval step." },
      }),
    );
    const err = await addRoute({ ...validInput, steps: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect((err as AdminApiError).status).toBe(400);
    expect((err as AdminApiError).code).toBe("invalid_steps");
  });

  it("throws a 403 forbidden typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } }),
    );
    await expect(addRoute(validInput)).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("editRoute", () => {
  it("PATCHes the route and returns the adapted result", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { route: backendRoute({ name: "Renamed route" }) }));
    const result = await editRoute("rt-1", { name: "Renamed route" });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/admin/routes/rt-1`);
    expect(result.name).toBe("Renamed route");
  });
});

describe("reorderRouteSteps", () => {
  it("POSTs stepIds in the new order and returns the reordered route", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        route: backendRoute({
          steps: [
            { id: "rt-1-s2", orderIndex: 0, approverType: "finance", approverId: null, label: "Finance Admin" },
            { id: "rt-1-s1", orderIndex: 1, approverType: "submitter_manager", approverId: null, label: "Manager" },
          ],
        }),
      }),
    );
    const result = await reorderRouteSteps("rt-1", ["rt-1-s2", "rt-1-s1"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/routes/rt-1/reorder`);
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      stepIds: ["rt-1-s2", "rt-1-s1"],
    });
    expect(result.steps.map((s) => s.id)).toEqual(["rt-1-s2", "rt-1-s1"]);
  });

  it("throws a 400 invalid_steps typed error on a partial permutation", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "invalid_steps", message: "Reorder must include every step exactly once." },
      }),
    );
    await expect(reorderRouteSteps("rt-1", ["rt-1-s1"])).rejects.toMatchObject({
      status: 400,
      code: "invalid_steps",
    });
  });
});

describe("deactivateRoute", () => {
  it("DELETEs and returns the row marked inactive", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { route: backendRoute({ active: false }) }));
    const result = await deactivateRoute("rt-1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(result.active).toBe(false);
  });
});

/* ------------------------------------------------------------------- errors */

describe("error handling", () => {
  it("throws a typed internal error on a non-JSON success body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>broken</html>", { status: 200 }));
    const err = await listCategories().catch((e) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect((err as AdminApiError).code).toBe("internal");
  });

  it("falls back to a status-derived message when the error body is non-JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
    const err = await listCategories().catch((e) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect((err as AdminApiError).status).toBe(500);
    expect((err as AdminApiError).message).toMatch(/500/);
  });
});

/* ------------------------------------------------------------------ adapters */

describe("toFECategory / toFEPolicy / toFERoute", () => {
  it("derives requiresMileage from a non-null mileageRate", () => {
    expect(toFECategory(backendCategory({ mileageRate: null })).requiresMileage).toBe(false);
    expect(toFECategory(backendCategory({ mileageRate: 3000 })).requiresMileage).toBe(true);
  });

  it("maps limitAmount onto limit and preserves currency", () => {
    const fe = toFEPolicy(backendPolicy({ limitAmount: 500_000, currency: "USD" }));
    expect(fe.limit).toBe(500_000);
    expect(fe.currency).toBe("USD");
  });

  it("sorts steps and maps match fields", () => {
    const fe = toFERoute(backendRoute());
    expect(fe.match.minAmount).toBe(5_000_000);
    expect(fe.steps.map((s) => s.id)).toEqual(["rt-1-s1", "rt-1-s2"]);
  });
});

describe("summarizeMatch / approverTypeLabel", () => {
  it("summarizes an amount range and falls back to 'Any claim'", () => {
    expect(summarizeMatch({ minAmount: 1_000_000, maxAmount: 5_000_000 })).toMatch(/1.000.000.*5.000.000/);
    expect(summarizeMatch({})).toBe("Any claim");
  });

  it("labels every approver type", () => {
    expect(approverTypeLabel("submitter_manager")).toMatch(/manager/i);
    expect(approverTypeLabel("finance")).toMatch(/finance/i);
    expect(approverTypeLabel("specific_user")).toMatch(/named/i);
  });
});

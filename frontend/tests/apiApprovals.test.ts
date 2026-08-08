import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  listInbox,
  getClaimForReview,
  decide,
  ApprovalApiError,
  type BackendApproverClaimDetail,
  type BackendInboxItem,
} from "@/lib/api/approvals";
import { BE_URL } from "@/lib/auth/apiClient";

/**
 * Unit tests for the Approver HTTP client (ticket #19). The global `fetch` is
 * mocked per-test so nothing hits a real backend. Error envelopes use the
 * same `{ error: { code, message } }` shape the BE's `jsonError` helper
 * serialises, so the typed-error paths exercise the real parser.
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

function inboxItem(overrides: Partial<BackendInboxItem> = {}): BackendInboxItem {
  return {
    id: "clm-1",
    reference: "EXP-2026-1",
    title: "Client Visit",
    employeeId: "u-emp-1",
    employeeName: "Aulia Pratiwi",
    status: "pending",
    currency: "IDR",
    totalAmount: 2_450_000,
    submittedAt: "2026-07-21T09:32:00Z",
    currentStepIndex: 0,
    stepLabel: "Line manager",
    ...overrides,
  };
}

function detail(
  overrides: Partial<BackendApproverClaimDetail> = {},
): BackendApproverClaimDetail {
  return {
    id: "clm-1",
    reference: "EXP-2026-1",
    title: "Client Visit",
    purpose: "Kick-off",
    employeeId: "u-emp-1",
    status: "pending",
    currency: "IDR",
    tripStart: "2026-08-01",
    tripEnd: "2026-08-02",
    destination: "Jakarta",
    approvalRouteId: "rt-fallback",
    currentStepIndex: 0,
    policyException: null,
    blockedReason: null,
    submittedAt: "2026-08-01T09:00:00Z",
    decidedAt: null,
    createdAt: "2026-07-31T09:00:00Z",
    updatedAt: "2026-07-31T09:00:00Z",
    lineItems: [],
    employeeName: "Aulia Pratiwi",
    steps: [{ id: "rt-fb-s1", approverType: "submitter_manager", label: "Line manager" }],
    currentStep: { id: "rt-fb-s1", approverType: "submitter_manager", label: "Line manager" },
    ...overrides,
  };
}

/* --------------------------------------------------------------- listInbox */

describe("listInbox", () => {
  it("GETs /api/approver/inbox with credentials and returns the items array", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [inboxItem()] }));

    const result = await listInbox();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/approver/inbox`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(result).toHaveLength(1);
    expect(result[0].employeeName).toBe("Aulia Pratiwi");
    expect(result[0].totalAmount).toBe(2_450_000);
  });

  it("forwards sort_by / sort_dir as query params when provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await listInbox({ sortBy: "amount", sortDir: "asc" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BE_URL}/api/approver/inbox?sort_by=amount&sort_dir=asc`,
    );
  });

  it("throws ApprovalApiError with the backend code+message on a 401 (session expired)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorized", message: "Session expired." } }),
    );
    await expect(listInbox()).rejects.toMatchObject({
      name: "ApprovalApiError",
      status: 401,
      code: "unauthorized",
      message: "Session expired.",
    });
  });

  it("throws ApprovalApiError on a 403 (non-approver role)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Approvers only." } }),
    );
    await expect(listInbox()).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

/* ----------------------------------------------------------- getClaimForReview */

describe("getClaimForReview", () => {
  it("GETs /api/approver/claims/:id and adapts the BE detail to the FE Claim shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { claim: detail() }));

    const result = await getClaimForReview("clm-1");

    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/approver/claims/clm-1`);
    expect(result.claim.id).toBe("clm-1");
    expect(result.claim.status).toBe("pending");
    expect(result.employeeName).toBe("Aulia Pratiwi");
    expect(result.steps).toHaveLength(1);
    expect(result.currentStep?.label).toBe("Line manager");
  });

  it("encodes the id into the path segment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { claim: detail() }));
    await getClaimForReview("clm/slash");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BE_URL}/api/approver/claims/clm%2Fslash`,
    );
  });

  it("throws a 403 ApprovalApiError when the claim is not at the caller's step", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: { code: "forbidden", message: "This claim is not at your step" },
      }),
    );
    await expect(getClaimForReview("clm-x")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "This claim is not at your step",
    });
  });

  it("throws a 404 ApprovalApiError for an unknown claim id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "Claim missing." } }),
    );
    await expect(getClaimForReview("clm-missing")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
});

/* -------------------------------------------------------------------- decide */

describe("decide", () => {
  it("POSTs an approve action without a comment and reads the result envelope", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        claim: detail({ status: "approved", decidedAt: "2026-08-02T10:00:00Z" }),
        action: "approve",
        advanced: false,
        finalised: true,
      }),
    );

    const result = await decide("clm-1", { action: "approve" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/approver/claims/clm-1/decisions`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "approve" });
    expect(result.action).toBe("approve");
    expect(result.finalised).toBe(true);
    expect(result.advanced).toBe(false);
    expect(result.claim.status).toBe("approved");
  });

  it("POSTs a reject action with a comment body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        claim: detail({ status: "rejected" }),
        action: "reject",
        advanced: false,
        finalised: true,
      }),
    );
    await decide("clm-1", { action: "reject", comment: "Out of policy." });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      action: "reject",
      comment: "Out of policy.",
    });
  });

  it("throws a 400 ApprovalApiError carrying comment_required when the BE rejects an empty required note", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "comment_required", message: "A comment is required for reject" },
      }),
    );
    await expect(
      decide("clm-1", { action: "reject" }),
    ).rejects.toMatchObject({
      name: "ApprovalApiError",
      status: 400,
      code: "comment_required",
      message: "A comment is required for reject",
    });
  });

  it("throws a 409 stale_decision typed error when the claim is no longer pending", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: {
          code: "stale_decision",
          message: "Claim is no longer pending (status: approved)",
        },
      }),
    );
    const err = await decide("clm-1", { action: "approve" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalApiError);
    expect((err as ApprovalApiError).code).toBe("stale_decision");
    expect((err as ApprovalApiError).status).toBe(409);
    expect((err as ApprovalApiError).message).toContain("no longer pending");
  });

  it("throws a 403 typed error when the caller is no longer the step approver", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: { code: "forbidden", message: "This claim is not at your step" },
      }),
    );
    await expect(decide("clm-1", { action: "approve" })).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });

  it("throws a typed internal error on a non-JSON success body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>broken</html>", { status: 200 }));
    const err = await decide("clm-1", { action: "approve" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalApiError);
    expect((err as ApprovalApiError).code).toBe("internal");
  });
});

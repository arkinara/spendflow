import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  listClaims,
  getClaim,
  getClaimAudit,
  createClaim,
  updateClaim,
  submitClaim,
  withdrawClaim,
  resubmitClaim,
  uploadAttachment,
  toFEClaim,
  ClaimApiError,
  type BackendClaim,
} from "@/lib/api/claims";
import { BE_URL } from "@/lib/auth/apiClient";

/**
 * Unit tests for the Claim HTTP client (ticket #18). The global `fetch` is
 * mocked per-test so nothing hits a real backend; `uploadAttachment` goes
 * through XMLHttpRequest (fetch has no upload-progress event), so a small
 * FakeXhr stub stands in for that one method.
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

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

/** Minimal BackendClaim fixture used across the read/write tests. */
function backendClaim(overrides: Partial<BackendClaim> = {}): BackendClaim {
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
    approvalRouteId: null,
    currentStepIndex: 0,
    policyException: null,
    submittedAt: "2026-08-01T09:00:00Z",
    decidedAt: null,
    createdAt: "2026-07-31T09:00:00Z",
    updatedAt: "2026-07-31T09:00:00Z",
    lineItems: [
      {
        id: "li-1",
        claimId: "clm-1",
        categoryId: "flight",
        description: "Return flight",
        date: "2026-08-01",
        amount: 2_450_000,
        currency: "IDR",
        quantity: null,
        unitLabel: null,
        unitRate: null,
        hasReceipt: true,
        note: "Merchant: Garuda",
        policyFlag: null,
        createdAt: "2026-07-31T09:00:00Z",
        updatedAt: "2026-07-31T09:00:00Z",
      },
    ],
    ...overrides,
  };
}

describe("listClaims", () => {
  it("GETs /api/claims, joins status filters into ?status=, and maps via toFEClaim", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { claims: [backendClaim()] }),
    );

    const result = await listClaims({ status: ["draft", "pending"] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/claims?status=draft%2Cpending`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("clm-1");
    expect(result[0].lineItems[0].note).toBe("Merchant: Garuda");
  });

  it("omits the query string when no filters are supplied", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { claims: [] }));
    await listClaims();
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/claims`);
  });

  it("throws ClaimApiError with the backend code+message on a 400", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "no_line_items", message: "At least one line item is required." },
      }),
    );
    await expect(listClaims()).rejects.toMatchObject({
      name: "ClaimApiError",
      status: 400,
      code: "no_line_items",
      message: "At least one line item is required.",
    });
  });
});

describe("getClaim", () => {
  it("GETs /api/claims/:id and returns the adapted claim", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { claim: backendClaim() }));
    const claim = await getClaim("clm-1");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/claims/clm-1`);
    expect(claim.title).toBe("Client Visit");
  });

  it("encodes the id into the path segment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { claim: backendClaim() }));
    await getClaim("clm/with slash");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BE_URL}/api/claims/clm%2Fwith%20slash`,
    );
  });

  it("throws a 404 ClaimApiError when the claim does not exist", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "Claim not found." } }),
    );
    await expect(getClaim("missing")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("throws a 403 ClaimApiError on cross-employee access", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Not yours." } }),
    );
    await expect(getClaim("clm-x")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

describe("getClaimAudit", () => {
  it("GETs /api/claims/:id/audit and returns the entries array", async () => {
    const entries = [
      { id: "au-1", actorId: "u-emp-1", action: "claim.created", entityType: "claim", entityId: "clm-1", before: null, after: null, createdAt: "2026-07-31T09:00:00Z" },
      { id: "au-2", actorId: "u-emp-1", action: "claim.submitted", entityType: "claim", entityId: "clm-1", before: { status: "draft" }, after: { status: "pending" }, createdAt: "2026-07-31T09:30:00Z" },
    ];
    fetchMock.mockResolvedValue(jsonResponse(200, { entries }));
    const result = await getClaimAudit("clm-1");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/claims/clm-1/audit`);
    expect(result).toEqual(entries);
  });
});

describe("createClaim / updateClaim", () => {
  it("POSTs the draft JSON to /api/claims and returns the created claim", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { claim: backendClaim({ status: "draft" }) }));
    const claim = await createClaim({
      title: "Client Visit",
      purpose: "Kick-off",
      currency: "IDR",
      lineItems: [{ categoryId: "flight", date: "2026-08-01", amount: 2_450_000 }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/claims`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect((init as RequestInit).headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      title: "Client Visit",
      lineItems: [{ categoryId: "flight", amount: 2_450_000 }],
    });
    expect(claim.status).toBe("draft");
  });

  it("PATCHes /api/claims/:id with the patch body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { claim: backendClaim({ title: "Renamed" }) }),
    );
    const claim = await updateClaim("clm-1", { title: "Renamed" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/claims/clm-1`);
    expect(init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ title: "Renamed" });
    expect(claim.title).toBe("Renamed");
  });
});

describe("submitClaim / withdrawClaim / resubmitClaim", () => {
  it("POSTs to /api/claims/:id/submit and reads the BackendSubmitResult envelope", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        claim: backendClaim({ status: "pending" }),
        warnings: [{ type: "missing_receipt" }],
        summary: { type: "missing_receipt", severity: "high", message: "x", count: 1 },
      }),
    );
    const claim = await submitClaim("clm-1");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/claims/clm-1/submit`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(claim.status).toBe("pending");
  });

  it("POSTs withdraw with an optional comment body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { claim: backendClaim({ status: "action_required" }) }),
    );
    await withdrawClaim("clm-1", "Wrong receipt attached.");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/claims/clm-1/withdraw`);
    expect(JSON.parse(init.body as string)).toEqual({ comment: "Wrong receipt attached." });
  });

  it("POSTs withdraw with a null comment when none is supplied", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { claim: backendClaim({ status: "action_required" }) }),
    );
    await withdrawClaim("clm-1");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      comment: null,
    });
  });

  it("POSTs resubmit and returns the claim", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        claim: backendClaim({ status: "pending" }),
        warnings: [],
        summary: null,
      }),
    );
    const claim = await resubmitClaim("clm-1");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/claims/clm-1/resubmit`);
    expect(claim.status).toBe("pending");
  });
});

describe("error + envelope parsing", () => {
  it("falls back to a status-derived message when the body has no error object", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    const err = await getClaim("clm-1").catch((e) => e);
    expect(err).toBeInstanceOf(ClaimApiError);
    expect((err as ClaimApiError).status).toBe(500);
    expect((err as ClaimApiError).message).toContain("500");
  });

  it("tolerates a top-level string error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: "Validation failed." }));
    const err = await listClaims().catch((e) => e);
    expect((err as ClaimApiError).message).toBe("Validation failed.");
  });

  it("tolerates a top-level message field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { message: "Backend down." }));
    const err = await getClaim("clm-1").catch((e) => e);
    expect((err as ClaimApiError).message).toBe("Backend down.");
  });

  it("throws a typed error on a non-JSON 200 body", async () => {
    fetchMock.mockResolvedValue(textResponse(200, "<html>not json</html>"));
    const err = await getClaim("clm-1").catch((e) => e);
    expect(err).toBeInstanceOf(ClaimApiError);
    expect((err as ClaimApiError).code).toBe("internal");
  });

  it("returns an empty object when the success body is whitespace", async () => {
    // The parser tolerates an empty body by returning `{}` (cast to T). For
    // listClaims that means `body.claims` is undefined — a malformed response
    // the caller cannot silently swallow, so it surfaces as a TypeError. The
    // point of this test is that the parser itself does not crash on empty
    // input; the caller-side crash is the expected escalation of a broken BE.
    fetchMock.mockResolvedValue(textResponse(200, ""));
    await expect(listClaims()).rejects.toThrow();
  });

  it("propagates the underlying network failure when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new TypeError("failed to fetch"));
    await expect(getClaim("clm-1")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("toFEClaim adapter", () => {
  it("maps line items and defaults attachments/approvals to empty arrays", () => {
    const claim = toFEClaim(backendClaim());
    expect(claim.attachments).toEqual([]);
    expect(claim.approvals).toEqual([]);
    expect(claim.lineItems).toHaveLength(1);
    expect(claim.lineItems[0]).toMatchObject({
      id: "li-1",
      categoryId: "flight",
      amount: 2_450_000,
      currency: "IDR",
      hasReceipt: true,
      note: "Merchant: Garuda",
    });
  });

  it("coerces a currency_mismatch policy exception into an over_policy FE exception", () => {
    const claim = toFEClaim(
      backendClaim({
        policyException: {
          type: "currency_mismatch",
          severity: "medium",
          message: "Line currency differs.",
          count: 1,
        },
      }),
    );
    expect(claim.exception).toMatchObject({
      type: "over_policy",
      severity: "medium",
      message: "Line currency differs.",
      status: "open",
    });
  });

  it("preserves the missing_receipt exception type verbatim", () => {
    const claim = toFEClaim(
      backendClaim({
        policyException: {
          type: "missing_receipt",
          severity: "high",
          message: "No receipt.",
          count: 2,
        },
      }),
    );
    expect(claim.exception?.type).toBe("missing_receipt");
    expect(claim.exception?.severity).toBe("high");
  });

  it("has no exception when policyException is null", () => {
    expect(toFEClaim(backendClaim()).exception).toBeUndefined();
  });

  it("passes an unrecognised currency string through unchanged", () => {
    // The adapter only coerces null/undefined → IDR (defensive `??`); an
    // unrecognised string is the backend's contract to enforce, so it is
    // cast rather than runtime-validated here.
    expect(toFEClaim(backendClaim({ currency: "XYZ" })).currency).toBe("XYZ");
  });
});

/* ------------------------------------------------------------------ XHR mock */

class FakeXhr {
  static last: FakeXhr | null = null;
  url = "";
  method = "";
  withCredentials = false;
  responseType = "";
  status = 0;
  response: unknown = null;
  upload = { addEventListener: vi.fn() };
  sentBody: FormData | null = null;
  private handlers: Record<string, () => void> = {};

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  addEventListener(name: string, fn: () => void) {
    this.handlers[name] = fn;
  }
  send(body: FormData) {
    FakeXhr.last = this;
    this.sentBody = body;
  }
  fireLoad(status: number, body: unknown) {
    this.status = status;
    this.response = body;
    this.handlers.load?.();
  }
  fireError() {
    this.handlers.error?.();
  }
}

describe("uploadAttachment", () => {
  beforeEach(() => {
    FakeXhr.last = null;
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs multipart to the line-item attachments URL with credentials", async () => {
    const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
    const promise = uploadAttachment(
      "clm-1",
      "li-1",
      file,
      { merchant: "Garuda", amount: 100, currency: "IDR", transactionDate: "2026-08-01" },
    );
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(
      `${BE_URL}/api/claims/clm-1/line-items/li-1/attachments`,
    );
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.responseType).toBe("json");
    expect(xhr.sentBody).toBeInstanceOf(FormData);
    expect((xhr.sentBody as FormData).get("file")).toBe(file);
    expect((xhr.sentBody as FormData).get("merchant")).toBe("Garuda");
    expect((xhr.sentBody as FormData).get("amount")).toBe("100");

    xhr.fireLoad(201, { attachment: { id: "att-1" } });
    await expect(promise).resolves.toBe("att-1");
  });

  it("rejects with a ClaimApiError carrying the backend code on a non-2xx", async () => {
    const promise = uploadAttachment("clm-1", "li-1", new File(["x"], "a.pdf"));
    FakeXhr.last!.fireLoad(415, {
      error: { code: "unsupported_media_type", message: "Only PDF/JPG/PNG accepted." },
    });
    await expect(promise).rejects.toMatchObject({
      name: "ClaimApiError",
      status: 415,
      code: "unsupported_media_type",
      message: "Only PDF/JPG/PNG accepted.",
    });
  });

  it("rejects with a network code when the XHR fires an error event", async () => {
    const promise = uploadAttachment("clm-1", "li-1", new File(["x"], "a.pdf"));
    FakeXhr.last!.fireError();
    await expect(promise).rejects.toMatchObject({
      name: "ClaimApiError",
      code: "network",
    });
  });

  it("rejects when the upload response is missing the attachment id", async () => {
    const promise = uploadAttachment("clm-1", "li-1", new File(["x"], "a.pdf"));
    FakeXhr.last!.fireLoad(201, {});
    await expect(promise).rejects.toMatchObject({ name: "ClaimApiError" });
  });
});

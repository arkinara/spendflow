import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getDashboard,
  getExceptions,
  resolveException,
  getPayments,
  markProcessing,
  markPaid,
  FinanceApiError,
  toFEPayment,
  type BackendExceptionItem,
  type BackendPaymentQueueItem,
  type BackendPaymentRow,
} from "@/lib/api/finance";
import { BE_URL } from "@/lib/auth/apiClient";

/**
 * Unit tests for the Finance HTTP client (ticket #20). The global `fetch` is
 * mocked per-test so nothing hits a real backend. Error envelopes use the
 * same `{ error: { code, message } }` shape the BE's `jsonError` helper
 * serialises (`routes/claims.ts:jsonError`, mounted on the finance router via
 * `financeErrorHandler`), so the typed-error paths exercise the real parser.
 *
 * `getDashboard` composes `getExceptions` + `getPayments` (two parallel GETs);
 * its test therefore routes the fetch mock by URL.
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

/** Route the fetch mock by URL + method so parallel gets in `getDashboard` resolve correctly. */
function routeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.replace(BE_URL, "")}`;
    const branch = routes[key];
    if (!branch) throw new Error(`Unhandled fetch in test: ${key}`);
    return Promise.resolve(branch(init));
  });
}

/* --------------------------------------------------------------- fixtures */

function exceptionItem(
  overrides: Partial<BackendExceptionItem> = {},
): BackendExceptionItem {
  return {
    id: "clm-1010",
    reference: "EXP-2026-1010",
    title: "Q3 Conference",
    purpose: "Conference travel",
    employeeId: "u-emp-2",
    status: "approved",
    currency: "IDR",
    tripStart: null,
    tripEnd: null,
    destination: "Bali",
    approvalRouteId: "rt-fallback",
    currentStepIndex: 0,
    policyException: {
      type: "over_policy",
      severity: "medium",
      message: "Hotel exceeds per-night cap.",
      count: 1,
    },
    blockedReason: null,
    submittedAt: "2026-07-25T09:00:00Z",
    decidedAt: "2026-07-26T09:00:00Z",
    createdAt: "2026-07-24T09:00:00Z",
    updatedAt: "2026-07-26T09:00:00Z",
    lineItems: [
      {
        id: "clm-1010-li-1",
        claimId: "clm-1010",
        categoryId: "hotel",
        description: "Hotel 2 nights",
        date: "2026-07-22",
        amount: 3_200_000,
        currency: "IDR",
        quantity: 2,
        unitLabel: "nights",
        unitRate: 1_600_000,
        hasReceipt: true,
        note: null,
        policyFlag: [{ type: "over_policy", message: "Over cap" }],
        createdAt: "2026-07-24T09:00:00Z",
        updatedAt: "2026-07-24T09:00:00Z",
      },
    ],
    employeeName: "Budi Santoso",
    openFlagCount: 1,
    ...overrides,
  };
}

function paymentQueueItem(
  overrides: Partial<BackendPaymentQueueItem> = {},
): BackendPaymentQueueItem {
  return {
    id: "clm-1004",
    reference: "EXP-2026-1004",
    title: "Client Visit",
    employeeId: "u-emp-1",
    employeeName: "Aulia Pratiwi",
    currency: "IDR",
    totalAmount: 4_787_000,
    status: "approved",
    payment: null,
    ...overrides,
  };
}

function paymentRow(
  overrides: Partial<BackendPaymentRow> = {},
): BackendPaymentRow {
  return {
    id: "pay-1",
    claimId: "clm-1004",
    method: "bank_transfer",
    referenceNumber: "TRX-881234",
    amount: 4_787_000,
    currency: "IDR",
    status: "processing",
    processedBy: "u-fin-1",
    processedAt: "2026-08-01T10:00:00Z",
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

/* --------------------------------------------------------------- getExceptions */

describe("getExceptions", () => {
  it("GETs /api/finance/exceptions with credentials and adapts items to the FE shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [exceptionItem()] }));

    const result = await getExceptions();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/finance/exceptions`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("clm-1010");
    expect(result[0].employeeName).toBe("Budi Santoso");
    expect(result[0].openFlagCount).toBe(1);
    // Adapted via toFEClaim — exception surfaces from policyException.
    expect(result[0].exception?.type).toBe("over_policy");
    expect(result[0].exception?.status).toBe("open");
    // Line items carried through.
    expect(result[0].lineItems).toHaveLength(1);
  });

  it("throws FinanceApiError 403 forbidden on non-Finance-Admin access", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } }),
    );
    await expect(getExceptions()).rejects.toMatchObject({
      name: "FinanceApiError",
      status: 403,
      code: "forbidden",
      message: "Finance admins only.",
    });
  });

  it("throws FinanceApiError 401 when the session has expired", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorized", message: "Session expired." } }),
    );
    await expect(getExceptions()).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
  });
});

/* --------------------------------------------------------------- resolveException */

describe("resolveException", () => {
  it("POSTs an override with the input body and returns the updated claim + action", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        claim: exceptionItem({ policyException: null }),
        action: "override",
      }),
    );

    const result = await resolveException("clm-1010", {
      action: "override",
      comment: "Pre-approved upgrade.",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/finance/exceptions/clm-1010/resolve`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      action: "override",
      comment: "Pre-approved upgrade.",
    });
    expect(result.action).toBe("override");
    expect(result.claim.id).toBe("clm-1010");
  });

  it("forwards lineItemId when targeting a single flagged line", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { claim: exceptionItem(), action: "override" }),
    );
    await resolveException("clm-1010", {
      action: "override",
      lineItemId: "clm-1010-li-1",
      comment: "Accepted.",
    });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      action: "override",
      lineItemId: "clm-1010-li-1",
      comment: "Accepted.",
    });
  });

  it("encodes the claimId into the path segment", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { claim: exceptionItem(), action: "override" }),
    );
    await resolveException("clm/slash", { action: "override", comment: "ok" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BE_URL}/api/finance/exceptions/clm%2Fslash/resolve`,
    );
  });

  it("throws a 400 comment_required typed error when the justification is empty", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: "comment_required",
          message: "A justification comment is required for override",
        },
      }),
    );
    const err = await resolveException("clm-1010", {
      action: "override",
      comment: "",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(FinanceApiError);
    expect((err as FinanceApiError).status).toBe(400);
    expect((err as FinanceApiError).code).toBe("comment_required");
    expect((err as FinanceApiError).message).toContain("justification");
  });

  it("throws a 400 comment_required typed error on reject without a comment", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: "comment_required",
          message: "A justification comment is required for reject",
        },
      }),
    );
    await expect(
      resolveException("clm-1011", { action: "reject", comment: "" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "comment_required",
    });
  });

  it("throws a 409 stale_decision typed error when the claim is no longer approved", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: {
          code: "stale_decision",
          message: "Claim is processing; expected approved",
        },
      }),
    );
    const err = await resolveException("clm-1010", {
      action: "override",
      comment: "ok",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(FinanceApiError);
    expect((err as FinanceApiError).code).toBe("stale_decision");
    expect((err as FinanceApiError).status).toBe(409);
  });

  it("throws a typed internal error on a non-JSON success body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>broken</html>", { status: 200 }));
    const err = await resolveException("clm-1010", {
      action: "override",
      comment: "ok",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(FinanceApiError);
    expect((err as FinanceApiError).code).toBe("internal");
  });
});

/* --------------------------------------------------------------- getPayments */

describe("getPayments", () => {
  it("GETs /api/finance/payments and returns the three columns adapted to FE items", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        approved: [paymentQueueItem()],
        processing: [
          paymentQueueItem({
            id: "clm-1005",
            reference: "EXP-2026-1005",
            status: "processing",
            payment: paymentRow(),
          }),
        ],
        paid: [
          paymentQueueItem({
            id: "clm-1006",
            reference: "EXP-2026-1006",
            status: "paid",
            payment: paymentRow({ status: "paid", processedAt: "2026-08-02T10:00:00Z" }),
          }),
        ],
      }),
    );

    const result = await getPayments();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/finance/payments`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(result.approved).toHaveLength(1);
    expect(result.processing).toHaveLength(1);
    expect(result.paid).toHaveLength(1);
    expect(result.approved[0].employeeName).toBe("Aulia Pratiwi");
    expect(result.processing[0].payment?.reference).toBe("TRX-881234");
    // Paid row: processedAt (overwritten at paid time) maps onto paidAt.
    expect(result.paid[0].payment?.paidAt).toBe("2026-08-02T10:00:00Z");
    expect(result.paid[0].payment?.paidBy).toBe("u-fin-1");
  });

  it("throws FinanceApiError 403 forbidden on non-Finance-Admin access", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } }),
    );
    await expect(getPayments()).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

/* --------------------------------------------------------------- markProcessing */

describe("markProcessing", () => {
  it("POSTs method + reference and returns the adapted claim + payment", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        claim: exceptionItem({ status: "processing" }),
        payment: paymentRow(),
      }),
    );

    const result = await markProcessing("clm-1004", {
      method: "bank_transfer",
      reference: "TRX-881234",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/finance/payments/clm-1004/processing`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      method: "bank_transfer",
      reference: "TRX-881234",
    });
    expect(result.claim.status).toBe("processing");
    expect(result.payment.reference).toBe("TRX-881234");
    expect(result.payment.method).toBe("bank_transfer");
  });

  it("throws a 400 validation_required typed error when the reference is missing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          code: "validation_required",
          message: "Payment method and reference number are required",
        },
      }),
    );
    await expect(
      markProcessing("clm-1004", { method: "bank_transfer", reference: "" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "validation_required",
      message: "Payment method and reference number are required",
    });
  });

  it("throws a 409 stale_decision typed error when the claim is not approved", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: { code: "stale_decision", message: "Claim is paid; expected approved" },
      }),
    );
    const err = await markProcessing("clm-1004", {
      method: "bank_transfer",
      reference: "TRX-x",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(FinanceApiError);
    expect((err as FinanceApiError).code).toBe("stale_decision");
    expect((err as FinanceApiError).status).toBe(409);
  });

  it("throws a 403 forbidden typed error on non-Finance-Admin access", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Forbidden." } }),
    );
    await expect(
      markProcessing("clm-1004", { method: "bank_transfer", reference: "TRX-x" }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

/* --------------------------------------------------------------- markPaid */

describe("markPaid", () => {
  it("POSTs (no body) and returns the adapted claim + payment with paidAt populated", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        claim: exceptionItem({ status: "paid" }),
        payment: paymentRow({ status: "paid", processedAt: "2026-08-03T10:00:00Z" }),
      }),
    );

    const result = await markPaid("clm-1005");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/finance/payments/clm-1005/paid`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(result.claim.status).toBe("paid");
    expect(result.payment.paidAt).toBe("2026-08-03T10:00:00Z");
    expect(result.payment.paidBy).toBe("u-fin-1");
  });

  it("throws a 409 stale_decision typed error when the claim is not processing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: { code: "stale_decision", message: "Claim is approved; expected processing" },
      }),
    );
    await expect(markPaid("clm-1005")).rejects.toMatchObject({
      status: 409,
      code: "stale_decision",
    });
  });

  it("throws a 409 stale_decision typed error when no payments row exists", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: { code: "stale_decision", message: "Claim is approved; expected processing" },
      }),
    );
    await expect(markPaid("clm-no-payment-row")).rejects.toMatchObject({
      code: "stale_decision",
    });
  });
});

/* --------------------------------------------------------------- getDashboard */

describe("getDashboard", () => {
  it("composes the dashboard from parallel getExceptions + getPayments calls", async () => {
    routeFetch({
      "GET /api/finance/exceptions": () =>
        jsonResponse(200, { items: [exceptionItem()] }),
      "GET /api/finance/payments": () =>
        jsonResponse(200, {
          approved: [paymentQueueItem()],
          processing: [
            paymentQueueItem({
              id: "clm-p1",
              reference: "EXP-2026-P1",
              status: "processing",
              totalAmount: 1_000_000,
              payment: paymentRow(),
            }),
          ],
          paid: [
            paymentQueueItem({
              id: "clm-pd1",
              reference: "EXP-2026-PD1",
              status: "paid",
              totalAmount: 2_000_000,
              payment: paymentRow({ status: "paid" }),
            }),
          ],
        }),
    });

    const data = await getDashboard();

    // Both endpoints were hit exactly once.
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.filter((u) => u.endsWith("/api/finance/exceptions"))).toHaveLength(1);
    expect(urls.filter((u) => u.endsWith("/api/finance/payments"))).toHaveLength(1);

    // Composed counts mirror the underlying reads.
    expect(data.openExceptionCount).toBe(1);
    expect(data.readyToPayCount).toBe(1);
    expect(data.inFlightCount).toBe(1);
    expect(data.paidCount).toBe(1);
    expect(data.hasAnyPaymentActivity).toBe(true);
    // Totals derived from BE totalAmount.
    expect(data.readyToPayAmount).toBe(4_787_000);
    expect(data.inFlightAmount).toBe(1_000_000);
    expect(data.paidAmount).toBe(2_000_000);
    // Groups present for every lifecycle stage.
    expect(data.groups.map((g) => g.status)).toEqual([
      "approved",
      "processing",
      "paid",
    ]);
  });

  it("keeps totals consistent (zero) when no claims are Processing or Paid", async () => {
    routeFetch({
      "GET /api/finance/exceptions": () => jsonResponse(200, { items: [] }),
      "GET /api/finance/payments": () =>
        jsonResponse(200, {
          approved: [paymentQueueItem()],
          processing: [],
          paid: [],
        }),
    });

    const data = await getDashboard();
    expect(data.openExceptionCount).toBe(0);
    expect(data.inFlightCount).toBe(0);
    expect(data.paidCount).toBe(0);
    expect(data.inFlightAmount).toBe(0);
    expect(data.paidAmount).toBe(0);
    expect(data.readyToPayCount).toBe(1);
    expect(data.hasAnyPaymentActivity).toBe(true);
  });

  it("surfaces hasAnyPaymentActivity=false when every column is empty", async () => {
    routeFetch({
      "GET /api/finance/exceptions": () => jsonResponse(200, { items: [] }),
      "GET /api/finance/payments": () =>
        jsonResponse(200, { approved: [], processing: [], paid: [] }),
    });
    const data = await getDashboard();
    expect(data.hasAnyPaymentActivity).toBe(false);
  });

  it("propagates a 403 from either underlying call as a FinanceApiError", async () => {
    routeFetch({
      "GET /api/finance/exceptions": () =>
        jsonResponse(403, { error: { code: "forbidden", message: "Finance only." } }),
      "GET /api/finance/payments": () => jsonResponse(200, { approved: [], processing: [], paid: [] }),
    });
    await expect(getDashboard()).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

/* --------------------------------------------------------------- toFEPayment adapter */

describe("toFEPayment", () => {
  it("maps a processing row onto processedAt/processedBy and leaves paid fields unset", () => {
    const p = toFEPayment(paymentRow({ status: "processing" }));
    expect(p.reference).toBe("TRX-881234");
    expect(p.method).toBe("bank_transfer");
    expect(p.processedAt).toBe("2026-08-01T10:00:00Z");
    expect(p.processedBy).toBe("u-fin-1");
    expect(p.paidAt).toBeUndefined();
    expect(p.paidBy).toBeUndefined();
  });

  it("maps a paid row's processedAt/processedBy onto paidAt/paidBy (BE overwrites them at paid time)", () => {
    const p = toFEPayment(
      paymentRow({ status: "paid", processedAt: "2026-08-02T10:00:00Z", processedBy: "u-fin-2" }),
    );
    expect(p.paidAt).toBe("2026-08-02T10:00:00Z");
    expect(p.paidBy).toBe("u-fin-2");
    expect(p.processedAt).toBeUndefined();
    expect(p.processedBy).toBeUndefined();
  });

  it("tolerates null processedAt / processedBy", () => {
    const p = toFEPayment(paymentRow({ processedAt: null, processedBy: null }));
    expect(p.processedAt).toBeUndefined();
    expect(p.processedBy).toBeUndefined();
  });
});

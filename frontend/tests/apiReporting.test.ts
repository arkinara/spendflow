import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getReport,
  exportCsv,
  reportCsvFilename,
  ReportingApiError,
  type ReportRow,
  type ReportResult,
} from "@/lib/api/reporting";
import { EMPTY_FILTERS, type ReportFilters } from "@/lib/utils/reportFilter";
import { BE_URL } from "@/lib/auth/apiClient";

/**
 * Unit tests for the Reporting HTTP client (ticket #23). `fetch` is stubbed
 * per test so nothing hits a real backend. Error envelopes use the same
 * `{ error: { code, message } }` shape `jsonError` (routes/claims.ts) emits,
 * mounted on the reporting router via `reportingErrorHandler` (routes/reporting.ts).
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

function reportRow(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    claimId: "clm-1001",
    reference: "EXP-2026-1001",
    employeeId: "u-emp-1",
    employeeName: "Sari Wijaya",
    department: "Sales",
    lineItemId: "clm-1001-li-1",
    categoryId: "flight",
    categoryName: "Flight",
    description: "Round trip",
    date: "2026-07-01",
    amount: 4_500_000,
    currency: "IDR",
    status: "approved",
    paymentReference: null,
    submittedAt: "2026-07-02",
    ...overrides,
  };
}

/* =============================================================== getReport */

describe("getReport", () => {
  it("builds the query string from filters and parses the JSON report", async () => {
    const result: ReportResult = {
      rows: [reportRow()],
      totals: [{ currency: "IDR", total: 4_500_000, count: 1 }],
      claimCount: 1,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, result));

    const filters: ReportFilters = {
      ...EMPTY_FILTERS,
      dateStart: "2026-07-01",
      dateEnd: "2026-07-31",
      departments: ["Sales"],
      categories: ["flight"],
      statuses: ["approved"],
    };
    const got = await getReport(filters);

    expect(got).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `${BE_URL}/api/reports?start=2026-07-01&end=2026-07-31&dept=Sales&cat=flight&status=approved`
    );
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
  });

  it("omits the query string entirely when every filter is unset", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { rows: [], totals: [], claimCount: 0 })
    );
    await getReport(EMPTY_FILTERS);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BE_URL}/api/reports`);
  });

  it("throws ReportingApiError(400, empty_filter) when the BE rejects an empty filter set", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: { code: "empty_filter", message: "At least one filter is required" },
      })
    );
    await expect(getReport(EMPTY_FILTERS)).rejects.toMatchObject({
      status: 400,
      code: "empty_filter",
    });
  });

  it("throws ReportingApiError(400, inverted_date_range) for an inverted range", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(400, {
        error: { code: "inverted_date_range", message: "`end` must be on or after `start`" },
      })
    );
    const filters: ReportFilters = {
      ...EMPTY_FILTERS,
      dateStart: "2026-07-31",
      dateEnd: "2026-07-01",
    };
    await expect(getReport(filters)).rejects.toThrow(ReportingApiError);
    await expect(getReport(filters)).rejects.toMatchObject({
      status: 400,
      code: "inverted_date_range",
      message: "`end` must be on or after `start`",
    });
  });

  it("throws ReportingApiError(400, unknown_status) for a bad status enum", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: { code: "unknown_status", message: "Unknown status value: bogus" },
      })
    );
    await expect(
      getReport({ ...EMPTY_FILTERS, statuses: ["bogus" as never] })
    ).rejects.toMatchObject({ status: 400, code: "unknown_status" });
  });

  it("throws ReportingApiError(403, forbidden) for non-Finance-Admin callers", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance Admin access required" } })
    );
    await expect(
      getReport({ ...EMPTY_FILTERS, statuses: ["approved"] })
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

/* =============================================================== exportCsv */

describe("exportCsv", () => {
  it("returns a text/csv Blob on success", async () => {
    const csvBody = "claim_id,employee\r\nEXP-2026-1001,Sari Wijaya";
    fetchMock.mockResolvedValueOnce(
      new Response(csvBody, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="spendflow-report-20260731-093015.csv"',
        },
      })
    );
    const filters: ReportFilters = {
      ...EMPTY_FILTERS,
      dateStart: "2026-07-01",
      dateEnd: "2026-07-31",
    };
    const blob = await exportCsv(filters);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toMatch(/text\/csv/);
    // jsdom's Blob lacks `.text()`; round-trip through Response, which
    // accepts any Blob-like body regardless of realm.
    const text = await new Response(blob).text();
    expect(text).toBe(csvBody);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BE_URL}/api/reports/export.csv?start=2026-07-01&end=2026-07-31`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
  });

  it("throws ReportingApiError(400, date_range_required) when a date is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: { code: "date_range_required", message: "CSV export requires both start and end dates" },
      })
    );
    await expect(exportCsv({ ...EMPTY_FILTERS, dateStart: "2026-07-01" })).rejects.toMatchObject({
      status: 400,
      code: "date_range_required",
    });
  });

  it("throws ReportingApiError(403, forbidden) for non-Finance-Admin callers", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance Admin access required" } })
    );
    await expect(
      exportCsv({ ...EMPTY_FILTERS, dateStart: "2026-07-01", dateEnd: "2026-07-31" })
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("propagates a network failure so the caller can show a retry state", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      exportCsv({ ...EMPTY_FILTERS, dateStart: "2026-07-01", dateEnd: "2026-07-31" })
    ).rejects.toThrow("Failed to fetch");
  });
});

/* ======================================================= reportCsvFilename */

describe("reportCsvFilename", () => {
  it("formats a zero-padded, sortable timestamp", () => {
    const name = reportCsvFilename(new Date(2026, 6, 31, 9, 3, 5));
    expect(name).toBe("spendflow-report-20260731-090305.csv");
  });
});

/* ============================================================================
 * SpendFlow — Reporting & CSV export API tests (ticket #16, BE-reporting).
 *
 * Covers the seven sub-features required by the ticket:
 *   (a) filter combinations (date + dept + category + status)
 *   (b) per-currency totals (incl. mixed-currency)
 *   (c) CSV row/field correctness with RFC-4180 escaping
 *   (d) inverted date range rejected
 *   (e) empty filter set / missing date range rejected
 *   (f) non-Finance-Admin caller rejected (403)
 *   (g) unknown enum (status, category) rejected
 * ========================================================================== */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  categoriesTable,
  claimLineItemsTable,
  claimsTable,
  paymentsTable,
  type ClaimStatus,
} from "../src/db/schema.js";
import {
  DEMO,
  authedGet,
  bootstrap,
  login,
  provisionSeedUser,
  type Harness,
} from "./helpers.js";

let h: Harness;
let employeeCookie: string;
let approverCookie: string;
let financeCookie: string;

beforeEach(async () => {
  h = await bootstrap();
  employeeCookie = (await login(h.app, DEMO.employee.email)).cookie!;
  approverCookie = (await login(h.app, DEMO.approver.email)).cookie!;
  financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;
});
afterEach(() => h.cleanup());

/* ----------------------------------------------------------------- helpers */

interface SeedLine {
  categoryId: string;
  amount: number;
  currency?: string;
  description?: string;
  date?: string;
}

interface SeedPayment {
  reference: string;
  status?: "processing" | "paid";
  amount?: number;
  currency?: string;
}

/**
 * Insert a claim + its line items directly so tests can pin exact status /
 * submittedAt / currency / payment-reference values without driving the whole
 * approval lifecycle. Line-item ids are returned so assertions can target
 * specific rows.
 */
function seedClaim(opts: {
  id?: string;
  reference?: string;
  employeeId: string;
  status?: ClaimStatus;
  currency?: string;
  submittedAt?: Date | null;
  createdAt?: Date;
  lineItems: SeedLine[];
  payment?: SeedPayment;
}): { id: string; lineItemIds: string[] } {
  const now = opts.createdAt ?? new Date("2026-07-15T10:00:00.000Z");
  const claimId = opts.id ?? `clm-${Math.random().toString(36).slice(2, 9)}`;
  const reference =
    opts.reference ??
    `EXP-2026-${1000 + Math.floor(Math.random() * 9000)}`;

  h.db
    .insert(claimsTable)
    .values({
      id: claimId,
      reference,
      title: `Report test ${reference}`,
      purpose: "",
      employeeId: opts.employeeId,
      status: opts.status ?? "approved",
      currency: opts.currency ?? "IDR",
      approvalRouteId: null,
      currentStepIndex: 0,
      policyException: null,
      submittedAt: opts.submittedAt ?? now,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const lineItemIds: string[] = [];
  for (const l of opts.lineItems) {
    const lineId = `li-${Math.random().toString(36).slice(2, 10)}`;
    lineItemIds.push(lineId);
    h.db
      .insert(claimLineItemsTable)
      .values({
        id: lineId,
        claimId,
        categoryId: l.categoryId,
        description: l.description ?? "",
        date: l.date ?? "2026-07-15",
        amount: l.amount,
        currency: l.currency ?? opts.currency ?? "IDR",
        quantity: null,
        unitLabel: null,
        unitRate: null,
        hasReceipt: false,
        note: null,
        policyFlag: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  if (opts.payment) {
    h.db
      .insert(paymentsTable)
      .values({
        id: `pay-${Math.random().toString(36).slice(2, 9)}`,
        claimId,
        method: "bank_transfer",
        referenceNumber: opts.payment.reference,
        amount: opts.payment.amount ?? opts.lineItems.reduce((s, l) => s + l.amount, 0),
        currency: opts.payment.currency ?? opts.currency ?? "IDR",
        status: opts.payment.status ?? "paid",
        processedBy: DEMO.finance.id,
        processedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  return { id: claimId, lineItemIds };
}

/** Build a yyyy-mm-dd query string for the report endpoints. */
function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function reportJson(cookie: string, params: Record<string, string | undefined>) {
  const res = await authedGet(h.app, `/api/reports${qs(params)}`, cookie);
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.json().catch(() => null) };
}

async function reportCsv(cookie: string, params: Record<string, string | undefined>) {
  const res = await authedGet(h.app, `/api/reports/export.csv${qs(params)}`, cookie);
  return {
    status: res.status,
    text: res.status === 200 ? await res.text() : "",
    headers: res.headers,
  };
}

const ENG_EMP = { id: "u-eng-1", email: "eng.report@spendflow.example", name: "Eng Person", department: "Engineering" };

/* ======================================================================= */
/* (a) filter combinations                                                  */
/* ======================================================================= */

describe("report query — filter combinations (a)", () => {
  beforeEach(async () => {
    await provisionSeedUser(h, {
      id: ENG_EMP.id,
      name: ENG_EMP.name,
      email: ENG_EMP.email,
      role: "employee",
      department: ENG_EMP.department,
    });
  });

  it("filters by date range + status together", async () => {
    // Two approved in-range, one paid in-range, one approved out-of-range.
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      submittedAt: new Date("2026-07-10T00:00:00.000Z"),
      lineItems: [{ categoryId: "taxi", amount: 100_000 }],
    });
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      submittedAt: new Date("2026-07-20T00:00:00.000Z"),
      lineItems: [{ categoryId: "taxi", amount: 200_000 }],
    });
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "paid",
      submittedAt: new Date("2026-07-15T00:00:00.000Z"),
      lineItems: [{ categoryId: "taxi", amount: 50_000 }],
    });
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      submittedAt: new Date("2026-08-05T00:00:00.000Z"), // out of range
      lineItems: [{ categoryId: "taxi", amount: 999_999 }],
    });

    const { status, body } = await reportJson(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
      status: "approved",
    });
    expect(status).toBe(200);
    const amounts = body.rows.map((r: { amount: number }) => r.amount).sort((a: number, b: number) => a - b);
    // Only the two July-approved claims; paid + August excluded.
    expect(amounts).toEqual([100_000, 200_000]);
    expect(body.claimCount).toBe(2);
  });

  it("filters by department + category together", async () => {
    seedClaim({
      employeeId: ENG_EMP.id,
      status: "approved",
      lineItems: [
        { categoryId: "hotel", amount: 1_000_000 },
        { categoryId: "taxi", amount: 50_000 },
      ],
    });
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      lineItems: [{ categoryId: "hotel", amount: 800_000 }],
    });

    // Engineering + hotel → only the ENG hotel line should appear.
    const { status, body } = await reportJson(financeCookie, {
      start: "2026-01-01",
      end: "2026-12-31",
      dept: ENG_EMP.department,
      cat: "hotel",
    });
    expect(status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].amount).toBe(1_000_000);
    expect(body.rows[0].employeeName).toBe(ENG_EMP.name);
    expect(body.claimCount).toBe(1);
  });

  it("combines all four filter types and returns the correct intersection", async () => {
    // Match: Engineering, hotel, approved, July.
    seedClaim({
      employeeId: ENG_EMP.id,
      status: "approved",
      submittedAt: new Date("2026-07-12T00:00:00.000Z"),
      lineItems: [{ categoryId: "hotel", amount: 1_000_000 }],
      payment: { reference: "TRX-ENG-1" },
    });
    // Wrong dept.
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      submittedAt: new Date("2026-07-12T00:00:00.000Z"),
      lineItems: [{ categoryId: "hotel", amount: 1_000_000 }],
    });
    // Wrong category.
    seedClaim({
      employeeId: ENG_EMP.id,
      status: "approved",
      submittedAt: new Date("2026-07-12T00:00:00.000Z"),
      lineItems: [{ categoryId: "taxi", amount: 1_000_000 }],
    });
    // Wrong status.
    seedClaim({
      employeeId: ENG_EMP.id,
      status: "paid",
      submittedAt: new Date("2026-07-12T00:00:00.000Z"),
      lineItems: [{ categoryId: "hotel", amount: 1_000_000 }],
    });
    // Wrong date.
    seedClaim({
      employeeId: ENG_EMP.id,
      status: "approved",
      submittedAt: new Date("2026-08-12T00:00:00.000Z"),
      lineItems: [{ categoryId: "hotel", amount: 1_000_000 }],
    });

    const { status, body } = await reportJson(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
      dept: "Engineering",
      cat: "hotel",
      status: "approved",
    });
    expect(status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].paymentReference).toBe("TRX-ENG-1");
    expect(body.claimCount).toBe(1);
  });

  it("aggregates multi-line-item claims into per-line-item rows without dropping or duplicating", async () => {
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      lineItems: [
        { categoryId: "hotel", amount: 1_000_000 },
        { categoryId: "taxi", amount: 50_000 },
        { categoryId: "meals", amount: 100_000 },
      ],
    });
    const { status, body } = await reportJson(financeCookie, {
      start: "2026-01-01",
      end: "2026-12-31",
    });
    expect(status).toBe(200);
    expect(body.rows).toHaveLength(3);
    expect(new Set(body.rows.map((r: { claimId: string }) => r.claimId)).size).toBe(1);
    const cats = body.rows.map((r: { categoryId: string }) => r.categoryId).sort();
    expect(cats).toEqual(["hotel", "meals", "taxi"]);
  });
});

/* ======================================================================= */
/* (b) per-currency totals                                                  */
/* ======================================================================= */

describe("report query — per-currency totals (b)", () => {
  it("sums same-currency line items and reports the claim count", async () => {
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      currency: "IDR",
      lineItems: [
        { categoryId: "taxi", amount: 100_000 },
        { categoryId: "meals", amount: 250_000 },
      ],
    });
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      currency: "IDR",
      lineItems: [{ categoryId: "hotel", amount: 1_000_000 }],
    });
    const { status, body } = await reportJson(financeCookie, {
      start: "2026-01-01",
      end: "2026-12-31",
    });
    expect(status).toBe(200);
    expect(body.totals).toEqual([
      { currency: "IDR", total: 1_350_000, count: 3 },
    ]);
    expect(body.claimCount).toBe(2);
  });

  it("groups mixed-currency totals separately without FX conversion", async () => {
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      currency: "IDR",
      lineItems: [{ categoryId: "taxi", amount: 200_000 }],
    });
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      currency: "USD",
      lineItems: [
        { categoryId: "hotel", amount: 1_500, currency: "USD" },
        { categoryId: "meals", amount: 600, currency: "USD" },
      ],
    });
    const { status, body } = await reportJson(financeCookie, {
      start: "2026-01-01",
      end: "2026-12-31",
    });
    expect(status).toBe(200);
    // Sorted alphabetically: IDR, USD. No conversion.
    expect(body.totals).toEqual([
      { currency: "IDR", total: 200_000, count: 1 },
      { currency: "USD", total: 2_100, count: 2 },
    ]);
    expect(body.claimCount).toBe(2);
  });

  it("returns a zero total (not an error) for a filter set with no matches", async () => {
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      lineItems: [{ categoryId: "taxi", amount: 100_000 }],
    });
    const { status, body } = await reportJson(financeCookie, {
      start: "2026-01-01",
      end: "2026-01-31",
      status: "paid",
    });
    expect(status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.totals).toEqual([]);
    expect(body.claimCount).toBe(0);
  });
});

/* ======================================================================= */
/* (c) CSV export — row/field correctness + escaping                        */
/* ======================================================================= */

describe("CSV export — row/field correctness (c)", () => {
  it("emits the required header in the exact column order and one row per line item", async () => {
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      currency: "IDR",
      submittedAt: new Date("2026-07-15T03:00:00.000Z"),
      reference: "EXP-2026-7777",
      lineItems: [{ categoryId: "taxi", amount: 75_000 }],
      payment: { reference: "TRX-CSV-1" },
    });
    const { status, text } = await reportCsv(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
    });
    expect(status).toBe(200);
    const lines = text.split("\r\n");
    expect(lines[0]).toBe(
      "claim_id,employee,category,amount,currency,status,payment_reference,submitted_at"
    );
    expect(lines).toHaveLength(2); // header + 1 row
    const row = lines[1].split(",");
    expect(row[0]).toBe("EXP-2026-7777");
    expect(row[1]).toBe(DEMO.employee.name);
    expect(row[2]).toBe("Taxi"); // category name, not id
    expect(row[3]).toBe("75000");
    expect(row[4]).toBe("IDR");
    expect(row[5]).toBe("approved");
    expect(row[6]).toBe("TRX-CSV-1");
    expect(row[7]).toBe("2026-07-15");
  });

  it("matches the filtered JSON report row-for-row", async () => {
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      currency: "IDR",
      lineItems: [
        { categoryId: "hotel", amount: 1_000_000 },
        { categoryId: "taxi", amount: 50_000 },
      ],
    });
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      currency: "IDR",
      submittedAt: new Date("2026-08-01T00:00:00.000Z"),
      lineItems: [{ categoryId: "taxi", amount: 9_999_999 }],
    });

    const json = await reportJson(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
    });
    const csv = await reportCsv(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
    });
    expect(json.status).toBe(200);
    expect(csv.status).toBe(200);

    const csvRows = csv.text.split("\r\n").slice(1); // drop header
    expect(csvRows).toHaveLength(json.body.rows.length);
    // Same set of references; the out-of-range August claim is excluded in both.
    const refs = csvRows.map((r) => r.split(",")[0]).sort();
    const jsonRefs = json.body.rows.map((r: { reference: string }) => r.reference).sort();
    expect(refs).toEqual(jsonRefs);
    expect(refs).not.toContain(expect.stringContaining("9999999"));
  });

  it("escapes commas, double-quotes, and newlines per RFC-4180", async () => {
    // Employee name with a comma + quote + newline (extreme case).
    await provisionSeedUser(h, {
      id: "u-weird",
      name: 'Siti "Tari",\nJr.',
      email: "siti.weird@spendflow.example",
      role: "employee",
      department: "Operations",
    });
    seedClaim({
      employeeId: "u-weird",
      status: "approved",
      reference: "EXP-2026-ESCAPE",
      currency: "IDR",
      submittedAt: new Date("2026-07-15T00:00:00.000Z"),
      lineItems: [{ categoryId: "taxi", amount: 10_000 }],
    });

    const { status, text } = await reportCsv(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
    });
    expect(status).toBe(200);
    const lines = text.split("\r\n");
    // Header + exactly one data row (the embedded \n must NOT split the row).
    expect(lines).toHaveLength(2);
    const row = lines[1];
    // The employee field is quoted, with the embedded quote doubled and the
    // newline preserved inside the quotes.
    expect(row).toContain('"Siti ""Tari"",\nJr."');
    expect(row.startsWith("EXP-2026-ESCAPE,")).toBe(true);
  });

  it("sets Content-Type, Content-Disposition with timestamped filename, and no-store", async () => {
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      lineItems: [{ categoryId: "taxi", amount: 10_000 }],
    });
    const { status, headers } = await reportCsv(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
    });
    expect(status).toBe(200);
    expect(headers.get("content-type")).toContain("text/csv");
    const cd = headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^attachment; filename="spendflow-report-\d{8}-\d{6}\.csv"$/);
    expect(headers.get("cache-control")).toBe("no-store");
  });
});

/* ======================================================================= */
/* (d) inverted date range                                                  */
/* ======================================================================= */

describe("validation — inverted date range (d)", () => {
  it("rejects an inverted range on the JSON report endpoint", async () => {
    const { status, body } = await reportJson(financeCookie, {
      start: "2026-07-31",
      end: "2026-07-01",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("inverted_date_range");
  });

  it("rejects an inverted range on the CSV export endpoint", async () => {
    const { status, text } = await reportCsv(financeCookie, {
      start: "2026-07-31",
      end: "2026-07-01",
    });
    expect(status).toBe(400);
    expect(text).toBe("");
  });
});

/* ======================================================================= */
/* (e) empty filter set / missing date range                                */
/* ======================================================================= */

describe("validation — empty filter set / missing dates (e)", () => {
  it("rejects a completely empty filter set on the JSON report endpoint", async () => {
    const { status, body } = await reportJson(financeCookie, {});
    expect(status).toBe(400);
    expect(body.error.code).toBe("empty_filter");
  });

  it("rejects a CSV export missing both start and end dates", async () => {
    const { status } = await reportCsv(financeCookie, { status: "approved" });
    expect(status).toBe(400);
  });

  it("rejects a CSV export with start but no end (and vice-versa)", async () => {
    const onlyStart = await reportCsv(financeCookie, { start: "2026-07-01" });
    expect(onlyStart.status).toBe(400);
    const onlyEnd = await reportCsv(financeCookie, { end: "2026-07-31" });
    expect(onlyEnd.status).toBe(400);
  });

  it("accepts a partial (status-only) filter on the JSON report endpoint", async () => {
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      lineItems: [{ categoryId: "taxi", amount: 10_000 }],
    });
    const { status, body } = await reportJson(financeCookie, { status: "approved" });
    expect(status).toBe(200);
    expect(body.rows.length).toBeGreaterThan(0);
  });
});

/* ======================================================================= */
/* (f) non-Finance-Admin authorization                                      */
/* ======================================================================= */

describe("authorization (f)", () => {
  it("rejects an employee on both report endpoints with 403", async () => {
    const json = await reportJson(employeeCookie, { start: "2026-07-01", end: "2026-07-31" });
    expect(json.status).toBe(403);
    expect(json.body.error.code).toBe("forbidden");
    const csv = await reportCsv(employeeCookie, { start: "2026-07-01", end: "2026-07-31" });
    expect(csv.status).toBe(403);
  });

  it("rejects an approver on both report endpoints with 403", async () => {
    const json = await reportJson(approverCookie, { start: "2026-07-01", end: "2026-07-31" });
    expect(json.status).toBe(403);
    const csv = await reportCsv(approverCookie, { start: "2026-07-01", end: "2026-07-31" });
    expect(csv.status).toBe(403);
  });

  it("rejects an unauthenticated caller on both report endpoints", async () => {
    const resJson = await h.app.request("/api/reports?start=2026-07-01&end=2026-07-31");
    expect(resJson.status).toBe(401);
    const resCsv = await h.app.request("/api/reports/export.csv?start=2026-07-01&end=2026-07-31");
    expect(resCsv.status).toBe(401);
  });
});

/* ======================================================================= */
/* (g) unknown enum values                                                  */
/* ======================================================================= */

describe("validation — unknown enum (g)", () => {
  it("rejects an unknown status value on the JSON report endpoint", async () => {
    const { status, body } = await reportJson(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
      status: "not_a_status",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("unknown_status");
  });

  it("rejects an unknown status value on the CSV export endpoint", async () => {
    const { status } = await reportCsv(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
      status: "bogus",
    });
    expect(status).toBe(400);
  });

  it("rejects an unknown category id on the JSON report endpoint", async () => {
    const { status, body } = await reportJson(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
      cat: "no_such_category",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("unknown_category");
  });

  it("rejects an unknown category id on the CSV export endpoint", async () => {
    const { status } = await reportCsv(financeCookie, {
      start: "2026-07-01",
      end: "2026-07-31",
      cat: "ghost",
    });
    expect(status).toBe(400);
  });

  it("rejects a malformed start date (not silently ignored)", async () => {
    const { status, body } = await reportJson(financeCookie, {
      start: "07/15/2026",
      end: "2026-07-31",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_start");
  });
});

/* ======================================================================= */
/* guardrail: does not mutate claim/payment state                           */
/* ======================================================================= */

describe("read-only guardrail", () => {
  it("does not modify claims or payments when running a report", async () => {
    const { id } = seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      lineItems: [{ categoryId: "taxi", amount: 80_000 }],
      payment: { reference: "TRX-RO" },
    });
    const claimBefore = h.db.select().from(claimsTable).where(eq(claimsTable.id, id)).get();
    const paymentBefore = h.db.select().from(paymentsTable).where(eq(paymentsTable.claimId, id)).get();

    await reportJson(financeCookie, { start: "2026-01-01", end: "2026-12-31" });
    await reportCsv(financeCookie, { start: "2026-01-01", end: "2026-12-31" });

    const claimAfter = h.db.select().from(claimsTable).where(eq(claimsTable.id, id)).get();
    const paymentAfter = h.db.select().from(paymentsTable).where(eq(paymentsTable.claimId, id)).get();
    expect(claimAfter).toEqual(claimBefore);
    expect(paymentAfter).toEqual(paymentBefore);
    // Quiet unused-var lint in the linter's eyes; both are asserted above.
    expect(claimBefore).toBeDefined();
    expect(paymentBefore).toBeDefined();
  });

  it("ignores the deprecated category when it has been deactivated but still referenced", async () => {
    // Deactivate 'other' then confirm a historical claim referencing it still
    // reports (read-only join on categories by id, not active state).
    const other = h.db.select().from(categoriesTable).where(eq(categoriesTable.id, "other")).get();
    if (!other) return; // seeded by harness
    h.db
      .update(categoriesTable)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(categoriesTable.id, "other"))
      .run();
    seedClaim({
      employeeId: DEMO.employee.id,
      status: "approved",
      lineItems: [{ categoryId: "other", amount: 60_000 }],
    });
    const { status, body } = await reportJson(financeCookie, {
      start: "2026-01-01",
      end: "2026-12-31",
      cat: "other",
    });
    expect(status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].categoryName).toBe(other.name);
  });
});

/* ============================================================================
 * SpendFlow — mobile claim submission tests (ticket #88, Phase 2 mobile).
 *
 * Exercises POST /api/mobile/claims end-to-end: OcrDraft-shaped body in,
 * canonical claim out, with audit + notification parity asserted against the
 * same rows the web wizard's submit path writes.
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  DEMO,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";
import { notificationsTable } from "../src/db/schema.js";
import { listAuditForClaim } from "../src/services/audit.js";
import { ClaimError, parseIndonesianAmount } from "../src/services/mobile-claims.js";

let h: Harness;
let employeeCookie: string;

/** The concrete OcrDraft fixture from mobile/lib/data/fixtures.dart. */
const WARUNG_DRAFT = {
  merchant: "Warung Sederhana",
  date: "15/07/2026",
  amount: "391.830",
  tax: "38.830",
  currency: "IDR",
  category: "Meals",
  description: "Team dinner with PT Nusantara",
};

beforeEach(async () => {
  h = await bootstrap();
  const res = await login(h.app, DEMO.employee.email);
  expect(res.status).toBe(200);
  employeeCookie = res.cookie!;
});
afterEach(() => h.cleanup());

describe("POST /api/mobile/claims", () => {
  it("submits an OcrDraft and returns the canonical pending claim (audit + notification parity)", async () => {
    const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, {
      ...WARUNG_DRAFT,
      // Under the meals cap + receipt threshold so the happy path is clean.
      amount: "150.000",
      tax: "15.000",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.claim.status).toBe("pending");
    expect(body.claim.title).toBe("Warung Sederhana");
    expect(body.claim.currency).toBe("IDR");
    expect(body.claim.submittedAt).not.toBeNull();
    expect(body.claim.lineItems).toHaveLength(1);
    const line = body.claim.lineItems[0];
    expect(line.categoryId).toBe("meals");
    expect(line.amount).toBe(150000);
    expect(line.date).toBe("2026-07-15");
    expect(line.description).toBe("Team dinner with PT Nusantara");

    // Audit parity: the same claim.submitted row the web path writes.
    const audit = listAuditForClaim(h.db, body.claim.id);
    expect(audit.some((e) => e.action === "claim.submitted")).toBe(true);

    // Notification parity: the line manager (rt-default step 1) is notified.
    const notes = h.db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.claimId, body.claim.id))
      .all();
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.every((n) => n.recipientId === DEMO.approver.id)).toBe(true);
  });

  it("rejects a malformed amount string with 400", async () => {
    const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, {
      ...WARUNG_DRAFT,
      amount: "39.1.830",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("parseIndonesianAmount maps \"391.830\" to 391830 and rejects malformed input", () => {
    expect(parseIndonesianAmount("391.830")).toBe(391830);
    expect(parseIndonesianAmount("1.000.000")).toBe(1000000);
    expect(parseIndonesianAmount("150")).toBe(150);
    for (const bad of ["39.1.830", "-100", "1,000", "", "abc", "150000"]) {
      expect(() => parseIndonesianAmount(bad)).toThrow(ClaimError);
      try {
        parseIndonesianAmount(bad);
      } catch (err) {
        expect((err as ClaimError).code).toBe("invalid_amount");
        expect((err as ClaimError).status).toBe(400);
      }
    }
  });

  it("rejects an unknown category with 400 invalid_category", async () => {
    const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, {
      ...WARUNG_DRAFT,
      category: "Mystery",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_category");
  });

  it("stamps a non-blocking policyFlag when the amount exceeds the category cap", async () => {
    // Fixture amount 391.830 exceeds the seeded meals cap of 350.000.
    const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, WARUNG_DRAFT);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.claim.status).toBe("pending");
    const flag = body.claim.lineItems[0].policyFlag;
    expect(Array.isArray(flag)).toBe(true);
    expect(flag!.some((w: { type: string }) => w.type === "over_category_max")).toBe(true);
  });

  it("rejects an approver with 403 forbidden (employees only)", async () => {
    const res = await login(h.app, DEMO.approver.email);
    const approverCookie = res.cookie!;
    const submit = await authedPost(h.app, "/api/mobile/claims", approverCookie, WARUNG_DRAFT);
    expect(submit.status).toBe(403);
    const body = await submit.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await authedPost(h.app, "/api/mobile/claims", null, WARUNG_DRAFT);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
  });

  it("rejects a missing required field (merchant) with 400 invalid_body", async () => {
    const { merchant: _merchant, ...noMerchant } = WARUNG_DRAFT;
    const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, noMerchant);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("accepts an optional receiptUrl without error", async () => {
    const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, {
      ...WARUNG_DRAFT,
      amount: "150.000",
      tax: "15.000",
      receiptUrl: "https://files.example.com/receipts/warung.pdf",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.claim.lineItems[0].amount).toBe(150000);
  });

  it("rejects a separator-free amount over 3 digits with 400 invalid_body", async () => {
    const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, {
      ...WARUNG_DRAFT,
      amount: "150000",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("rejects a non-3-letter currency code with 400 invalid_body", async () => {
    const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, {
      ...WARUNG_DRAFT,
      currency: "ID",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("rejects a malformed tax string with 400 invalid_body", async () => {
    const res = await authedPost(h.app, "/api/mobile/claims", employeeCookie, {
      ...WARUNG_DRAFT,
      tax: "38,830",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });
});

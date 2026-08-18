/* ============================================================================
 * SpendFlow — OcrDraft → LineItem mapper tests (ticket #101).
 *
 * Unit coverage for the explicit ocrDraftToLineItem mapper extracted from
 * submitMobileClaim (#88). The mapper is the single seam where the mobile
 * app's flat OcrDraft shape (Indonesian "391.830" strings, DD/MM/YYYY dates,
 * category labels) becomes the canonical LineItem the web wizard produces, so
 * a phone submission is byte-identical to a web submission for the same data.
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, DEMO, type Harness } from "./helpers.js";
import {
  ClaimError,
  ocrDraftToLineItem,
  submitMobileClaim,
} from "../src/services/mobile-claims.js";
import { createClaim } from "../src/services/claims.js";

let h: Harness;

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
});
afterEach(() => h.cleanup());

describe("ocrDraftToLineItem (#101)", () => {
  it("maps a full Warung Sederhana draft onto one canonical line (amount int, ISO date, category id, currency)", () => {
    const { line, flags } = ocrDraftToLineItem(h.db, WARUNG_DRAFT);
    expect(line.amount).toBe(391830);
    expect(line.date).toBe("2026-07-15");
    // VERIFIED #101: the web sends the category ROW id ("meals"), not the
    // display code ("MEL") — label → row.id keeps phone ↔ web identical.
    expect(line.categoryId).toBe("meals");
    expect(line.currency).toBe("IDR");
    expect(line.description).toBe("Team dinner with PT Nusantara");
    // Policy flags are stamped by the submit pass, never by a draft mapping.
    expect(flags).toEqual([]);
    expect(line.note).toBeUndefined();
  });

  it("composes merchant → claim title and description → line description (mirrors the web wizard)", async () => {
    const result = await submitMobileClaim(h.db, DEMO.employee.id, WARUNG_DRAFT);
    expect(result.claim.title).toBe("Warung Sederhana");
    expect(result.claim.lineItems[0].description).toBe(
      "Team dinner with PT Nusantara"
    );
  });

  it("folds tax into the confirmed total exactly like the web — no separate line.tax field", () => {
    const { line } = ocrDraftToLineItem(h.db, {
      ...WARUNG_DRAFT,
      amount: "150.000",
      tax: "15.000",
    });
    // The OCR amount already includes tax; the canonical line has no tax
    // column (verified against the web LineItem shape), so nothing is dropped
    // and nothing extra is added.
    expect(line.amount).toBe(150000);
    expect(line).not.toHaveProperty("tax");
  });

  it('parses Indonesian amount "391.830" to minor-units int 391830', () => {
    expect(ocrDraftToLineItem(h.db, WARUNG_DRAFT).line.amount).toBe(391830);
    expect(
      ocrDraftToLineItem(h.db, { ...WARUNG_DRAFT, amount: "1.000.000" }).line
        .amount
    ).toBe(1000000);
  });

  it('converts DD/MM/YYYY "15/07/2026" to ISO "2026-07-15"', () => {
    expect(ocrDraftToLineItem(h.db, WARUNG_DRAFT).line.date).toBe("2026-07-15");
    expect(
      ocrDraftToLineItem(h.db, { ...WARUNG_DRAFT, date: "1/2/2026" }).line.date
    ).toBe("2026-02-01");
  });

  it('resolves category label "Meals" → category row id "meals" case-insensitively', () => {
    for (const name of ["Meals", "meals", "MEALS"]) {
      const { line } = ocrDraftToLineItem(h.db, {
        ...WARUNG_DRAFT,
        category: name,
      });
      expect(line.categoryId).toBe("meals");
    }
  });

  it("throws ClaimError invalid_category (400) on an unknown category label", () => {
    expect(() =>
      ocrDraftToLineItem(h.db, { ...WARUNG_DRAFT, category: "Mystery" })
    ).toThrow(ClaimError);
    try {
      ocrDraftToLineItem(h.db, { ...WARUNG_DRAFT, category: "Mystery" });
    } catch (err) {
      const e = err as ClaimError;
      expect(e.code).toBe("invalid_category");
      expect(e.status).toBe(400);
    }
  });

  it("maps receiptUrl to line.note (real attachment rows are #103)", () => {
    const { line } = ocrDraftToLineItem(h.db, {
      ...WARUNG_DRAFT,
      receiptUrl: "https://files.example.com/receipts/warung.pdf",
    });
    expect(line.note).toBe("https://files.example.com/receipts/warung.pdf");
  });

  it("produces a byte-identical line row to the web wizard for the same category/amount/date", () => {
    // Web wizard: createClaim with a categoryId/ISO-date/amount line payload.
    const web = createClaim(h.db, DEMO.employee.id, {
      title: "Warung Sederhana",
      purpose: "Team dinner with PT Nusantara",
      currency: "IDR",
      lineItems: [
        {
          categoryId: "meals",
          description: "Team dinner with PT Nusantara",
          date: "2026-07-15",
          amount: 391830,
          currency: "IDR",
        },
      ],
    });
    // Mobile: the same data through the explicit mapper.
    const { line } = ocrDraftToLineItem(h.db, WARUNG_DRAFT);
    const mobile = createClaim(h.db, DEMO.employee.id, {
      title: "Warung Sederhana",
      purpose: "Team dinner with PT Nusantara",
      currency: "IDR",
      lineItems: [line],
    });

    const a = web.lineItems[0];
    const b = mobile.lineItems[0];
    expect(b.categoryId).toBe(a.categoryId);
    expect(b.description).toBe(a.description);
    expect(b.date).toBe(a.date);
    expect(b.amount).toBe(a.amount);
    expect(b.currency).toBe(a.currency);
    expect(b.quantity).toBe(a.quantity);
    expect(b.unitLabel).toBe(a.unitLabel);
    expect(b.unitRate).toBe(a.unitRate);
    expect(b.hasReceipt).toBe(a.hasReceipt);
    expect(b.note).toBe(a.note);
    // Top-level claim shape identical too.
    expect(mobile.title).toBe(web.title);
    expect(mobile.purpose).toBe(web.purpose);
    expect(mobile.currency).toBe(web.currency);
  });
});

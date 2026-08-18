/* ============================================================================
 * SpendFlow — mobile draft persistence tests (ticket #100).
 *
 * Exercises PATCH /api/mobile/drafts/current end-to-end: the employee's
 * OcrDraft-shaped body is upserted into the per-user `mobile_drafts` row
 * (last write wins, one row per user).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  DEMO,
  authedPatch,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";
import { mobileDraftsTable } from "../src/db/schema.js";

let h: Harness;
let employeeCookie: string;

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

describe("PATCH /api/mobile/drafts/current", () => {
  it("saves a draft for the employee (200, draft round-trips)", async () => {
    const res = await authedPatch(
      h.app,
      "/api/mobile/drafts/current",
      employeeCookie,
      WARUNG_DRAFT
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toEqual(WARUNG_DRAFT);

    const row = h.db
      .select()
      .from(mobileDraftsTable)
      .where(eq(mobileDraftsTable.userId, DEMO.employee.id))
      .get();
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.draftJson)).toEqual(WARUNG_DRAFT);
    expect(row!.updatedAt).toBeTruthy();
  });

  it("upserts — a second PATCH overwrites, never duplicates the row", async () => {
    await authedPatch(
      h.app,
      "/api/mobile/drafts/current",
      employeeCookie,
      WARUNG_DRAFT
    );
    const edited = { ...WARUNG_DRAFT, merchant: "Warung Makan Bu Tini", amount: "150.000" };
    const res = await authedPatch(
      h.app,
      "/api/mobile/drafts/current",
      employeeCookie,
      edited
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.merchant).toBe("Warung Makan Bu Tini");

    const rows = h.db
      .select()
      .from(mobileDraftsTable)
      .where(eq(mobileDraftsTable.userId, DEMO.employee.id))
      .all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].draftJson)).toEqual(edited);
  });

  it("rejects an approver with 403 (employees only)", async () => {
    const approverLogin = await login(h.app, DEMO.approver.email);
    expect(approverLogin.status).toBe(200);
    const res = await authedPatch(
      h.app,
      "/api/mobile/drafts/current",
      approverLogin.cookie!,
      WARUNG_DRAFT
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("rejects a missing required field (merchant) with 400 invalid_body", async () => {
    const { merchant: _merchant, ...noMerchant } = WARUNG_DRAFT;
    const res = await authedPatch(
      h.app,
      "/api/mobile/drafts/current",
      employeeCookie,
      noMerchant
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await authedPatch(
      h.app,
      "/api/mobile/drafts/current",
      null,
      WARUNG_DRAFT
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
  });
});

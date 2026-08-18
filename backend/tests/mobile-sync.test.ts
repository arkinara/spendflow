/* ============================================================================
 * SpendFlow — mobile offline sync tests (ticket #100).
 *
 * Exercises POST /api/mobile/sync end-to-end: each queued OcrDraft is
 * submitted as its OWN claim; per-item failures are collected into `failed[]`
 * and the response is a partial-success 200, never a 500.
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";
import { eq } from "drizzle-orm";
import { claimsTable } from "../src/db/schema.js";

let h: Harness;
let employeeCookie: string;

const WARUNG_DRAFT = {
  merchant: "Warung Sederhana",
  date: "15/07/2026",
  amount: "150.000",
  tax: "15.000",
  currency: "IDR",
  category: "Meals",
  description: "Team dinner with PT Nusantara",
};
const TAXI_DRAFT = {
  merchant: "Bluebird Taxi",
  date: "16/07/2026",
  amount: "85.000",
  tax: "8.500",
  currency: "IDR",
  category: "Taxi",
  description: "Airport ride",
};

beforeEach(async () => {
  h = await bootstrap();
  const res = await login(h.app, DEMO.employee.email);
  expect(res.status).toBe(200);
  employeeCookie = res.cookie!;
});
afterEach(() => h.cleanup());

describe("POST /api/mobile/sync", () => {
  it("syncs 2 valid items into 2 separate claims (200 { synced: 2, failed: [] })", async () => {
    const res = await authedPost(h.app, "/api/mobile/sync", employeeCookie, {
      items: [WARUNG_DRAFT, TAXI_DRAFT],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(2);
    expect(body.failed).toEqual([]);

    const claims = h.db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.employeeId, DEMO.employee.id))
      .all();
    expect(claims).toHaveLength(2);
    expect(claims.map((c) => c.status)).toEqual(["pending", "pending"]);
  });

  it("partially succeeds — 1 valid + 1 invalid (unknown category) → { synced: 1, failed: [item] }", async () => {
    const bad = { ...WARUNG_DRAFT, category: "Mystery" };
    const res = await authedPost(h.app, "/api/mobile/sync", employeeCookie, {
      items: [TAXI_DRAFT, bad],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(1);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]).toEqual(bad);

    const claims = h.db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.employeeId, DEMO.employee.id))
      .all();
    expect(claims).toHaveLength(1);
    expect(claims[0].title).toBe("Bluebird Taxi");
  });

  it("rejects an empty items array with 400 no_items", async () => {
    const res = await authedPost(h.app, "/api/mobile/sync", employeeCookie, {
      items: [],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("no_items");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await authedPost(h.app, "/api/mobile/sync", null, {
      items: [WARUNG_DRAFT],
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
  });
});

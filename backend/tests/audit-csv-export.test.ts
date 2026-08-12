import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { DEMO, authedGet, bootstrap, login, type Harness } from "./helpers.js";
import { auditLogsTable } from "../src/db/schema.js";

/**
 * #72 — `GET /api/admin/audit.csv` returns the filtered audit log as an
 * RFC-4180 CSV download. Mirrors the audit-global.test.ts pattern: bootstrap
 * an isolated DB, seed `audit_logs` rows directly so the date range +
 * ordering assertions get deterministic timestamps, then assert the HTTP
 * response (headers + body).
 *
 * `writeAudit` stamps `new Date()`; we bypass it and write rows directly so
 * we can pin exact `created_at` values for the filter + RFC-4180 escaping
 * tests.
 *
 * The body starts with a UTF-8 BOM (`\uFEFF`) so Excel opens it as UTF-8;
 * assertions strip the BOM before splitting on CRLF.
 */

let h: Harness;
const T0 = new Date("2026-08-01T00:00:00Z");
const T1 = new Date("2026-08-05T00:00:00Z");
const T2 = new Date("2026-08-10T00:00:00Z");
const T3 = new Date("2026-08-20T00:00:00Z");
const T4 = new Date("2026-08-28T00:00:00Z");

function seedAudit(args: {
  id: string;
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  createdAt: Date;
}) {
  h.db
    .insert(auditLogsTable)
    .values({
      id: args.id,
      actorId: args.actorId ?? DEMO.finance.id,
      action: args.action,
      entityType: args.entityType ?? "user",
      entityId: args.entityId ?? DEMO.employee.id,
      before:
        args.before === undefined ? null : JSON.stringify(args.before),
      after: args.after === undefined ? null : JSON.stringify(args.after),
      createdAt: args.createdAt,
    })
    .run();
}

/** Drop the leading BOM (`\uFEFF`) the BE emits for Excel compatibility. */
function stripBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

beforeEach(async () => {
  h = await bootstrap();
});

afterEach(() => {
  h.cleanup();
});

describe("GET /api/admin/audit.csv (#72)", () => {
  it("emits the required header, one row per entry, and resolves actor/target emails", async () => {
    seedAudit({
      id: "a1",
      action: "role.change",
      actorId: DEMO.finance.id,
      entityId: DEMO.employee.id,
      before: { role: "employee" },
      after: { role: "approver" },
      createdAt: T2,
    });

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(h.app, "/api/admin/audit.csv", cookie);
    expect(res.status).toBe(200);

    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^attachment; filename="audit-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.csv"$/);

    const text = stripBom(await res.text());
    const lines = text.split("\r\n");
    expect(lines[0]).toBe(
      "id,action,actor_email,target_email,before,after,created_at_iso",
    );
    expect(lines).toHaveLength(2); // header + 1 row

    const row = lines[1].split(",");
    expect(row[0]).toBe("a1");
    expect(row[1]).toBe("role.change");
    expect(row[2]).toBe(DEMO.finance.email);
    expect(row[3]).toBe(DEMO.employee.email);
    expect(row[6]).toBe(T2.toISOString());
  });

  it("applies the same filters as the JSON endpoint (action + date range)", async () => {
    seedAudit({ id: "a", action: "role.change", createdAt: T0 }); // out of range
    seedAudit({ id: "b", action: "role.change", createdAt: T2 }); // in range, matches
    seedAudit({ id: "c", action: "manager.change", createdAt: T2 }); // in range, wrong action
    seedAudit({ id: "d", action: "role.change", createdAt: T4 }); // out of range

    const from = Math.floor(T1.getTime() / 1000);
    const to = Math.floor(T3.getTime() / 1000);

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(
      h.app,
      `/api/admin/audit.csv?action=role.change&from=${from}&to=${to}`,
      cookie,
    );
    expect(res.status).toBe(200);

    const text = stripBom(await res.text());
    const lines = text.split("\r\n");
    // header + exactly the one matching row
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith("b,")).toBe(true);
  });

  it("escapes commas, double-quotes, and newlines per RFC-4180", async () => {
    // Action / before / after all carry comma + double-quote + newline; the
    // row must stay a single physical line (JSON.stringify escapes the raw
    // \n to the 2-char sequence `\n`, and the comma+quote triggers RFC-4180
    // quoting which doubles every `"` in the JSON output).
    const beforeValue = { note: 'has "quotes",\nand commas' };
    const afterValue = { note: 'more "quotes",\nhere too' };
    seedAudit({
      id: "esc-1",
      action: "override",
      before: beforeValue,
      after: afterValue,
      createdAt: T2,
    });

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(h.app, "/api/admin/audit.csv", cookie);
    expect(res.status).toBe(200);

    const text = stripBom(await res.text());
    const lines = text.split("\r\n");
    // header + exactly one data row — the JSON-escaped \n + the comma/quote
    // escaping must NOT split the row across physical lines.
    expect(lines).toHaveLength(2);
    const row = lines[1];

    // Reconstruct the expected `before`/`after` CSV cells from the same
    // JSON.stringify the BE uses, then apply RFC-4180 doubling so the
    // assertion stays in lock-step with the implementation.
    const beforeCell = `"${JSON.stringify(beforeValue).replace(/"/g, '""')}"`;
    const afterCell = `"${JSON.stringify(afterValue).replace(/"/g, '""')}"`;
    expect(row).toContain(beforeCell);
    expect(row).toContain(afterCell);
    expect(row.startsWith("esc-1,override,")).toBe(true);

    // Sanity: the embedded newline is the JSON 2-char `\n`, NOT a raw LF —
    // so the data row stays exactly one physical line (asserted above by
    // the lines.toHaveLength(2) check).
  });

  it("rejects a non-Finance session with 403 forbidden", async () => {
    seedAudit({ id: "a1", action: "role.change", createdAt: T0 });
    const emp = await login(h.app, DEMO.employee.email);
    expect(emp.status).toBe(200);

    const res = await authedGet(h.app, "/api/admin/audit.csv", emp.cookie);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });
});

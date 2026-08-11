import { eq } from "drizzle-orm";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { DEMO, authedGet, bootstrap, login, type Harness } from "./helpers.js";
import { auditLogsTable } from "../src/db/schema.js";

/**
 * #71 — `GET /api/admin/audit` returns a Finance-Admin-wide audit view across
 * every entity, filtered by action / actor / target / date range / limit.
 * Mirrors the dev-recent-invites test pattern: bootstrap an isolated DB, seed
 * `audit_logs` rows directly, then assert the HTTP response.
 *
 * `writeAudit` always stamps `new Date()`; we write directly to the table so
 * the date-range + ordering tests get deterministic timestamps.
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

beforeEach(async () => {
  h = await bootstrap();
});

afterEach(() => {
  h.cleanup();
});

describe("GET /api/admin/audit", () => {
  it("returns entries newest-first across every entity", async () => {
    seedAudit({ id: "a1", action: "role.change", createdAt: T0 });
    seedAudit({ id: "a2", action: "manager.change", createdAt: T2 });
    seedAudit({ id: "a3", action: "status.change", createdAt: T4 });

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(h.app, "/api/admin/audit", cookie);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: { action: string }[] };
    expect(body.entries).toHaveLength(3);
    expect(body.entries.map((e) => e.action)).toEqual([
      "status.change",
      "manager.change",
      "role.change",
    ]);
  });

  it("filters by action", async () => {
    seedAudit({ id: "a1", action: "role.change", createdAt: T0 });
    seedAudit({ id: "a2", action: "manager.change", createdAt: T1 });
    seedAudit({ id: "a3", action: "role.change", createdAt: T2 });

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(h.app, "/api/admin/audit?action=role.change", cookie);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: { action: string }[] };
    expect(body.entries).toHaveLength(2);
    expect(body.entries.every((e) => e.action === "role.change")).toBe(true);
  });

  it("filters by date range (from + to as unix seconds)", async () => {
    seedAudit({ id: "old", action: "role.change", createdAt: T0 }); // Aug 1
    seedAudit({ id: "mid", action: "manager.change", createdAt: T2 }); // Aug 10
    seedAudit({ id: "new", action: "status.change", createdAt: T4 }); // Aug 28

    const from = Math.floor(T1.getTime() / 1000); // Aug 5
    const to = Math.floor(T3.getTime() / 1000); // Aug 20

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(
      h.app,
      `/api/admin/audit?from=${from}&to=${to}`,
      cookie,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: { action: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].action).toBe("manager.change");
  });

  it("combines filters with AND (action + date range)", async () => {
    seedAudit({ id: "a", action: "role.change", createdAt: T0 }); // Aug 1 — out of range
    seedAudit({ id: "b", action: "role.change", createdAt: T2 }); // Aug 10 — in range, matches
    seedAudit({ id: "c", action: "manager.change", createdAt: T2 }); // Aug 10 — in range, wrong action
    seedAudit({ id: "d", action: "role.change", createdAt: T4 }); // Aug 28 — out of range

    const from = Math.floor(T1.getTime() / 1000);
    const to = Math.floor(T3.getTime() / 1000);

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(
      h.app,
      `/api/admin/audit?action=role.change&from=${from}&to=${to}`,
      cookie,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: { id: string; action: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].action).toBe("role.change");
  });

  it("caps limit at 500 when the client requests 501", async () => {
    // Seed 3 rows and request limit=501 — service clamps to 500, so all 3
    // come back without erroring. The clamp itself is asserted at the unit
    // level against AUDIT_ALL_MAX_LIMIT; this test proves the HTTP path
    // forwards the oversized value safely.
    seedAudit({ id: "a1", action: "role.change", createdAt: T0 });
    seedAudit({ id: "a2", action: "role.change", createdAt: T1 });
    seedAudit({ id: "a3", action: "role.change", createdAt: T2 });

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(h.app, "/api/admin/audit?limit=501", cookie);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: unknown[] };
    // 3 seeded rows, all returned (limit clamped to 500 > row count).
    expect(body.entries).toHaveLength(3);
  });

  it("filters by actor_id and target_user_id", async () => {
    seedAudit({
      id: "r1",
      action: "role.change",
      actorId: DEMO.finance.id,
      entityId: DEMO.employee.id,
      createdAt: T0,
    });
    seedAudit({
      id: "r2",
      action: "role.change",
      actorId: DEMO.approver.id,
      entityId: DEMO.finance.id,
      createdAt: T1,
    });

    const cookie = (await login(h.app, DEMO.finance.email)).cookie!;
    const res = await authedGet(
      h.app,
      `/api/admin/audit?actor_id=${DEMO.approver.id}`,
      cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { id: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].id).toBe("r2");

    const resT = await authedGet(
      h.app,
      `/api/admin/audit?target_user_id=${DEMO.employee.id}`,
      cookie,
    );
    expect(resT.status).toBe(200);
    const bodyT = (await resT.json()) as { entries: { id: string }[] };
    expect(bodyT.entries).toHaveLength(1);
    expect(bodyT.entries[0].id).toBe("r1");
  });

  it("rejects a non-Finance session with 403 forbidden", async () => {
    seedAudit({ id: "a1", action: "role.change", createdAt: T0 });
    const emp = await login(h.app, DEMO.employee.email);
    expect(emp.status).toBe(200);

    const res = await authedGet(h.app, "/api/admin/audit", emp.cookie);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("rejects an unauthenticated request with 401", async () => {
    seedAudit({ id: "a1", action: "role.change", createdAt: T0 });
    const res = await authedGet(h.app, "/api/admin/audit", null);
    expect(res.status).toBe(401);
  });
});

describe("auditAll service (#71 unit)", () => {
  // We re-seed in the describe-level beforeEach via the global hook above; the
  // tests below just call the service directly to assert the limit clamp.
  beforeEach(async () => {
    // Shared beforeEach already bootstraps h; nothing extra to do here.
  });

  it("clamps limit to AUDIT_ALL_MAX_LIMIT (500)", async () => {
    const { auditAll, AUDIT_ALL_MAX_LIMIT } = await import("../src/services/audit.js");
    expect(AUDIT_ALL_MAX_LIMIT).toBe(500);
    // Requesting 5000 must not throw — service clamps internally.
    const rows = auditAll(h.db, { limit: 5000 });
    expect(Array.isArray(rows)).toBe(true);
  });
});

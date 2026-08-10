import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogsTable, usersTable } from "../src/db/schema.js";
import {
  DEMO,
  authedPatch,
  authedPost,
  bootstrap,
  login,
  provisionSeedUser,
  type Harness,
} from "./helpers.js";

/* ============================================================================
 * #53 — multi-role admin API surface.
 *
 * POST /api/admin/users and PATCH /api/admin/users/:id/role both accept a
 * `roles: Role[]` array (the legacy single-role field stays as a back-compat
 * alias that maps to a one-element array). Guards inherited from #33 + #43:
 * the last Finance Admin cannot be demoted, and the sole Approver with direct
 * reports cannot lose the approver role.
 * ========================================================================== */

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
});
afterEach(() => h.cleanup());

async function financeCookie() {
  const res = await login(h.app, DEMO.finance.email);
  expect(res.status).toBe(200);
  return res.cookie!;
}

function lastAuditFor(entityId: string) {
  return h.db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.entityId, entityId))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

async function postUsers(
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; body: unknown }> {
  const res = await authedPost(h.app, "/api/admin/users", cookie, body);
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { res, body: parsed };
}

describe("POST /api/admin/users — multi-role (#53)", () => {
  it("creates a user with roles: [employee, approver] (201, both roles persisted)", async () => {
    const cookie = await financeCookie();
    const { res, body } = await postUsers(cookie, {
      email: "multi@spendflow.example",
      name: "Multi Role",
      roles: ["employee", "approver"],
    });

    expect(res.status).toBe(201);
    const b = body as { user: { roles: string[]; primaryRole: string; role: string } };
    expect(b.user.roles).toEqual(["employee", "approver"]);
    expect(b.user.primaryRole).toBe("approver");
    // Legacy single-role view mirrors the derived primaryRole.
    expect(b.user.role).toBe("approver");

    const row = h.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, "multi@spendflow.example"))
      .get();
    expect(row?.roles).toBe('["employee","approver"]');
    expect(row?.primaryRole).toBe("approver");
  });

  it("creates a user with the legacy single-role field (201, roles=[role])", async () => {
    const cookie = await financeCookie();
    const { res, body } = await postUsers(cookie, {
      email: "legacy@spendflow.example",
      name: "Legacy Role",
      role: "finance",
    });

    expect(res.status).toBe(201);
    const b = body as { user: { roles: string[]; primaryRole: string; role: string } };
    expect(b.user.roles).toEqual(["finance"]);
    expect(b.user.primaryRole).toBe("finance");
    expect(b.user.role).toBe("finance");
  });

  it("rejects providing both `role` and `roles` with 400 invalid_body", async () => {
    const cookie = await financeCookie();
    const { res, body } = await postUsers(cookie, {
      email: "both@spendflow.example",
      name: "Both Forms",
      role: "employee",
      roles: ["employee"],
    });

    expect(res.status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_body");
  });

  it("rejects an empty roles array with 400 invalid_body", async () => {
    const cookie = await financeCookie();
    const { res, body } = await postUsers(cookie, {
      email: "empty@spendflow.example",
      name: "Empty Roles",
      roles: [],
    });

    expect(res.status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_body");
  });

  it("rejects an unknown role inside roles[] with 400 invalid_body", async () => {
    const cookie = await financeCookie();
    const { res, body } = await postUsers(cookie, {
      email: "unknown@spendflow.example",
      name: "Unknown Role",
      roles: ["employee", "superadmin"],
    });

    expect(res.status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_body");
  });
});

describe("PATCH /api/admin/users/:id/role — multi-role (#53)", () => {
  it("replaces the role set with roles: [employee, approver, finance] (200, audited)", async () => {
    const cookie = await financeCookie();
    // Two finance admins so the multi-role finance grant stays valid (the
    // target starts as employee, so demotion guards are irrelevant here).
    await provisionSeedUser(h, {
      id: "u-fin-backup",
      name: "Backup Finance",
      email: "backup.finance@spendflow.example",
      role: "finance",
    });

    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/role`,
      cookie,
      { roles: ["employee", "approver", "finance"], password: DEMO.password },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.roles).toEqual(["employee", "approver", "finance"]);
    expect(body.user.primaryRole).toBe("finance");

    const row = h.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, DEMO.employee.id))
      .get();
    expect(row?.roles).toBe('["employee","approver","finance"]');
    expect(row?.primaryRole).toBe("finance");

    const audit = lastAuditFor(DEMO.employee.id);
    expect(audit.action).toBe("role.change");
    expect(JSON.parse(audit.before)).toEqual({
      roles: ["employee"],
      primaryRole: "employee",
    });
    expect(JSON.parse(audit.after)).toEqual({
      roles: ["employee", "approver", "finance"],
      primaryRole: "finance",
    });
  });

  it("accepts the legacy single-role field as a one-element array (back-compat)", async () => {
    const cookie = await financeCookie();
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/role`,
      cookie,
      { role: "approver", password: DEMO.password },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.roles).toEqual(["approver"]);
    expect(body.user.primaryRole).toBe("approver");
    expect(body.user.role).toBe("approver");
  });

  it("rejects an empty roles array with 400 invalid_body", async () => {
    const cookie = await financeCookie();
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/role`,
      cookie,
      { roles: [] },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("rejects removing finance from the last active Finance Admin (#33 guard)", async () => {
    const cookie = await financeCookie();
    // DEMO.finance is the only active finance admin in the seeded harness;
    // the actor (also DEMO.finance) cannot drop the finance role — this is
    // both the self-demotion case and the last-finance case (the actor must
    // hold the finance role to reach this route, so the only reachable
    // "last finance" scenario is a self-demotion).
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.finance.id}/role`,
      cookie,
      { roles: ["employee"], password: DEMO.password },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("cannot_demote_last_finance");
    // Row untouched.
    const row = h.db
      .select({ primaryRole: usersTable.primaryRole })
      .from(usersTable)
      .where(eq(usersTable.id, DEMO.finance.id))
      .get();
    expect(row?.primaryRole).toBe("finance");
  });

  it("allows demoting a finance admin when a second active finance admin remains", async () => {
    const cookie = await financeCookie();
    await provisionSeedUser(h, {
      id: "u-fin-backup",
      name: "Backup Finance",
      email: "backup.finance@spendflow.example",
      role: "finance",
    });
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.finance.id}/role`,
      cookie,
      { roles: ["approver"], password: DEMO.password },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.roles).toEqual(["approver"]);
    expect(body.user.primaryRole).toBe("approver");
  });

  it("rejects removing approver from a user who still has direct reports", async () => {
    const cookie = await financeCookie();
    // DEMO.approver manages DEMO.employee — stripping approver would orphan
    // the employee's submitter_manager routing.
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.approver.id}/role`,
      cookie,
      { roles: ["employee"], password: DEMO.password },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("cannot_remove_only_approver_with_reports");
    expect(body.error.message).toMatch(/1 direct report/);
    // Approver row untouched.
    const row = h.db
      .select({ primaryRole: usersTable.primaryRole })
      .from(usersTable)
      .where(eq(usersTable.id, DEMO.approver.id))
      .get();
    expect(row?.primaryRole).toBe("approver");
  });

  it("allows removing approver once the direct reports are reassigned", async () => {
    const cookie = await financeCookie();
    // Clear the reporting line so the approver no longer has reports.
    await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/manager`,
      cookie,
      { managerId: null },
    );
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.approver.id}/role`,
      cookie,
      { roles: ["employee"], password: DEMO.password },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.roles).toEqual(["employee"]);
  });
});

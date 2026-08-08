import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogsTable, usersTable } from "../src/db/schema.js";
import { DEMO, authedGet, authedPatch, bootstrap, login, type Harness } from "./helpers.js";
import { provisionUser } from "../src/services/provision.js";

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

describe("users / roles / reporting-line admin API", () => {
  it("a Finance Admin can list all users via the API", async () => {
    const cookie = await financeCookie();
    const res = await authedGet(h.app, "/api/admin/users", cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.users.map((u: { id: string }) => u.id);
    expect(ids).toContain(DEMO.employee.id);
    expect(ids).toContain(DEMO.approver.id);
    expect(ids).toContain(DEMO.finance.id);
    // Password hash is never exposed.
    for (const u of body.users) {
      expect(u).not.toHaveProperty("passwordHash");
      expect(u).not.toHaveProperty("password_hash");
    }
  });

  it("changing a user's role is persisted and writes an audit_log entry", async () => {
    const cookie = await financeCookie();
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/role`,
      cookie,
      { role: "approver" }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.role).toBe("approver");

    // Persisted at the data layer.
    const row = h.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, DEMO.employee.id))
      .get();
    expect(row?.primaryRole).toBe("approver");
    expect(row?.roles).toBe('["approver"]');

    // Audit log captured actor + before/after (multi-role shape #53).
    const audit = lastAuditFor(DEMO.employee.id);
    expect(audit).toBeDefined();
    expect(audit.action).toBe("role.change");
    expect(audit.actorId).toBe(DEMO.finance.id);
    expect(JSON.parse(audit.before)).toEqual({ roles: ["employee"], primaryRole: "employee" });
    expect(JSON.parse(audit.after)).toEqual({ roles: ["approver"], primaryRole: "approver" });
  });

  it("assigning a manager to an Employee is retrievable via the API and recorded", async () => {
    const cookie = await financeCookie();
    await provisionUser(h.db, {
      id: "u-approver2",
      name: "Approver Two",
      email: "approver2@spendflow.example",
      password: "demo1234",
      role: "approver",
      roles: ["approver"],
    });
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/manager`,
      cookie,
      { managerId: "u-approver2" }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.managerId).toBe("u-approver2");

    // The audit trail reflects the change.
    const audit = lastAuditFor(DEMO.employee.id);
    expect(audit.action).toBe("manager.change");
    expect(JSON.parse(audit.before)).toEqual({ managerId: DEMO.approver.id });
    expect(JSON.parse(audit.after)).toEqual({ managerId: "u-approver2" });

    // And it is retrievable through the list endpoint.
    const list = await authedGet(h.app, "/api/admin/users", cookie);
    const userList = (await list.json()).users as Array<{ id: string; managerId: string }>;
    const emp = userList.find((u) => u.id === DEMO.employee.id);
    expect(emp?.managerId).toBe("u-approver2");
  });

  it("setting a user as their own manager is rejected with a validation error", async () => {
    const cookie = await financeCookie();
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/manager`,
      cookie,
      { managerId: DEMO.employee.id }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("self_manager");

    // Nothing was written.
    const row = h.db
      .select({ managerId: usersTable.managerId })
      .from(usersTable)
      .where(eq(usersTable.id, DEMO.employee.id))
      .get();
    expect(row?.managerId).toBe(DEMO.approver.id);
  });

  it("a transitive circular reporting line is rejected", async () => {
    const cookie = await financeCookie();
    // Build a clean chain: u-a → u-b → finance. Closing the loop by making
    // u-b report to u-a would create u-b → u-a → u-b (a cycle).
    await provisionUser(h.db, {
      id: "u-b",
      name: "User B",
      email: "b@spendflow.example",
      password: "demo1234",
      role: "approver",
      roles: ["approver"],
      managerId: DEMO.approver.id,
    });
    await provisionUser(h.db, {
      id: "u-a",
      name: "User A",
      email: "a@spendflow.example",
      password: "demo1234",
      role: "approver",
      roles: ["approver"],
      managerId: "u-b",
    });
    const res = await authedPatch(h.app, "/api/admin/users/u-b/manager", cookie, {
      managerId: "u-a",
    });
    expect([400, 409]).toContain(res.status);
    const body = await res.json();
    expect(body.error.code).toBe("cycle");
  });

  it("rejects assigning a manager with role=employee with 400 invalid_manager", async () => {
    const cookie = await financeCookie();
    await provisionUser(h.db, {
      id: "emp2",
      name: "Employee Two",
      email: "emp2@spendflow.example",
      password: "demo1234",
      role: "employee",
      roles: ["employee"],
    });
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/manager`,
      cookie,
      { managerId: "emp2" }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_manager");
    expect(body.error.message).toContain("Manager must be an Approver; user has role 'employee'");
  });

  it("rejects assigning a manager with role=finance with 400 invalid_manager", async () => {
    const cookie = await financeCookie();
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/manager`,
      cookie,
      { managerId: DEMO.finance.id }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_manager");
    expect(body.error.message).toContain("Manager must be an Approver; user has role 'finance'");
  });

  it("clearing a manager (null) is supported and audited (returns 200)", async () => {
    const cookie = await financeCookie();
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/manager`,
      cookie,
      { managerId: null }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.managerId).toBeNull();
    const audit = lastAuditFor(DEMO.employee.id);
    expect(audit.action).toBe("manager.change");
    expect(JSON.parse(audit.after)).toEqual({ managerId: null });
  });
});

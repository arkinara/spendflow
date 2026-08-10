import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountsTable,
  auditLogsTable,
  sessionsTable,
  userInvitationsTable,
  usersTable,
} from "../src/db/schema.js";
import {
  DEMO,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";
import { provisionUser } from "../src/services/provision.js";

// Replace writeAudit with a controllable spy so the atomicity case can force
// the audit write to throw mid-transaction. The default implementation calls
// through to the real writeAudit so every other test keeps real audit rows.
const auditMocks = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  realWriteAudit: null as null | ((...args: never[]) => unknown),
}));

vi.mock("../src/services/audit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/audit.js")>();
  auditMocks.realWriteAudit = actual.writeAudit as (...args: never[]) => unknown;
  return { ...actual, writeAudit: auditMocks.writeAudit };
});

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
  auditMocks.writeAudit.mockReset();
  auditMocks.writeAudit.mockImplementation((...args) =>
    auditMocks.realWriteAudit!(...args)
  );
});
afterEach(() => h.cleanup());

async function financeCookie() {
  const res = await login(h.app, DEMO.finance.email);
  expect(res.status).toBe(200);
  return res.cookie!;
}

async function createPendingUser(email: string) {
  const cookie = await financeCookie();
  const res = await authedPost(h.app, "/api/admin/users", cookie, {
    email,
    name: "Victim User",
    role: "employee",
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user: { id: string } };
  return { userId: body.user.id, cookie };
}

async function deleteUser(cookie: string, userId: string, password: string) {
  return authedPost(h.app, `/api/admin/users/${userId}/delete`, cookie, {
    password,
  });
}

describe("POST /api/admin/users/:id/delete", () => {
  it("hard-deletes a pending user with the actor's correct password (204)", async () => {
    const { userId, cookie } = await createPendingUser("victim1@spendflow.example");
    const res = await deleteUser(cookie, userId, DEMO.password);
    expect(res.status).toBe(204);
    expect(h.db.select().from(usersTable).where(eq(usersTable.id, userId)).get()).toBeUndefined();
  });

  it("hard-deletes a disabled user with the actor's correct password (204)", async () => {
    const cookie = await financeCookie();
    await provisionUser(h.db, {
      id: "u-disabled",
      name: "Disabled User",
      email: "disabled@spendflow.example",
      password: DEMO.password,
      role: "employee",
      roles: ["employee"],
      status: "disabled",
    });
    const res = await deleteUser(cookie, "u-disabled", DEMO.password);
    expect(res.status).toBe(204);
    expect(h.db.select().from(usersTable).where(eq(usersTable.id, "u-disabled")).get()).toBeUndefined();
  });

  it("rejects a wrong password with 401 invalid_password and leaves the user intact", async () => {
    const { userId, cookie } = await createPendingUser("wrongpw@spendflow.example");
    const res = await deleteUser(cookie, userId, "not-the-real-password");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_password");
    expect(h.db.select().from(usersTable).where(eq(usersTable.id, userId)).get()).toBeDefined();
  });

  it("rejects an empty password with 400 invalid_body (blocked at the schema layer)", async () => {
    const { userId, cookie } = await createPendingUser("emptypw@spendflow.example");
    const res = await deleteUser(cookie, userId, "");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_body");
    expect(h.db.select().from(usersTable).where(eq(usersTable.id, userId)).get()).toBeDefined();
  });

  it("rejects a missing password body with 400 invalid_body", async () => {
    const { userId, cookie } = await createPendingUser("nopw@spendflow.example");
    const res = await authedPost(h.app, `/api/admin/users/${userId}/delete`, cookie, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_body");
    expect(h.db.select().from(usersTable).where(eq(usersTable.id, userId)).get()).toBeDefined();
  });

  it("an Employee is forbidden (403)", async () => {
    const { userId } = await createPendingUser("emp403@spendflow.example");
    const emp = await login(h.app, DEMO.employee.email);
    expect(emp.status).toBe(200);
    const res = await deleteUser(emp.cookie!, userId, DEMO.password);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(h.db.select().from(usersTable).where(eq(usersTable.id, userId)).get()).toBeDefined();
  });

  it("an Approver is forbidden (403)", async () => {
    const { userId } = await createPendingUser("appr403@spendflow.example");
    const appr = await login(h.app, DEMO.approver.email);
    expect(appr.status).toBe(200);
    const res = await deleteUser(appr.cookie!, userId, DEMO.password);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(h.db.select().from(usersTable).where(eq(usersTable.id, userId)).get()).toBeDefined();
  });

  it("returns 404 not_found for an unknown user id", async () => {
    const cookie = await financeCookie();
    const res = await deleteUser(cookie, "no-such-user", DEMO.password);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("rejects deleting an active user with 409 before checking the password", async () => {
    const cookie = await financeCookie();
    // Correct password on an ACTIVE target must still 409: the status guard
    // runs first and the password is never consulted on this path.
    const res = await deleteUser(cookie, DEMO.employee.id, DEMO.password);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("cannot_delete_active_user");
    expect(h.db.select().from(usersTable).where(eq(usersTable.id, DEMO.employee.id)).get()).toBeDefined();
  });

  it("cascades to user_invitations, sessions and accounts", async () => {
    const { userId, cookie } = await createPendingUser("cascade@spendflow.example");
    const now = new Date();
    h.db.insert(sessionsTable).values({
      id: "sess-victim",
      token: "sess-token-victim",
      userId,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    }).run();

    const beforeInv = h.db.select().from(userInvitationsTable).where(eq(userInvitationsTable.userId, userId)).all().length;
    const beforeSess = h.db.select().from(sessionsTable).where(eq(sessionsTable.userId, userId)).all().length;
    const beforeAcc = h.db.select().from(accountsTable).where(eq(accountsTable.userId, userId)).all().length;
    expect(beforeInv).toBe(1);
    expect(beforeSess).toBe(1);
    expect(beforeAcc).toBe(1);

    const res = await deleteUser(cookie, userId, DEMO.password);
    expect(res.status).toBe(204);

    expect(h.db.select().from(userInvitationsTable).where(eq(userInvitationsTable.userId, userId)).all()).toHaveLength(0);
    expect(h.db.select().from(sessionsTable).where(eq(sessionsTable.userId, userId)).all()).toHaveLength(0);
    expect(h.db.select().from(accountsTable).where(eq(accountsTable.userId, userId)).all()).toHaveLength(0);
    expect(h.db.select().from(usersTable).where(eq(usersTable.id, userId)).get()).toBeUndefined();
  });

  it("writes a user.delete audit entry with actor + entity", async () => {
    const { userId, cookie } = await createPendingUser("audit@spendflow.example");
    const res = await deleteUser(cookie, userId, DEMO.password);
    expect(res.status).toBe(204);

    const entries = h.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "user.delete"))
      .all();
    expect(entries).toHaveLength(1);
    expect(entries[0].actorId).toBe(DEMO.finance.id);
    expect(entries[0].entityType).toBe("user");
    expect(entries[0].entityId).toBe(userId);
    expect(JSON.parse(entries[0].before)).toMatchObject({
      id: userId,
      email: "audit@spendflow.example",
      status: "pending",
    });
  });

  it("rolls back the whole delete if the audit write fails", async () => {
    const { userId, cookie } = await createPendingUser("rollback@spendflow.example");
    auditMocks.writeAudit.mockImplementationOnce(() => {
      throw new Error("audit boom");
    });

    const res = await deleteUser(cookie, userId, DEMO.password);
    expect(res.status).toBe(500);

    expect(h.db.select().from(usersTable).where(eq(usersTable.id, userId)).get()).toBeDefined();
    expect(h.db.select().from(userInvitationsTable).where(eq(userInvitationsTable.userId, userId)).all()).toHaveLength(1);
    expect(h.db.select().from(accountsTable).where(eq(accountsTable.userId, userId)).all()).toHaveLength(1);
  });
});

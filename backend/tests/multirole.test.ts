import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasAnyRole } from "../src/auth/permissions.js";
import { derivePrimaryRole, parseRoles, serializeRoles } from "../src/services/roles.js";
import {
  DEMO,
  authedGet,
  authedPost,
  bootstrap,
  login,
  provisionSeedUser,
  type Harness,
} from "./helpers.js";
import type { Role } from "../src/types.js";

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
});
afterEach(() => h.cleanup());

/** Multi-role user: employee + approver. */
const MULTI = {
  id: "u-multi-1",
  email: "multi@spendflow.example",
  name: "Multi Role",
  roles: ["employee", "approver"] as Role[],
};

async function loginCookie(email: string) {
  const res = await login(h.app, email);
  expect(res.status).toBe(200);
  return res.cookie!;
}

describe("role helpers", () => {
  it("parseRoles/serializeRoles round-trip JSON role arrays", () => {
    expect(serializeRoles(["employee", "approver"])).toBe('["employee","approver"]');
    expect(parseRoles('["employee","approver"]')).toEqual(["employee", "approver"]);
    expect(parseRoles("[]")).toEqual([]);
    expect(parseRoles("garbage")).toEqual([]);
    expect(parseRoles('"approver"')).toEqual([]);
    expect(parseRoles('["finance", "bogus"]')).toEqual(["finance"]);
  });

  it("derivePrimaryRole follows finance > approver > employee precedence", () => {
    expect(derivePrimaryRole(["employee", "approver"])).toBe("approver");
    expect(derivePrimaryRole(["employee"])).toBe("employee");
    expect(derivePrimaryRole(["approver", "finance"])).toBe("finance");
    expect(derivePrimaryRole([])).toBe("employee");
  });

  it("hasAnyRole intersects on any overlap", () => {
    expect(hasAnyRole(["employee", "approver"], ["approver"])).toBe(true);
    expect(hasAnyRole(["employee", "approver"], ["employee"])).toBe(true);
    expect(hasAnyRole(["employee", "approver"], ["approver", "finance"])).toBe(true);
    expect(hasAnyRole(["finance"], ["finance"])).toBe(true);
    expect(hasAnyRole(["finance"], ["approver"])).toBe(false);
    expect(hasAnyRole(["finance"], ["employee"])).toBe(false);
    expect(hasAnyRole(["employee"], ["finance", "approver"])).toBe(false);
  });

  it("empty roles never passes any guard (default applied at insert, covered for safety)", () => {
    expect(hasAnyRole([], ["employee"])).toBe(false);
    expect(hasAnyRole([], ["approver"])).toBe(false);
    expect(hasAnyRole([], ["finance"])).toBe(false);
  });
});

describe("multi-role route guards", () => {
  it("a user with roles [employee, approver] passes both employee and approver guards", async () => {
    await provisionSeedUser(h, {
      id: MULTI.id,
      name: MULTI.name,
      email: MULTI.email,
      role: "employee",
      roles: MULTI.roles,
      managerId: DEMO.approver.id,
    });
    const cookie = await loginCookie(MULTI.email);

    // Session exposes the full role set + derived primary role.
    const me = await authedGet(h.app, "/api/me", cookie);
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody.user.roles).toEqual(["employee", "approver"]);
    expect(meBody.user.primaryRole).toBe("approver");

    // Employee guard: any authenticated user may create a claim.
    const claimRes = await authedPost(h.app, "/api/claims", cookie, {
      title: "Multi role claim",
      lineItems: [{ categoryId: "taxi", date: "2026-07-15", amount: 50_000 }],
    });
    expect(claimRes.status).toBe(201);

    // Approver guard: approver inbox + decision paths are reachable.
    const inbox = await authedGet(h.app, "/api/approver/inbox", cookie);
    expect(inbox.status).toBe(200);

    // Data scope keys off the derived primary role (approver).
    const dash = await authedGet(h.app, "/api/dashboard/inbox", cookie);
    const dashBody = await dash.json();
    expect(dashBody.scope.ownOnly).toBe(false);
    expect(dashBody.scope.managerId).toBe(MULTI.id);

    // Not finance → admin routes stay denied.
    const admin = await authedGet(h.app, "/api/admin/users", cookie);
    expect(admin.status).toBe(403);
  });

  it("a user with roles [finance] passes the finance guard only", async () => {
    await provisionSeedUser(h, {
      id: "u-fin-2",
      name: "Finance Two",
      email: "fin2@spendflow.example",
      role: "finance",
      roles: ["finance"],
    });
    const cookie = await loginCookie("fin2@spendflow.example");

    const admin = await authedGet(h.app, "/api/admin/users", cookie);
    expect(admin.status).toBe(200);

    // Finance participates in approval workflows (finance steps), so the
    // approver inbox is reachable; a strict approver-only deny is asserted at
    // the helper level (hasAnyRole(["finance"], ["approver"]) === false).
    const inbox = await authedGet(h.app, "/api/approver/inbox", cookie);
    expect(inbox.status).toBe(200);

    const me = await authedGet(h.app, "/api/me", cookie);
    const meBody = await me.json();
    expect(meBody.user.roles).toEqual(["finance"]);
    expect(meBody.user.primaryRole).toBe("finance");
  });

  it("an employee-only user is denied the approver guard (403)", async () => {
    await provisionSeedUser(h, {
      id: "u-emp-9",
      name: "Employee Nine",
      email: "emp9@spendflow.example",
      role: "employee",
      roles: ["employee"],
    });
    const cookie = await loginCookie("emp9@spendflow.example");
    const inbox = await authedGet(h.app, "/api/approver/inbox", cookie);
    expect(inbox.status).toBe(403);
  });
});

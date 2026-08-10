import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO,
  authedGet,
  authedPatch,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
});
afterEach(() => h.cleanup());

async function cookieFor(role: "employee" | "approver" | "finance") {
  const map = {
    employee: DEMO.employee.email,
    approver: DEMO.approver.email,
    finance: DEMO.finance.email,
  } as const;
  const res = await login(h.app, map[role]);
  expect(res.status).toBe(200);
  return res.cookie!;
}

describe("server-side permission enforcement", () => {
  it("allows a request from a correctly-scoped role end to end", async () => {
    const cookie = await cookieFor("finance");
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.employee.id}/role`,
      cookie,
      { role: "approver", password: DEMO.password }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.role).toBe("approver");
  });

  it("rejects a non-Finance caller attempting to change another user's role", async () => {
    const cookie = await cookieFor("employee");
    const res = await authedPatch(
      h.app,
      `/api/admin/users/${DEMO.approver.id}/role`,
      cookie,
      { role: "finance" }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("rejects an Employee calling a Finance-only action server-side (not silently ignored)", async () => {
    const cookie = await cookieFor("employee");
    const res = await authedGet(h.app, "/api/admin/users", cookie);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it("rejects an Approver calling the same Finance-only action", async () => {
    const cookie = await cookieFor("approver");
    const res = await authedGet(h.app, "/api/admin/users", cookie);
    expect(res.status).toBe(403);
  });

  it("a denied action returns a clear rejection with no partial data leakage", async () => {
    const cookie = await cookieFor("employee");
    const res = await authedGet(h.app, "/api/admin/users", cookie);
    const body = await res.json();
    // The body must carry only an error envelope — never a `users` array.
    expect(body).not.toHaveProperty("users");
    expect(body.error).toBeDefined();
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("authorization allow/deny matrix holds for all three roles on /api/me", async () => {
    // Any authenticated role may read its own identity.
    for (const role of ["employee", "approver", "finance"] as const) {
      const cookie = await cookieFor(role);
      const res = await authedGet(h.app, "/api/me", cookie);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.role).toBe(role);
    }
    // An unauthenticated request is rejected.
    const anon = await authedGet(h.app, "/api/me", null);
    expect(anon.status).toBe(401);
  });

  it("dashboard/inbox queries return only data matching the caller's role and identity", async () => {
    // Employee sees only their own row.
    const empCookie = await cookieFor("employee");
    const empRes = await authedGet(h.app, "/api/dashboard/inbox", empCookie);
    expect(empRes.status).toBe(200);
    const empBody = await empRes.json();
    expect(empBody.scope.ownOnly).toBe(true);
    expect(empBody.items).toHaveLength(1);
    expect(empBody.items[0].id).toBe(DEMO.employee.id);

    // Approver sees themselves plus direct reports.
    const apprCookie = await cookieFor("approver");
    const apprRes = await authedGet(h.app, "/api/dashboard/inbox", apprCookie);
    const apprBody = await apprRes.json();
    const apprIds = apprBody.items.map((u: { id: string }) => u.id);
    expect(apprIds).toContain(DEMO.approver.id);
    expect(apprIds).toContain(DEMO.employee.id); // reports to approver

    // Finance sees every user.
    const finCookie = await cookieFor("finance");
    const finRes = await authedGet(h.app, "/api/dashboard/inbox", finCookie);
    const finBody = await finRes.json();
    expect(finBody.scope.allData).toBe(true);
    expect(finBody.items.length).toBeGreaterThanOrEqual(3);
  });
});

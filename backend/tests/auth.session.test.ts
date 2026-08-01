import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sessionsTable } from "../src/db/schema.js";
import {
  DEMO,
  authedGet,
  bootstrap,
  login,
  logout,
  type Harness,
} from "./helpers.js";

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
});
afterEach(() => h.cleanup());

describe("Better Auth session & login API", () => {
  it("valid credentials return a persisted session usable across requests", async () => {
    const res = await login(h.app, DEMO.employee.email);
    expect(res.status).toBe(200);
    expect(res.cookie).toMatch(/better-auth\.session_token=/);

    // Session persists across subsequent authenticated requests.
    const me = await authedGet(h.app, "/api/me", res.cookie);
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.user.email).toBe(DEMO.employee.email);
    expect(body.user.role).toBe("employee");

    // And the session row really is persisted in the database.
    const row = h.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, DEMO.employee.id))
      .get();
    expect(row).toBeDefined();
    expect(row?.userId).toBe(DEMO.employee.id);
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("invalid password returns a typed error and creates no session", async () => {
    const res = await login(h.app, DEMO.employee.email, "wrong-password");
    expect(res.status).toBe(401);
    expect(res.cookie).toBeNull();

    // No session row should exist for the user.
    const rows = h.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, DEMO.employee.id))
      .all();
    expect(rows).toHaveLength(0);
  });

  it("unknown email is rejected with no session created", async () => {
    const res = await login(h.app, "nobody@spendflow.example");
    expect(res.status).toBe(401);
    expect(res.cookie).toBeNull();
  });

  it("logout invalidates the session so the old token is rejected", async () => {
    const res = await login(h.app, DEMO.finance.email);
    expect(res.status).toBe(200);

    // Before logout the session is valid.
    const meBefore = await authedGet(h.app, "/api/me", res.cookie);
    expect(meBefore.status).toBe(200);

    const out = await logout(h.app, res.cookie!);
    expect(out.status).toBe(200);

    // After logout the same token is rejected.
    const meAfter = await authedGet(h.app, "/api/me", res.cookie);
    expect(meAfter.status).toBe(401);

    // The session row was deleted server-side.
    const row = h.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, DEMO.employee.id))
      .get();
    expect(row).toBeUndefined();
  });

  it("an expired session is rejected on every protected route, not just the first", async () => {
    const res = await login(h.app, DEMO.employee.email);

    // Force-expire the session server-side.
    h.db
      .update(sessionsTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessionsTable.userId, DEMO.employee.id))
      .run();

    // Two distinct protected routes must both reject the expired session.
    const me = await authedGet(h.app, "/api/me", res.cookie);
    const inbox = await authedGet(h.app, "/api/dashboard/inbox", res.cookie);
    expect(me.status).toBe(401);
    expect(inbox.status).toBe(401);
  });

  it("a request with a bogus session token is rejected on every protected route", async () => {
    const bogus = "better-auth.session_token=this-token-does-not-exist";
    const me = await authedGet(h.app, "/api/me", bogus);
    const inbox = await authedGet(h.app, "/api/dashboard/inbox", bogus);
    const admin = await authedGet(h.app, "/api/admin/users", bogus);
    expect(me.status).toBe(401);
    expect(inbox.status).toBe(401);
    expect(admin.status).toBe(401);
  });
});

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { auditLogsTable, userInvitationsTable, usersTable } from "../src/db/schema.js";
import {
  DEMO,
  authedGet,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";
import type { Role } from "../src/types.js";

// Mock the Resend client so invite-delivery wiring is testable without a real
// API key or network access. Existing (unkeyed) tests still exercise the
// log-fallback path because setup.ts unsets RESEND_API_KEY.
const emailMocks = vi.hoisted(() => ({
  sendInviteEmail: vi.fn(),
  EmailConfigError: class EmailConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "EmailConfigError";
    }
  },
}));

vi.mock("@/email/resend", () => ({
  EmailConfigError: emailMocks.EmailConfigError,
  sendInviteEmail: emailMocks.sendInviteEmail,
}));

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
});
afterEach(() => h.cleanup());

const INVITE_LOG = "logs/invites.log";

async function financeCookie() {
  const res = await login(h.app, DEMO.finance.email);
  expect(res.status).toBe(200);
  return res.cookie!;
}

async function createInvite(
  email: string,
  overrides: { role?: Role; name?: string; managerId?: string } = {}
) {
  const cookie = await financeCookie();
  const res = await authedPost(h.app, "/api/admin/users", cookie, {
    email,
    name: overrides.name ?? "New Hire",
    role: overrides.role ?? "employee",
    ...(overrides.managerId ? { managerId: overrides.managerId } : {}),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body, cookie };
}

function inviteRow(token: string) {
  return h.db
    .select()
    .from(userInvitationsTable)
    .where(eq(userInvitationsTable.token, token))
    .get();
}

describe("POST /api/admin/users", () => {
  it("a Finance Admin creates a pending user and receives an invite token", async () => {
    const { res, body } = await createInvite("newhire@spendflow.example");

    expect(res.status).toBe(201);
    const b = body as { user: Record<string, unknown>; invite: Record<string, unknown> };
    expect(b.user.email).toBe("newhire@spendflow.example");
    expect(b.user.status).toBe("pending");
    expect(b.user.role).toBe("employee");
    // Never expose the credential hash.
    expect(b.user).not.toHaveProperty("passwordHash");
    expect(b.user).not.toHaveProperty("password_hash");
    // Token returned once, with expiry ~7 days out.
    expect(b.invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(b.invite.expiresAt as string).getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 60 * 60 * 1000
    );

    // Persisted user + invitation rows.
    const user = h.db.select().from(usersTable).where(eq(usersTable.email, "newhire@spendflow.example")).get();
    expect(user?.status).toBe("pending");
    const inv = inviteRow(b.invite.token as string);
    expect(inv).toBeDefined();
    expect(inv?.userId).toBe(user?.id);
    expect(inv?.consumedAt).toBeNull();

    // Audit entry recorded with the actor.
    const audit = h.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "user.create"))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(DEMO.finance.id);
    expect(JSON.parse(audit[0].after)).toEqual({ email: "newhire@spendflow.example", role: "employee", roles: ["employee"], status: "pending" });

    // Mocked email appended to the invite log.
    expect(existsSync(INVITE_LOG)).toBe(true);
    expect(readFileSync(INVITE_LOG, "utf8")).toContain(`email=newhire@spendflow.example`);
  });

  it("a duplicate email is rejected with 409 email_exists", async () => {
    await createInvite("dupe@spendflow.example");
    const { res, body } = await createInvite("dupe@spendflow.example");

    expect(res.status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe("email_exists");
    expect(h.db.select().from(usersTable).where(eq(usersTable.email, "dupe@spendflow.example")).all()).toHaveLength(1);
  });

  it("an invalid role is rejected with 400 validation", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/users", cookie, {
      email: "badrole@spendflow.example",
      name: "Bad Role",
      role: "superadmin",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("a nonexistent manager is rejected with 400 not_found", async () => {
    const cookie = await financeCookie();
    const res = await authedPost(h.app, "/api/admin/users", cookie, {
      email: "orphan@spendflow.example",
      name: "Orphan",
      role: "employee",
      managerId: "no-such-manager",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("an Employee is forbidden from creating users (403)", async () => {
    const emp = await login(h.app, DEMO.employee.email);
    expect(emp.status).toBe(200);
    const res = await authedPost(h.app, "/api/admin/users", emp.cookie, {
      email: "sneaky@spendflow.example",
      name: "Sneaky",
      role: "employee",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("an Approver is forbidden from creating users (403)", async () => {
    const appr = await login(h.app, DEMO.approver.email);
    expect(appr.status).toBe(200);
    const res = await authedPost(h.app, "/api/admin/users", appr.cookie, {
      email: "sneaky2@spendflow.example",
      name: "Sneaky",
      role: "employee",
    });
    expect(res.status).toBe(403);
  });

  it("an unauthenticated request is rejected with 401", async () => {
    const res = await authedPost(h.app, "/api/admin/users", null, {
      email: "anon@spendflow.example",
      name: "Anon",
      role: "employee",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("GET /api/admin/invites/:token", () => {
  it("returns the invitee's details for a valid token (public)", async () => {
    const { body } = await createInvite("invitee@spendflow.example", {
      name: "Invitee Person",
      role: "approver",
      managerId: DEMO.finance.id,
    });
    const token = (body as { invite: { token: string } }).invite.token;

    const res = await authedGet(h.app, `/api/admin/invites/${token}`, null);
    expect(res.status).toBe(200);
    const details = await res.json();
    expect(details).toEqual({
      email: "invitee@spendflow.example",
      name: "Invitee Person",
      role: "approver",
      managerId: DEMO.finance.id,
      department: null,
      costCenter: null,
    });
    // No token / user id echoed back.
    const keys = Object.keys(details);
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("id");
  });

  it("an expired token returns 410 invite_expired", async () => {
    const { body } = await createInvite("expired@spendflow.example");
    const token = (body as { invite: { token: string } }).invite.token;
    h.db
      .update(userInvitationsTable)
      .set({ expiresAt: Date.now() - 60_000 })
      .where(eq(userInvitationsTable.token, token))
      .run();

    const res = await authedGet(h.app, `/api/admin/invites/${token}`, null);
    expect(res.status).toBe(410);
    const b = await res.json();
    expect(b.error.code).toBe("invite_expired");
  });

  it("a consumed token returns 410 invite_consumed", async () => {
    const { body } = await createInvite("consumed@spendflow.example");
    const token = (body as { invite: { token: string } }).invite.token;
    h.db
      .update(userInvitationsTable)
      .set({ consumedAt: Date.now(), consumedByIp: "10.0.0.1" })
      .where(eq(userInvitationsTable.token, token))
      .run();

    const res = await authedGet(h.app, `/api/admin/invites/${token}`, null);
    expect(res.status).toBe(410);
    const b = await res.json();
    expect(b.error.code).toBe("invite_consumed");
  });

  it("an unknown token returns 404 invite_invalid", async () => {
    const res = await authedGet(h.app, "/api/admin/invites/no-such-token", null);
    expect(res.status).toBe(404);
    const b = await res.json();
    expect(b.error.code).toBe("invite_invalid");
  });
});

describe("POST /api/admin/invites/:token/accept", () => {
  it("sets the password, activates the user, returns a session cookie, and rejects a second accept", async () => {
    const { body } = await createInvite("acceptee@spendflow.example", {
      name: "Acceptee Person",
    });
    const token = (body as { invite: { token: string } }).invite.token;
    const userId = (body as { user: { id: string } }).user.id;

    const res = await authedPost(h.app, `/api/admin/invites/${token}/accept`, null, {
      password: "correct-horse-battery",
    });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.user.id).toBe(userId);
    expect(b.user.status).toBe("active");
    expect(b.user).not.toHaveProperty("passwordHash");

    // A real, usable session cookie was issued (FE skips manual sign-in).
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toMatch(/better-auth\.session_token=/);
    const cookie = setCookie!.split(";")[0];
    const me = await authedGet(h.app, "/api/me", cookie);
    expect(me.status).toBe(200);
    expect((await me.json()).user.email).toBe("acceptee@spendflow.example");

    // Invitation consumed; user flipped active; audit written.
    const inv = inviteRow(token);
    expect(inv?.consumedAt).not.toBeNull();
    const user = h.db.select().from(usersTable).where(eq(usersTable.id, userId)).get();
    expect(user?.status).toBe("active");
    const audit = h.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "user.activate"))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(userId);
    expect(JSON.parse(audit[0].before)).toEqual({ status: "pending" });
    expect(JSON.parse(audit[0].after)).toEqual({ status: "active" });

    // Password is now usable through the normal login flow.
    const loginRes = await login(h.app, "acceptee@spendflow.example", "correct-horse-battery");
    expect(loginRes.status).toBe(200);

    // A second accept of the same token is rejected.
    const again = await authedPost(h.app, `/api/admin/invites/${token}/accept`, null, {
      password: "another-password-123",
    });
    expect(again.status).toBe(410);
    expect((await again.json()).error.code).toBe("invite_consumed");
  });

  it("a weak password (<8 chars) is rejected with 400 invalid_password", async () => {
    const { body } = await createInvite("weak@spendflow.example");
    const token = (body as { invite: { token: string } }).invite.token;

    const res = await authedPost(h.app, `/api/admin/invites/${token}/accept`, null, {
      password: "short",
    });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error.code).toBe("invalid_password");

    // User untouched; invite still consumable.
    const inv = inviteRow(token);
    expect(inv?.consumedAt).toBeNull();
    expect(h.db.select().from(usersTable).where(eq(usersTable.email, "weak@spendflow.example")).get()?.status).toBe("pending");
  });

  it("an expired token is rejected with 410 invite_expired", async () => {
    const { body } = await createInvite("expire2@spendflow.example");
    const token = (body as { invite: { token: string } }).invite.token;
    h.db
      .update(userInvitationsTable)
      .set({ expiresAt: Date.now() - 60_000 })
      .where(eq(userInvitationsTable.token, token))
      .run();

    const res = await authedPost(h.app, `/api/admin/invites/${token}/accept`, null, {
      password: "valid-password-1",
    });
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("invite_expired");
  });

  it("a consumed token is rejected with 410 invite_consumed", async () => {
    const { body } = await createInvite("consume2@spendflow.example");
    const token = (body as { invite: { token: string } }).invite.token;
    h.db
      .update(userInvitationsTable)
      .set({ consumedAt: Date.now() })
      .where(eq(userInvitationsTable.token, token))
      .run();

    const res = await authedPost(h.app, `/api/admin/invites/${token}/accept`, null, {
      password: "valid-password-1",
    });
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("invite_consumed");
  });

  it("an unknown token is rejected with 404 invite_invalid", async () => {
    const res = await authedPost(h.app, "/api/admin/invites/no-such-token/accept", null, {
      password: "valid-password-1",
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("invite_invalid");
  });
});

describe("POST /api/admin/users — email delivery via Resend (mocked)", () => {
  const savedKey = process.env.RESEND_API_KEY;
  const savedUrl = process.env.FE_URL;

  beforeEach(() => {
    emailMocks.sendInviteEmail.mockReset();
    emailMocks.sendInviteEmail.mockResolvedValue({ id: "re_mock_123" });
    process.env.RESEND_API_KEY = "re_test_mocked_key";
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
    if (savedUrl === undefined) delete process.env.FE_URL;
    else process.env.FE_URL = savedUrl;
  });

  it("sends one invite email with the FE_URL + token link, and still writes the log", async () => {
    const { res, body } = await createInvite("mail@spendflow.example", {
      name: "Mail Person",
      role: "approver",
    });

    expect(res.status).toBe(201);
    expect(emailMocks.sendInviteEmail).toHaveBeenCalledTimes(1);

    const token = (body as { invite: { token: string } }).invite.token;
    expect(emailMocks.sendInviteEmail).toHaveBeenCalledWith({
      to: "mail@spendflow.example",
      name: "Mail Person",
      role: "approver",
      inviteUrl: `http://localhost:3000/invite/${token}`,
      expiresInDays: 7,
    });

    const log = readFileSync(INVITE_LOG, "utf8");
    expect(log).toContain(`email=mail@spendflow.example`);
    expect(log).toContain(`token=${token}`);
    expect(log).toContain(`url=http://localhost:3000/invite/${token}`);
  });

  it("rethrows a Resend API 5xx but keeps the invite URL in the log", async () => {
    emailMocks.sendInviteEmail.mockRejectedValueOnce(
      new Error("Resend API error: internal_server_error: boom")
    );
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});

    const { res, body } = await createInvite("fail@spendflow.example");

    expect(res.status).toBe(500);
    expect((body as { error: { code: string } }).error.code).toBe("internal");
    const log = readFileSync(INVITE_LOG, "utf8");
    expect(log).toContain(`email=fail@spendflow.example`);
    expect(log).toMatch(/url=http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}/);
    warn.mockRestore();
  });

  it("warns and continues (201) on EmailConfigError, keeping the log fallback", async () => {
    emailMocks.sendInviteEmail.mockRejectedValueOnce(
      new emailMocks.EmailConfigError("RESEND_API_KEY is not set")
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { res, body } = await createInvite("cfg@spendflow.example");

    expect(res.status).toBe(201);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("email not configured")
    );
    const token = (body as { invite: { token: string } }).invite.token;
    expect(readFileSync(INVITE_LOG, "utf8")).toContain(`token=${token}`);
    warn.mockRestore();
  });

  it("writes the same invite-log line shape when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;

    const { res, body } = await createInvite("nokey@spendflow.example");
    expect(res.status).toBe(201);
    expect(emailMocks.sendInviteEmail).not.toHaveBeenCalled();

    const token = (body as { invite: { token: string } }).invite.token;
    const line = readFileSync(INVITE_LOG, "utf8").trim().split("\n").pop()!;
    expect(line).toMatch(
      new RegExp(
        `^\\[\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z\\] ` +
          `email=nokey@spendflow\\.example token=${token} ` +
          `url=http://localhost:3000/invite/${token}$`
      )
    );
  });
});

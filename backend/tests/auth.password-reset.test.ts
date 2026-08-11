import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountsTable,
  auditLogsTable,
  passwordResetsTable,
  sessionsTable,
  usersTable,
} from "../src/db/schema.js";
import {
  DEMO,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";

/* ============================================================================
 * #69 — Password reset / forgot-password flow.
 *
 * Covers the two public endpoints + the underlying service contract:
 *   - forgot-password: 200 with the SAME body for known + unknown emails,
 *     rate-limited 5/IP/hour, dispatches email only for known active users.
 *   - reset-password: happy path sets the new password + invalidates every
 *     session; expired/invalid/consumed/weak-password each surface their
 *     documented error code.
 * ========================================================================== */

// Mock the Resend client so the email-send branch is observable without a
// real API key. Unmocked paths still hit the log-fallback (RESEND_API_KEY is
// unset by setup.ts) and exercise the devHint surface.
type IsResendSandboxType = () => boolean;

const emailMocks = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
  isResendSandbox: vi.fn(() => true),
  EmailConfigError: class EmailConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "EmailConfigError";
    }
  },
}));

vi.mock("@/email/resend", async () => {
  const actual = await vi.importActual<{
    isResendSandbox: IsResendSandboxType;
    sendPasswordResetEmail?: (input: unknown) => Promise<{ id: string }>;
  }>("../src/email/resend.js");
  return {
    ...actual,
    sendPasswordResetEmail: emailMocks.sendPasswordResetEmail,
    isResendSandbox: emailMocks.isResendSandbox,
    EmailConfigError: emailMocks.EmailConfigError,
  };
});

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
});
afterEach(() => h.cleanup());

async function forgotPassword(email: string, ip = "203.0.113.1") {
  return h.app.request("/api/auth/forgot-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      origin: "http://localhost:8787",
    },
    body: JSON.stringify({ email }),
  });
}

function firstResetToken(userId: string): string | undefined {
  const row = h.db
    .select()
    .from(passwordResetsTable)
    .where(eq(passwordResetsTable.userId, userId))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return row?.token;
}

describe("POST /api/auth/forgot-password (#69)", () => {
  it("returns 200 with the same envelope for a known active user and persists a reset token", async () => {
    const res = await forgotPassword(DEMO.employee.email);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      message:
        "If an account exists for that email, a reset link has been sent.",
    });
    // Token persisted for the matched user.
    const token = firstResetToken(DEMO.employee.id);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    const row = h.db
      .select()
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.token, token!))
      .get();
    expect(row?.consumedAt).toBeNull();
    expect(row?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("returns the SAME 200 envelope for an unknown email and persists no token", async () => {
    const before = h.db.select().from(passwordResetsTable).all().length;
    const res = await forgotPassword("nobody@spendflow.example");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe(
      "If an account exists for that email, a reset link has been sent.",
    );
    const after = h.db.select().from(passwordResetsTable).all().length;
    expect(after).toBe(before);
  });

  it("does NOT issue a token for a pending user (only active users reset)", async () => {
    // Create a pending user via the invite endpoint (no password set yet).
    const fin = await login(h.app, DEMO.finance.email);
    const create = await authedPost(h.app, "/api/admin/users", fin.cookie, {
      email: "pending-reset@spendflow.example",
      name: "Pending Reset",
      role: "employee",
    });
    expect(create.status).toBe(201);
    const before = h.db.select().from(passwordResetsTable).all().length;
    const res = await forgotPassword("pending-reset@spendflow.example");
    expect(res.status).toBe(200);
    expect(h.db.select().from(passwordResetsTable).all().length).toBe(before);
  });

  it("rate-limits to 5 requests per IP per hour; 6th returns 429 rate_limited", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 5; i++) {
      const res = await forgotPassword(` attempt${i}@x.example`, ip);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    }
    const blocked = await forgotPassword("sixth@x.example", ip);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.retry_after_seconds).toBeGreaterThan(0);
  });

  it("sends exactly one reset email per request when RESEND_API_KEY is configured", async () => {
    emailMocks.sendPasswordResetEmail.mockReset();
    emailMocks.sendPasswordResetEmail.mockResolvedValue({ id: "re_mock_pr" });
    const saved = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_test_mocked_key";
    try {
      const res = await forgotPassword(DEMO.approver.email);
      expect(res.status).toBe(200);
      expect(emailMocks.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const token = firstResetToken(DEMO.approver.id)!;
      const callArg = emailMocks.sendPasswordResetEmail.mock.calls[0][0];
      expect(callArg).toMatchObject({
        to: DEMO.approver.email,
        name: DEMO.approver.name,
        expiresInMinutes: 60,
      });
      expect(callArg.resetUrl).toBe(
        `http://localhost:3000/reset-password/${token}`,
      );
    } finally {
      if (saved === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = saved;
    }
  });
});

describe("POST /api/auth/reset-password (#69)", () => {
  async function resetPassword(token: string, password: string) {
    return h.app.request("/api/auth/reset-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:8787",
      },
      body: JSON.stringify({ token, password }),
    });
  }

  it("happy path: sets the new password, consumes the token, invalidates all sessions, audits user.password_reset", async () => {
    // Seed a live session for the target user.
    const beforeLogin = await login(h.app, DEMO.employee.email);
    expect(beforeLogin.status).toBe(200);
    const sessionBefore = h.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, DEMO.employee.id))
      .all();
    expect(sessionBefore.length).toBeGreaterThan(0);

    // Request a reset token directly through the service to bypass the
    // rate-limited HTTP route (covered separately above).
    const req = await forgotPassword(DEMO.employee.email);
    expect(req.status).toBe(200);
    const token = firstResetToken(DEMO.employee.id)!;

    const res = await resetPassword(token, "new-strong-password");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Token consumed.
    const consumedRow = h.db
      .select()
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.token, token))
      .get();
    expect(consumedRow?.consumedAt).not.toBeNull();

    // Password hash updated on both users + accounts rows.
    const userRow = h.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, DEMO.employee.id))
      .get();
    const accountRow = h.db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.userId, DEMO.employee.id))
      .get();
    expect(userRow?.passwordHash).not.toBe(null);
    expect(accountRow?.password).toBe(userRow?.passwordHash);
    // The new password verifies against the real Better Auth login flow.
    const newLogin = await login(h.app, DEMO.employee.email, "new-strong-password");
    expect(newLogin.status).toBe(200);

    // Old sessions are gone; a fresh one is now present from the login above.
    const sessionAfter = h.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, DEMO.employee.id))
      .all();
    expect(sessionAfter.length).toBe(1);
    expect(sessionAfter[0].token).not.toBe(sessionBefore[0].token);

    // Audit entry recorded.
    const audit = h.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "user.password_reset"))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(DEMO.employee.id);
    expect(audit[0].entityId).toBe(DEMO.employee.id);
  });

  it("401 invalid_token: an unknown token is rejected with the documented code", async () => {
    const res = await resetPassword(
      "00000000-0000-4000-8000-000000000000",
      "new-strong-password",
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_token");
  });

  it("401 invalid_token: an expired token is rejected with the same code (no enumeration)", async () => {
    const req = await forgotPassword(DEMO.employee.email);
    expect(req.status).toBe(200);
    const token = firstResetToken(DEMO.employee.id)!;
    // Force expiry.
    h.db
      .update(passwordResetsTable)
      .set({ expiresAt: Date.now() - 60_000 })
      .where(eq(passwordResetsTable.token, token))
      .run();

    const res = await resetPassword(token, "new-strong-password");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_token");
  });

  it("410 already_used: a consumed token cannot be reused", async () => {
    const req = await forgotPassword(DEMO.employee.email);
    expect(req.status).toBe(200);
    const token = firstResetToken(DEMO.employee.id)!;

    const first = await resetPassword(token, "new-strong-password");
    expect(first.status).toBe(200);

    const second = await resetPassword(token, "another-password-1");
    expect(second.status).toBe(410);
    expect((await second.json()).error.code).toBe("already_used");
  });

  it("422 weak_password: a password shorter than 8 chars is rejected inline", async () => {
    const req = await forgotPassword(DEMO.employee.email);
    expect(req.status).toBe(200);
    const token = firstResetToken(DEMO.employee.id)!;

    const res = await resetPassword(token, "short");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("weak_password");
    // Token not consumed on weak password.
    const row = h.db
      .select()
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.token, token))
      .get();
    expect(row?.consumedAt).toBeNull();
  });

  it("does not leak which sessions existed: invalidates ALL sessions for the user", async () => {
    // Two concurrent sessions (different devices).
    const a = await login(h.app, DEMO.finance.email);
    const b = await login(h.app, DEMO.finance.email);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const before = h.db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, DEMO.finance.id))
      .all();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const req = await forgotPassword(DEMO.finance.email);
    expect(req.status).toBe(200);
    const token = firstResetToken(DEMO.finance.id)!;
    const res = await resetPassword(token, "fresh-password-1");
    expect(res.status).toBe(200);

    const after = h.db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, DEMO.finance.id))
      .all();
    expect(after).toEqual([]);
  });
});

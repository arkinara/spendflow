import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthError, requirePasswordReauth } from "../src/auth/permissions.js";
import {
  DEMO,
  bootstrap,
  login,
  provisionSeedUser,
  type Harness,
} from "./helpers.js";

/* ============================================================================
 * #64 — requirePasswordReauth step-up auth helper.
 *
 * Unit-level coverage for the shared destructive-action re-auth helper: it
 * verifies the actor's own password against the stored hash and throws the
 * documented AuthError(401) contract on missing / invalid passwords.
 * ========================================================================== */

let h: Harness;
beforeEach(async () => {
  h = await bootstrap();
});
afterEach(() => h.cleanup());

function headersFor(cookie: string): Headers {
  return new Headers({ cookie, origin: "http://localhost:8787" });
}

async function actorHeaders(email: string): Promise<Headers> {
  const res = await login(h.app, email);
  expect(res.status).toBe(200);
  return headersFor(res.cookie!);
}

describe("requirePasswordReauth (#64)", () => {
  it("happy path: a correct password returns the authenticated user", async () => {
    const headers = await actorHeaders(DEMO.finance.email);
    const ctx = await requirePasswordReauth(
      h.auth,
      h.db,
      headers,
      DEMO.password,
      DEMO.finance.id,
    );
    expect(ctx.user.id).toBe(DEMO.finance.id);
    expect(ctx.user.email).toBe(DEMO.finance.email);
  });

  it("401 missing_password: an empty password throws AuthError with code missing_password", async () => {
    const headers = await actorHeaders(DEMO.finance.email);
    await expect(
      requirePasswordReauth(h.auth, h.db, headers, "", DEMO.finance.id),
    ).rejects.toMatchObject({ status: 401, code: "missing_password" });
  });

  it("401 missing_password: an undefined password throws AuthError", async () => {
    const headers = await actorHeaders(DEMO.finance.email);
    await expect(
      requirePasswordReauth(h.auth, h.db, headers, undefined as unknown as string, DEMO.finance.id),
    ).rejects.toMatchObject({ status: 401, code: "missing_password" });
  });

  it("401 invalid_password: a wrong password throws AuthError(401, invalid_password)", async () => {
    const headers = await actorHeaders(DEMO.finance.email);
    const err = await requirePasswordReauth(
      h.auth,
      h.db,
      headers,
      "not-the-real-password",
      DEMO.finance.id,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("invalid_password");
    expect(err.message).toMatch(/incorrect password/i);
  });

  it("an actor with multiple roles can still re-auth with their own password", async () => {
    await provisionSeedUser(h, {
      id: "u-multi-reauth",
      name: "Multi Reauth",
      email: "multi.reauth@spendflow.example",
      role: "employee",
      roles: ["employee", "approver", "finance"],
    });
    const headers = await actorHeaders("multi.reauth@spendflow.example");
    const ctx = await requirePasswordReauth(
      h.auth,
      h.db,
      headers,
      DEMO.password,
      "u-multi-reauth",
    );
    expect(ctx.user.roles).toEqual(["employee", "approver", "finance"]);
    expect(ctx.user.id).toBe("u-multi-reauth");
  });
});

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";
import { EmailConfigError, isResendSandbox } from "../src/email/resend.js";

// Sandbox detection must be read live from the real module (only the send path
// is mocked), so the EmailConfigError fallback can assert sandbox:true via the
// actual isResendSandbox() heuristic.
const emailMocks = vi.hoisted(() => ({
  sendInviteEmail: vi.fn(),
}));

vi.mock("@/email/resend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/email/resend.js")>();
  return { ...actual, sendInviteEmail: emailMocks.sendInviteEmail };
});

const savedKey = process.env.RESEND_API_KEY;
const savedVerified = process.env.RESEND_DOMAIN_VERIFIED;
const savedFeUrl = process.env.FE_URL;

afterAll(() => {
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
  if (savedVerified === undefined) delete process.env.RESEND_DOMAIN_VERIFIED;
  else process.env.RESEND_DOMAIN_VERIFIED = savedVerified;
  if (savedFeUrl === undefined) delete process.env.FE_URL;
  else process.env.FE_URL = savedFeUrl;
});

let h: Harness;
beforeEach(async () => {
  emailMocks.sendInviteEmail.mockReset();
  emailMocks.sendInviteEmail.mockResolvedValue({ id: "re_mock_123" });
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_DOMAIN_VERIFIED;
  delete process.env.FE_URL;
  h = await bootstrap();
});

type InviteBody = {
  user: { id: string };
  invite: { token: string };
  devHint?: { sandbox: boolean; inviteUrl: string };
};

async function createInvite(email: string): Promise<{ res: Response; body: InviteBody }> {
  const loginRes = await login(h.app, DEMO.finance.email);
  expect(loginRes.status).toBe(200);
  const res = await authedPost(h.app, "/api/admin/users", loginRes.cookie, {
    email,
    name: "Dev Hint Person",
    role: "employee",
  });
  const body = (await res.json()) as InviteBody;
  return { res, body };
}

describe("devHint on POST /api/admin/users", () => {
  it("RESEND_API_KEY unset → devHint present with sandbox=true and the /invite/<token> URL", async () => {
    const { res, body } = await createInvite("dev1@spendflow.example");

    expect(res.status).toBe(201);
    expect(body.devHint).toEqual({
      sandbox: true,
      inviteUrl: `http://localhost:3000/invite/${body.invite.token}`,
    });
    // Never leaks the password hash or any key material.
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("re_");
  });

  it("RESEND_API_KEY set + send succeeds → no devHint", async () => {
    process.env.RESEND_API_KEY = "re_test_mocked_key";
    emailMocks.sendInviteEmail.mockResolvedValue({ id: "re_sent_123" });

    const { res, body } = await createInvite("dev2@spendflow.example");

    expect(res.status).toBe(201);
    expect(emailMocks.sendInviteEmail).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty("devHint");
  });

  it("RESEND_API_KEY set + EmailConfigError → devHint still present (log fallback fires)", async () => {
    process.env.RESEND_API_KEY = "re_test_mocked_key";
    emailMocks.sendInviteEmail.mockRejectedValueOnce(
      new EmailConfigError("RESEND_API_KEY is not set")
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { res, body } = await createInvite("dev3@spendflow.example");

    expect(res.status).toBe(201);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("email not configured"));
    expect(body.devHint).toEqual({
      sandbox: true,
      inviteUrl: `http://localhost:3000/invite/${body.invite.token}`,
    });
    warn.mockRestore();
  });
});

describe("isResendSandbox", () => {
  it("returns true when RESEND_API_KEY is missing (sandbox)", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_DOMAIN_VERIFIED;
    expect(isResendSandbox()).toBe(true);
  });

  it("returns false when RESEND_DOMAIN_VERIFIED=1 is set (verified domain)", () => {
    process.env.RESEND_API_KEY = "re_production_key";
    process.env.RESEND_DOMAIN_VERIFIED = "1";
    expect(isResendSandbox()).toBe(false);
  });
});

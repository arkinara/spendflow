import { afterEach, describe, expect, it } from "vitest";
import { EmailConfigError, sendInviteEmail } from "../src/email/resend.js";
import { renderInviteEmail, ROLE_LABEL } from "../src/email/template.js";
import type { Role } from "../src/types.js";

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

describe("renderInviteEmail", () => {
  const base = {
    name: "Aulia",
    role: "employee" as Role,
    inviteUrl: "http://localhost:3000/invite/abc123",
    expiresInDays: 7,
  };

  it("maps each role to a plain-English label", () => {
    expect(ROLE_LABEL).toEqual({
      employee: "Employee",
      approver: "Approver",
      finance: "Finance Admin",
    });
  });

  it("builds a subject from the role label", () => {
    expect(renderInviteEmail(base).subject).toBe(
      "You're invited to SpendFlow as Employee"
    );
    expect(renderInviteEmail({ ...base, role: "approver" }).subject).toBe(
      "You're invited to SpendFlow as Approver"
    );
    expect(renderInviteEmail({ ...base, role: "finance" }).subject).toBe(
      "You're invited to SpendFlow as Finance Admin"
    );
  });

  it("renders greeting, role, CTA button and expiry in the HTML", () => {
    const { html } = renderInviteEmail({ ...base, role: "approver" });
    expect(html).toContain("Hi Aulia,");
    expect(html).toContain("Approver");
    expect(html).toContain('href="http://localhost:3000/invite/abc123"');
    expect(html).toContain("Accept invitation");
    expect(html).toContain("7 days");
    expect(html).toContain("expires in");
  });

  it("escapes user-supplied values in the HTML", () => {
    const { html } = renderInviteEmail({
      ...base,
      name: `<script>alert("x")</script>`,
      inviteUrl: "http://localhost:3000/invite/a&b",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("returns a plain-text fallback without HTML", () => {
    const { text } = renderInviteEmail({ ...base, role: "finance" });
    expect(text).toContain("Hi Aulia,");
    expect(text).toContain("Finance Admin");
    expect(text).toContain("http://localhost:3000/invite/abc123");
    expect(text).toContain("7 days");
    expect(text).not.toContain("<");
  });
});

describe("sendInviteEmail (client config validation)", () => {
  const base = {
    to: "newhire@spendflow.example",
    name: "New Hire",
    role: "employee" as Role,
    inviteUrl: "http://localhost:3000/invite/tok123",
    expiresInDays: 7,
  };

  it("throws EmailConfigError when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendInviteEmail(base)).rejects.toBeInstanceOf(EmailConfigError);
  });

  it("throws EmailConfigError when the recipient is empty", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendInviteEmail({ ...base, to: "" })).rejects.toBeInstanceOf(
      EmailConfigError
    );
  });

  it("throws EmailConfigError when the invite URL is empty", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(
      sendInviteEmail({ ...base, inviteUrl: "" })
    ).rejects.toBeInstanceOf(EmailConfigError);
  });
});

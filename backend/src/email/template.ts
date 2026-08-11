/**
 * Invite email template (#40). Hand-rolled HTML strings on purpose — Phase 1
 * keeps email templating dependency-free; switch to React Email only if the
 * template gets complex enough to need a component DSL.
 */

import type { Role } from "../types.js";

export const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee",
  approver: "Approver",
  finance: "Finance Admin",
};

export interface InviteEmailTemplateInput {
  name: string;
  role: Role;
  inviteUrl: string;
  expiresInDays: number;
}

export interface RenderedInviteEmail {
  subject: string;
  html: string;
  text: string;
}

/** Escape `& < > " '` so invitee-provided name/role never break the HTML. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderInviteEmail(
  input: InviteEmailTemplateInput
): RenderedInviteEmail {
  const { name, role, inviteUrl, expiresInDays } = input;
  const label = ROLE_LABEL[role];
  const safeName = esc(name);
  const safeUrl = esc(inviteUrl);
  const safeLabel = esc(label);

  const subject = `You're invited to SpendFlow as ${label}`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#fef7ff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef7ff;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e8def8;">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <p style="margin:0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.4px;color:#6750a4;text-transform:uppercase;">SpendFlow</p>
                <h1 style="margin:8px 0 0 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:24px;font-weight:600;color:#1d1b20;">You're invited to SpendFlow</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0 0 16px 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#49454f;">Hi ${safeName},</p>
                <p style="margin:0 0 16px 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1d1b20;">
                  You've been invited to join <strong>SpendFlow</strong> as a
                  <span style="display:inline-block;margin:0 2px;padding:2px 10px;border-radius:100px;background-color:#e8def8;color:#381e72;font-weight:600;font-size:13px;">${safeLabel}</span>.
                </p>
                <p style="margin:0 0 24px 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#49454f;">
                  Click the button below to accept the invitation and set your password. The link is valid for <strong>${expiresInDays} days</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 28px 32px;">
                <a href="${safeUrl}" style="display:inline-block;background-color:#6750a4;color:#ffffff;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:100px;">
                  Accept invitation
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <p style="margin:0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#49454f;">
                  If you didn't expect this invitation, you can safely ignore this email. This link expires in <strong>${expiresInDays} days</strong>.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;color:#79747e;">SpendFlow · expense management, done right</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `You're invited to SpendFlow as ${label}

Hi ${name},

You've been invited to join SpendFlow as a ${label}. Click the link below to
accept the invitation and set your password:

${inviteUrl}

This link expires in ${expiresInDays} days. If you didn't expect this
invitation, you can safely ignore this email.

— SpendFlow`;

  return { subject, html, text };
}

/* ------------------------------------------------------ password reset (#69) */

export interface PasswordResetEmailTemplateInput {
  name: string;
  resetUrl: string;
  /** TTL in minutes, surfaced in the copy. Caller passes 60 for a 1h token. */
  expiresInMinutes: number;
}

export interface RenderedPasswordResetEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render the password-reset email body (#69). Mirrors {@link renderInviteEmail}
 * styling so the two outbound emails share a visual identity. The reset link
 * target is `{feUrl}/reset-password/{token}` (built by the caller — this
 * function stays URL-agnostic and only escapes what it renders).
 */
export function renderPasswordResetEmail(
  input: PasswordResetEmailTemplateInput,
): RenderedPasswordResetEmail {
  const { name, resetUrl, expiresInMinutes } = input;
  const safeName = esc(name);
  const safeUrl = esc(resetUrl);

  const subject = "Reset your SpendFlow password";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#fef7ff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef7ff;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e8def8;">
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <p style="margin:0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.4px;color:#6750a4;text-transform:uppercase;">SpendFlow</p>
                <h1 style="margin:8px 0 0 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:24px;font-weight:600;color:#1d1b20;">Reset your password</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <p style="margin:0 0 16px 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#49454f;">Hi ${safeName},</p>
                <p style="margin:0 0 24px 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1d1b20;">
                  We received a request to reset the password for your SpendFlow account. Click the button below to choose a new password. The link is valid for <strong>${expiresInMinutes} minutes</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 28px 32px;">
                <a href="${safeUrl}" style="display:inline-block;background-color:#6750a4;color:#ffffff;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:100px;">
                  Reset password
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <p style="margin:0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#49454f;">
                  If you didn't request a password reset, you can safely ignore this email — your password will stay the same. This link expires in <strong>${expiresInMinutes} minutes</strong>.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;color:#79747e;">SpendFlow · expense management, done right</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `Reset your SpendFlow password

Hi ${name},

We received a request to reset the password for your SpendFlow account.
Click the link below to choose a new password:

${resetUrl}

This link expires in ${expiresInMinutes} minutes. If you didn't request a
password reset, you can safely ignore this email — your password will
stay the same.

— SpendFlow`;

  return { subject, html, text };
}

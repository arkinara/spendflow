/**
 * Resend email client (#40). Sandbox mode: the default `RESEND_FROM` is the
 * Resend-provided onboarding sender, so dev works without DNS setup. Production
 * custom-domain wiring is a separate follow-up ticket.
 *
 * The client is a lazy singleton — the API key is read on first send, so a
 * missing key throws a typed {@link EmailConfigError} instead of a silent
 * misconfig. API-level failures (4xx/5xx) are thrown to the caller, which
 * decides whether to fall back to the invite log.
 */

import { Resend } from "resend";
import { renderInviteEmail, renderPasswordResetEmail } from "./template.js";
import type { Role } from "../types.js";

/** Thrown when the Resend integration is not configured (missing/malformed env). */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export interface SendInviteEmailInput {
  to: string;
  name: string;
  role: Role;
  inviteUrl: string;
  expiresInDays: number;
}

const DEFAULT_FROM = "SpendFlow <onboarding@resend.dev>";

/**
 * Placeholder sandbox detection (#57a). True unless an explicit
 * `RESEND_DOMAIN_VERIFIED=1` flag marks the domain as verified. A real Resend
 * API call to query verified domains is deferred to a follow-up ticket.
 */
export function isResendSandbox(): boolean {
  return process.env.RESEND_DOMAIN_VERIFIED !== "1";
}

let client: Resend | null = null;

function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new EmailConfigError("RESEND_API_KEY is not set");
  }
  if (!client) {
    client = new Resend(apiKey);
  }
  return client;
}

/**
 * Send the invite email through the Resend sandbox. Returns the Resend message
 * id on success; throws on missing config ({@link EmailConfigError}) or on
 * Resend API failure. Never swallows — callers decide how to handle failures.
 */
export async function sendInviteEmail(
  input: SendInviteEmailInput
): Promise<{ id: string }> {
  if (!input.to) {
    throw new EmailConfigError("Invite email requires a recipient address");
  }
  if (!input.inviteUrl) {
    throw new EmailConfigError("Invite email requires an invite URL");
  }

  const from = process.env.RESEND_FROM ?? DEFAULT_FROM;
  const { subject, html, text } = renderInviteEmail(input);
  const resend = getClient();

  const { data, error } = await resend.emails.send({
    from,
    to: [input.to],
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(`Resend API error: ${error.name}: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error("Resend returned no message id");
  }
  return { id: data.id };
}

export interface SendPasswordResetEmailInput {
  to: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

/**
 * Send the password-reset email (#69) through the Resend sandbox. Same
 * contract as {@link sendInviteEmail}: returns the Resend message id on
 * success and throws on missing config or API failure.
 */
export async function sendPasswordResetEmail(
  input: SendPasswordResetEmailInput
): Promise<{ id: string }> {
  if (!input.to) {
    throw new EmailConfigError("Reset email requires a recipient address");
  }
  if (!input.resetUrl) {
    throw new EmailConfigError("Reset email requires a reset URL");
  }

  const from = process.env.RESEND_FROM ?? DEFAULT_FROM;
  const { subject, html, text } = renderPasswordResetEmail(input);
  const resend = getClient();

  const { data, error } = await resend.emails.send({
    from,
    to: [input.to],
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(`Resend API error: ${error.name}: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error("Resend returned no message id");
  }
  return { id: data.id };
}

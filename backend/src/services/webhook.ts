/* ============================================================================
 * SpendFlow — Slack/Teams webhook dispatcher for claim lifecycle events
 * (ticket #75).
 *
 * Best-effort fan-out: when a Finance Admin configures a Slack and/or Teams
 * incoming-webhook URL via env, key claim events (submit / approve / reject /
 * pay / unblock / bulk pay) are POSTed to the configured endpoints. Delivery
 * is fire-and-forget — every failure is captured in the dispatch result and
 * recorded to `backend/logs/webhook-history.log`, but the originating claim
 * mutation never rolls back because of a webhook failure (the dispatcher is
 * always invoked OUTSIDE the write transaction).
 * ========================================================================== */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import type { Env } from "../config.js";

/* --------------------------------------------------------------- config ---- */

/** Per-instance webhook configuration derived from env. Both URLs optional. */
export interface WebhookConfig {
  slackWebhookUrl: string | null;
  teamsWebhookUrl: string | null;
}

/**
 * Read the Slack + Teams incoming-webhook URLs from
 * `SPENDFLOW_SLACK_WEBHOOK_URL` + `SPENDFLOW_TEAMS_WEBHOOK_URL`. Empty/missing
 * → `null` (dispatcher becomes a no-op for that platform). When `env` is
 * omitted (e.g. a service that has no env in scope), reads `process.env`
 * directly so the rest of the codebase never has to thread env through every
 * mutation. Tested in isolation via `webhook-dispatch.test.ts`.
 */
export function getWebhookConfig(env?: Env): WebhookConfig {
  const slack = env?.slackWebhookUrl ?? process.env.SPENDFLOW_SLACK_WEBHOOK_URL ?? null;
  const teams = env?.teamsWebhookUrl ?? process.env.SPENDFLOW_TEAMS_WEBHOOK_URL ?? null;
  return {
    slackWebhookUrl: slack && slack.trim() !== "" ? slack : null,
    teamsWebhookUrl: teams && teams.trim() !== "" ? teams : null,
  };
}

/* --------------------------------------------------------------- events ---- */

export type ClaimEventKind =
  | "claim.submitted"
  | "claim.approved"
  | "claim.rejected"
  | "claim.paid"
  | "claim.unblocked"
  | "claim.bulk_paid";

/** Lifecycle event the dispatcher fans out to Slack/Teams. */
export interface ClaimEvent {
  kind: ClaimEventKind;
  claimId: string;
  reference: string;
  employeeName: string;
  amount?: number;
  currency?: string;
  actorName: string;
  occurredAt: string;
}

/** Per-platform delivery outcome for a single {@link ClaimEvent}. */
export interface DispatchResult {
  delivered: { slack: boolean; teams: boolean };
  errors: { slack?: string; teams?: string };
}

/** Fetch timeout — webhooks never block the claim mutation longer than this. */
const WEBHOOK_TIMEOUT_MS = 5_000;

function buildSlackPayload(evt: ClaimEvent): Record<string, unknown> {
  const amount =
    evt.amount !== undefined && evt.currency
      ? `${evt.amount} ${evt.currency}`
      : "—";
  return {
    text: `${evt.kind} — ${evt.reference} (${amount}) by ${evt.employeeName} → ${evt.actorName}`,
  };
}

function buildTeamsPayload(evt: ClaimEvent): Record<string, unknown> {
  return {
    "@type": "MessageCard",
    summary: evt.kind,
    text: `${evt.kind} — ${evt.reference} by ${evt.employeeName}`,
  };
}

/**
 * POST a single payload to a webhook URL with a 5-second cap. Returns the
 * error string on any failure (4xx/5xx, network error, or timeout) — never
 * throws — so the caller can fan out to the other platform regardless.
 */
async function postOnce(
  url: string,
  payload: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fan a {@link ClaimEvent} out to the configured Slack + Teams webhooks.
 * Best-effort: when neither URL is configured, returns a no-op result with no
 * fetch; when only one URL is configured, only that platform is attempted;
 * when both are configured, both run in parallel. Every failure (4xx/5xx,
 * timeout, network error) is captured in `errors` — `dispatchClaimEvent`
 * itself never throws.
 */
export async function dispatchClaimEvent(
  cfg: WebhookConfig,
  evt: ClaimEvent
): Promise<DispatchResult> {
  const result: DispatchResult = {
    delivered: { slack: false, teams: false },
    errors: {},
  };
  if (!cfg.slackWebhookUrl && !cfg.teamsWebhookUrl) {
    return result;
  }

  const tasks: Promise<void>[] = [];

  if (cfg.slackWebhookUrl) {
    const slackUrl = cfg.slackWebhookUrl;
    tasks.push(
      postOnce(slackUrl, buildSlackPayload(evt)).then((r) => {
        if (r.ok) result.delivered.slack = true;
        else result.errors.slack = r.error;
      })
    );
  }
  if (cfg.teamsWebhookUrl) {
    const teamsUrl = cfg.teamsWebhookUrl;
    tasks.push(
      postOnce(teamsUrl, buildTeamsPayload(evt)).then((r) => {
        if (r.ok) result.delivered.teams = true;
        else result.errors.teams = r.error;
      })
    );
  }

  await Promise.all(tasks);
  return result;
}

/* --------------------------------------------------------------- history --- */

/** Absolute path to the webhook-history log (mirrors invites.log pattern). */
const DEFAULT_WEBHOOK_LOG = new URL(
  "../../logs/webhook-history.log",
  import.meta.url
).pathname;

function webhookLogPath(env?: Env): string {
  return (
    env?.webhookLogPath ??
    process.env.SPENDFLOW_WEBHOOK_LOG ??
    DEFAULT_WEBHOOK_LOG
  );
}
/** One webhook dispatch attempt persisted to `webhook-history.log`. */
export interface WebhookHistoryEntry {
  id: string;
  kind: ClaimEvent["kind"];
  claimId: string;
  delivered: boolean;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** Append-only webhook history. Same JSON-line-per-entry pattern as
 *  `services/invites.ts:logInviteEmail`. Used by both the dispatcher hook
 *  (record) and the dev route {@link GET /api/admin/dev/webhook-recent} (list). */
export interface WebhookHistory {
  list(env: Env | undefined, limit: number): WebhookHistoryEntry[] | null;
  record(
    env: Env | undefined,
    entry: Omit<WebhookHistoryEntry, "id" | "createdAt">
  ): void;
}

/** Default file-backed implementation. Override `webhookLogPath` via env. */
export const webhookHistory: WebhookHistory = {
  record(env, entry) {
    const path = webhookLogPath(env);
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      // best-effort — must never throw into the caller's claim mutation
    }
    const row: WebhookHistoryEntry = {
      ...entry,
      id: `wh-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    try {
      appendFileSync(path, JSON.stringify(row) + "\n");
    } catch {
      // ignore write failures — webhook history is observational, not authoritative
    }
  },
  list(env, limit) {
    const path = webhookLogPath(env);
    if (!existsSync(path)) return null;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    const parsed: WebhookHistoryEntry[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as WebhookHistoryEntry);
      } catch {
        // skip malformed line
      }
    }
    // Newest first; the file is append-only so reverse preserves insertion order.
    parsed.reverse();
    return parsed.slice(0, Math.max(1, limit));
  },
};

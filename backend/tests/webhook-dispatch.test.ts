import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchClaimEvent,
  getWebhookConfig,
  type ClaimEvent,
  type WebhookConfig,
} from "../src/services/webhook.js";

/**
 * Unit tests for the Slack/Teams webhook dispatcher (#75). `fetch` is mocked
 * per-test so nothing hits a real webhook URL. Every case asserts the
 * best-effort contract: 4xx/5xx, network errors, and timeouts are captured
 * in `errors` — `dispatchClaimEvent` never throws.
 */

let fetchMock: ReturnType<typeof vi.fn>;
const savedSlack = process.env.SPENDFLOW_SLACK_WEBHOOK_URL;
const savedTeams = process.env.SPENDFLOW_TEAMS_WEBHOOK_URL;

function evt(overrides: Partial<ClaimEvent> = {}): ClaimEvent {
  return {
    kind: "claim.submitted",
    claimId: "clm-1",
    reference: "EXP-2026-1001",
    employeeName: "Aulia Pratiwi",
    amount: 4_787_000,
    currency: "IDR",
    actorName: "Aulia Pratiwi",
    occurredAt: "2026-08-12T10:00:00Z",
    ...overrides,
  };
}

function ok(): Response {
  return new Response("ok", { status: 200 });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.SPENDFLOW_SLACK_WEBHOOK_URL;
  delete process.env.SPENDFLOW_TEAMS_WEBHOOK_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedSlack === undefined) delete process.env.SPENDFLOW_SLACK_WEBHOOK_URL;
  else process.env.SPENDFLOW_SLACK_WEBHOOK_URL = savedSlack;
  if (savedTeams === undefined) delete process.env.SPENDFLOW_TEAMS_WEBHOOK_URL;
  else process.env.SPENDFLOW_TEAMS_WEBHOOK_URL = savedTeams;
});

describe("getWebhookConfig (#75)", () => {
  it("reads SPENDFLOW_SLACK_WEBHOOK_URL + SPENDFLOW_TEAMS_WEBHOOK_URL from env (empty → null)", () => {
    process.env.SPENDFLOW_SLACK_WEBHOOK_URL =
      "https://hooks.slack.com/services/T1/B1/secret";
    process.env.SPENDFLOW_TEAMS_WEBHOOK_URL =
      "https://outlook.office.com/webhook/abc";

    const cfg = getWebhookConfig();

    expect(cfg).toEqual<WebhookConfig>({
      slackWebhookUrl: "https://hooks.slack.com/services/T1/B1/secret",
      teamsWebhookUrl: "https://outlook.office.com/webhook/abc",
    });
  });

  it("returns null for both when the env vars are missing or blank", () => {
    process.env.SPENDFLOW_SLACK_WEBHOOK_URL = "   ";
    expect(getWebhookConfig()).toEqual<WebhookConfig>({
      slackWebhookUrl: null,
      teamsWebhookUrl: null,
    });
  });
});

describe("dispatchClaimEvent (#75)", () => {
  it("fires both Slack + Teams when both URLs are configured (parallel, JSON payload)", async () => {
    process.env.SPENDFLOW_SLACK_WEBHOOK_URL =
      "https://hooks.slack.com/services/T/B/secret";
    process.env.SPENDFLOW_TEAMS_WEBHOOK_URL =
      "https://outlook.office.com/webhook/abc";
    fetchMock.mockResolvedValue(ok());

    const result = await dispatchClaimEvent(getWebhookConfig(), evt());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Slack payload shape
    const slackCall = fetchMock.mock.calls.find(
      (c: unknown[]) => (c[0] as string).includes("hooks.slack.com")
    )!;
    const slackInit = slackCall[1] as RequestInit;
    expect(slackInit.method).toBe("POST");
    expect((slackInit.headers as Record<string, string>)["content-type"]).toBe(
      "application/json"
    );
    const slackBody = JSON.parse(slackInit.body as string);
    expect(slackBody.text).toContain("claim.submitted — EXP-2026-1001");
    expect(slackBody.text).toContain("4787000 IDR");
    expect(slackBody.text).toContain("Aulia Pratiwi");

    // Teams payload shape
    const teamsCall = fetchMock.mock.calls.find(
      (c: unknown[]) => (c[0] as string).includes("outlook.office.com")
    )!;
    const teamsBody = JSON.parse((teamsCall[1] as RequestInit).body as string);
    expect(teamsBody["@type"]).toBe("MessageCard");
    expect(teamsBody.summary).toBe("claim.submitted");

    expect(result.delivered).toEqual({ slack: true, teams: true });
    expect(result.errors).toEqual({});
  });

  it("captures a Slack 500 but still delivers Teams (best-effort fan-out)", async () => {
    process.env.SPENDFLOW_SLACK_WEBHOOK_URL = "https://hooks.slack.com/x";
    process.env.SPENDFLOW_TEAMS_WEBHOOK_URL = "https://outlook.office.com/y";
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("hooks.slack.com")) {
        return Promise.resolve(new Response("boom", { status: 500 }));
      }
      return Promise.resolve(ok());
    });

    const result = await dispatchClaimEvent(getWebhookConfig(), evt());

    expect(result.delivered).toEqual({ slack: false, teams: true });
    expect(result.errors.slack).toBe("HTTP 500");
    expect(result.errors.teams).toBeUndefined();
  });

  it("is a no-op (no fetch) when neither webhook URL is configured", async () => {
    const result = await dispatchClaimEvent(getWebhookConfig(), evt());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.delivered).toEqual({ slack: false, teams: false });
    expect(result.errors).toEqual({});
  });

  it("captures a fetch timeout without throwing", async () => {
    process.env.SPENDFLOW_SLACK_WEBHOOK_URL = "https://hooks.slack.com/x";
    // AbortError surfaces from the controller — dispatcher must swallow it.
    fetchMock.mockImplementation((_input: RequestInfo | URL, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        // Trigger the AbortController immediately to simulate the 5s timeout.
        const signal = init.signal as AbortSignal;
        const e = new Error("The operation was aborted");
        e.name = "AbortError";
        signal.dispatchEvent(new Event("abort"));
        reject(e);
      });
    });

    const result = await dispatchClaimEvent(getWebhookConfig(), evt());

    expect(result.delivered.slack).toBe(false);
    expect(result.errors.slack).toMatch(/abort/i);
    // Contract: never throws.
    expect(result).toBeDefined();
  });
});

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webhookHistory } from "../src/services/webhook.js";

/**
 * Webhook history log (#75) — mirrors the invites.log pattern: append-only,
 * one JSON-line per entry. `record` writes; `list` returns the most recent N
 * entries newest-first. The log path is overridable via
 * `SPENDFLOW_WEBHOOK_LOG` so each test points the dispatcher at an isolated
 * temp file.
 */

let dir: string;
const savedEnv = process.env.SPENDFLOW_WEBHOOK_LOG;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "spendflow-webhook-"));
  process.env.SPENDFLOW_WEBHOOK_LOG = join(dir, "webhook-history.log");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  if (savedEnv === undefined) delete process.env.SPENDFLOW_WEBHOOK_LOG;
  else process.env.SPENDFLOW_WEBHOOK_LOG = savedEnv;
});

describe("WebhookHistory.record + list (#75)", () => {
  it("appends a JSON line per record and round-trips it through list()", () => {
    expect(existsSync(process.env.SPENDFLOW_WEBHOOK_LOG!)).toBe(false);

    webhookHistory.record(undefined, {
      kind: "claim.submitted",
      claimId: "clm-1",
      delivered: true,
      attempts: 2,
      lastError: null,
    });

    const raw = readFileSync(process.env.SPENDFLOW_WEBHOOK_LOG!, "utf8");
    expect(raw).toMatch(/"kind":"claim.submitted"/);
    expect(raw).toMatch(/"claimId":"clm-1"/);
    expect(raw).toMatch(/"delivered":true/);
    expect(raw.endsWith("\n")).toBe(true);

    const list = webhookHistory.list(undefined, 10)!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "claim.submitted",
      claimId: "clm-1",
      delivered: true,
      attempts: 2,
      lastError: null,
    });
    expect(list[0].id).toMatch(/^wh-/);
    expect(typeof list[0].createdAt).toBe("string");
  });

  it("returns the most recent N entries, newest first", () => {
    for (let i = 0; i < 5; i++) {
      webhookHistory.record(undefined, {
        kind: "claim.paid",
        claimId: `clm-${i}`,
        delivered: i % 2 === 0,
        attempts: 1,
        lastError: i % 2 === 0 ? null : "HTTP 500",
      });
    }

    const top3 = webhookHistory.list(undefined, 3)!;
    expect(top3).toHaveLength(3);
    // Newest first — last-written row surfaces first.
    expect(top3[0].claimId).toBe("clm-4");
    expect(top3[1].claimId).toBe("clm-3");
    expect(top3[2].claimId).toBe("clm-2");

    // Limit clamp: asking for fewer than 1 still returns at least 1.
    const one = webhookHistory.list(undefined, 0)!;
    expect(one).toHaveLength(1);
    expect(one[0].claimId).toBe("clm-4");

    // Missing log file → null (route maps to 404).
    rmSync(process.env.SPENDFLOW_WEBHOOK_LOG!, { force: true });
    expect(webhookHistory.list(undefined, 10)).toBeNull();
  });
});

/* ============================================================================
 * SpendFlow — SLA computation tests (ticket #74).
 *
 * Covers the boundary mapping in {@link computeClaimSla} (fresh / aging /
 * breached), the `submittedAt ?? createdAt` fallback for unsubmitted claims,
 * and the terminal-status override (paid claims never badge as stale even
 * when their age is large). The helper is pure, so no DB harness is needed.
 * ========================================================================== */
import { describe, expect, it } from "vitest";
import {
  SLA_THRESHOLDS,
  claimSlaBadge,
  computeClaimSla,
  decorateClaimWithSla,
  thresholdFor,
} from "../src/services/sla.js";

const NOW = new Date("2026-08-12T00:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

describe("computeClaimSla — boundary mapping", () => {
  it("marks a just-submitted claim as fresh and an aging claim as aging", () => {
    const threshold = thresholdFor("approved");
    expect(threshold).toBe(SLA_THRESHOLDS.pending_finance_decision_days);

    // Fresh: age < threshold * 0.4 (5 * 0.4 = 2 → 1 day old is fresh).
    const fresh = computeClaimSla(
      {
        status: "approved",
        createdAt: daysAgo(1),
        submittedAt: daysAgo(1),
      },
      NOW,
    );
    expect(fresh.level).toBe("fresh");
    expect(fresh.ageDays).toBe(1);
    expect(fresh.thresholdDays).toBe(threshold);

    // Aging: threshold * 0.75 ≤ age < threshold (5 * 0.75 = 3.75 → 4 days old).
    const aging = computeClaimSla(
      {
        status: "approved",
        createdAt: daysAgo(4),
        submittedAt: daysAgo(4),
      },
      NOW,
    );
    expect(aging.level).toBe("aging");
    expect(aging.ageDays).toBe(4);
  });

  it("marks a claim past threshold * 1.5 as breached", () => {
    const threshold = thresholdFor("action_required");
    expect(threshold).toBe(SLA_THRESHOLDS.pending_employee_decision_days);

    // Breached: age ≥ threshold * 1.5 (3 * 1.5 = 4.5 → 5 days old).
    const breached = computeClaimSla(
      {
        status: "action_required",
        createdAt: daysAgo(5),
        submittedAt: daysAgo(5),
      },
      NOW,
    );
    expect(breached.level).toBe("breached");
    expect(breached.ageDays).toBe(5);
    expect(breached.thresholdDays).toBe(threshold);

    // Badge reads as overdue with the error tone for the breached bucket.
    const badge = claimSlaBadge(breached.level, breached.ageDays);
    expect(badge.tone).toBe("error");
    expect(badge.label).toBe("Overdue: 5 days");
    // Lower priority sorts first (worst-at-top board).
    expect(badge.priority).toBe(0);
  });

  it("falls back to createdAt when submittedAt is null (e.g. a Draft claim)", () => {
    // Draft created 1 day ago, never submitted. Age derives from createdAt and,
    // since draft is terminal for SLA purposes, the bucket is always `fresh`.
    const draft = computeClaimSla(
      {
        status: "draft",
        createdAt: daysAgo(1),
        submittedAt: null,
      },
      NOW,
    );
    expect(draft.ageDays).toBe(1);
    expect(draft.level).toBe("fresh");

    // Paid claim: even with a large age it must not badge as stale — the FE
    // would otherwise render "Overdue" on a closed claim.
    const paid = computeClaimSla(
      {
        status: "paid",
        createdAt: daysAgo(60),
        submittedAt: daysAgo(60),
      },
      NOW,
    );
    expect(paid.ageDays).toBe(60);
    expect(paid.level).toBe("fresh");

    // decorateClaimWithSla stamps the same summary without dropping fields.
    const decorated = decorateClaimWithSla(
      { id: "clm-1", status: "pending", createdAt: daysAgo(2), submittedAt: daysAgo(2) },
      NOW,
    );
    expect(decorated.id).toBe("clm-1");
    expect(decorated.sla.level).toBe("on_track");
  });
});

import { describe, it, expect } from "vitest";
import {
  loadEmployeeDashboard,
  resolvePaidAt,
  PRIMARY_STATUSES,
} from "@/lib/mock/dashboard";
import { claimsForEmployee } from "@/lib/mock/mock_data";

describe("loadEmployeeDashboard — status summary counts", () => {
  it("reports counts that exactly match claimsForEmployee for u-emp-1", () => {
    const data = loadEmployeeDashboard("u-emp-1");
    const real = claimsForEmployee("u-emp-1");

    for (const status of PRIMARY_STATUSES) {
      const expected = real.filter((c) => c.status === status).length;
      const group = data.primaryGroups.find((g) => g.status === status);
      expect(group, `missing group for ${status}`).toBeDefined();
      expect(group!.count).toBe(expected);
    }
  });

  it("always exposes the four primary status groups in order", () => {
    const data = loadEmployeeDashboard("u-emp-1");
    expect(data.primaryGroups.map((g) => g.status)).toEqual([
      "draft",
      "pending",
      "action_required",
      "paid",
    ]);
  });

  it("marks the dashboard as having claims for an active employee", () => {
    expect(loadEmployeeDashboard("u-emp-1").hasAnyClaims).toBe(true);
  });

  it("secondary groups only include statuses with activity", () => {
    // u-emp-2 (Bima): processing + rejected + pending, no approved.
    const data = loadEmployeeDashboard("u-emp-2");
    const statuses = data.secondaryGroups.map((g) => g.status);
    expect(statuses).toContain("processing");
    expect(statuses).toContain("rejected");
    expect(statuses).not.toContain("approved");
  });
});

describe("loadEmployeeDashboard — recently paid", () => {
  it("sorts recently paid newest-first by paid date", () => {
    const data = loadEmployeeDashboard("u-emp-1");
    expect(data.recentlyPaid.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < data.recentlyPaid.length; i++) {
      expect(data.recentlyPaid[i - 1].paidAt >= data.recentlyPaid[i].paidAt).toBe(true);
    }
    // clm-1006 (paid 20 Jun) should rank above clm-1009 (paid 12 May).
    const ids = data.recentlyPaid.map((e) => e.claim.id);
    expect(ids.indexOf("clm-1006")).toBeLessThan(ids.indexOf("clm-1009"));
  });

  it("uses the paid approval action timestamp as paidAt", () => {
    const data = loadEmployeeDashboard("u-emp-1");
    const entry = data.recentlyPaid.find((e) => e.claim.id === "clm-1006");
    expect(entry?.paidAt).toBe("2026-06-20T15:00:00+07:00");
  });

  it("sums total reimbursed across paid claims", () => {
    const data = loadEmployeeDashboard("u-emp-1");
    expect(data.totalReimbursed).toBe(
      data.recentlyPaid.reduce((s, e) => s + e.amount, 0)
    );
    expect(data.paidCount).toBe(data.recentlyPaid.length);
  });
});

describe("resolvePaidAt", () => {
  it("falls back to decidedAt when no paid action exists", () => {
    const approved = claimsForEmployee("u-emp-3").find((c) => c.status === "approved")!;
    expect(resolvePaidAt(approved)).toBe(approved.decidedAt);
  });
});

import { describe, it, expect } from "vitest";
import { getNavItems } from "@/lib/auth/nav";

describe("getNavItems (role-based nav filtering)", () => {
  it("shows only Dashboard + Claims for Employee", () => {
    const items = getNavItems("employee");
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "My Claims"]);
    expect(items).toHaveLength(2);
  });

  it("shows the Approver's own nav items, never Employee items", () => {
    const items = getNavItems("approver");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).not.toContain("/employee");
    expect(hrefs).not.toContain("/employee/claims");
    expect(hrefs).toContain("/approver");
  });

  it("shows the Finance Admin's own nav items, never Employee/Approver items", () => {
    const items = getNavItems("finance");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).not.toContain("/employee");
    expect(hrefs).not.toContain("/approver");
    expect(hrefs).toContain("/finance/exceptions");
    expect(hrefs).toContain("/finance/payments");
    expect(hrefs).toContain("/finance/policies");
    expect(hrefs).toContain("/finance/users");
  });

  it("Employee has no finance or approver routes", () => {
    const hrefs = getNavItems("employee").map((i) => i.href);
    for (const h of hrefs) {
      expect(h.startsWith("/finance")).toBe(false);
      expect(h.startsWith("/approver")).toBe(false);
    }
  });
});

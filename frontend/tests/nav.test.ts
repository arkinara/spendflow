import { describe, it, expect } from "vitest";
import { getNavItems } from "@/lib/auth/nav";
import type { Role } from "@/lib/types";

describe("getNavItems (single-role)", () => {
  it("shows only Dashboard + Claims for an Employee", () => {
    const items = getNavItems(["employee"], "employee");
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "My Claims"]);
    expect(items).toHaveLength(2);
  });

  it("shows the Approver's own nav items, never Employee items", () => {
    const items = getNavItems(["approver"], "approver");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).not.toContain("/employee");
    expect(hrefs).not.toContain("/employee/claims");
    expect(hrefs).toContain("/approver");
  });

  it("shows the Finance Admin's own nav items, never Employee/Approver items", () => {
    const items = getNavItems(["finance"], "finance");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).not.toContain("/employee");
    expect(hrefs).not.toContain("/approver");
    expect(hrefs).toContain("/finance/exceptions");
    expect(hrefs).toContain("/finance/payments");
    expect(hrefs).toContain("/finance/policies");
    expect(hrefs).toContain("/finance/users");
  });

  it("Employee has no finance or approver routes", () => {
    const hrefs = getNavItems(["employee"], "employee").map((i) => i.href);
    for (const h of hrefs) {
      expect(h.startsWith("/finance")).toBe(false);
      expect(h.startsWith("/approver")).toBe(false);
    }
  });

  it("Finance nav entry shows the badge when the store reports a count > 0", () => {
    const items = getNavItems(["finance"], "finance", 3);
    const exceptions = items.find((i) => i.href === "/finance/exceptions");
    expect(exceptions?.badge).toBe(3);
  });

  it("hides the Finance exception badge when the count is 0", () => {
    const items = getNavItems(["finance"], "finance", 0);
    const exceptions = items.find((i) => i.href === "/finance/exceptions");
    expect(exceptions?.badge).toBeUndefined();
  });

  it("hides the Finance exception badge when no count is provided (store not loaded)", () => {
    const items = getNavItems(["finance"], "finance");
    const exceptions = items.find((i) => i.href === "/finance/exceptions");
    expect(exceptions?.badge).toBeUndefined();
  });

  it("hides the Finance exception badge when the store reports an error (null)", () => {
    const items = getNavItems(["finance"], "finance", null);
    const exceptions = items.find((i) => i.href === "/finance/exceptions");
    expect(exceptions?.badge).toBeUndefined();
  });
});

describe("getNavItems (multi-role, #45)", () => {
  it("concatenates Approver + Employee nav when the user holds both", () => {
    const roles: Role[] = ["approver", "employee"];
    const items = getNavItems(roles, "approver");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain("/approver");
    expect(hrefs).toContain("/employee");
    expect(hrefs).toContain("/employee/claims");
    // Approver dashboard leads because approver is the primary role.
    expect(hrefs[0]).toBe("/approver");
  });

  it("concatenates Finance + Employee nav when the user holds both", () => {
    const roles: Role[] = ["finance", "employee"];
    const items = getNavItems(roles, "finance");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain("/finance");
    expect(hrefs).toContain("/finance/users");
    expect(hrefs).toContain("/employee/claims");
  });

  it("concatenates all three sections when the user holds every role", () => {
    const roles: Role[] = ["employee", "approver", "finance"];
    const items = getNavItems(roles, "finance");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain("/employee/claims");
    expect(hrefs).toContain("/approver");
    expect(hrefs).toContain("/finance/payments");
    // No duplicate hrefs after de-dup.
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("never emits a duplicate href across concatenated sections", () => {
    const roles: Role[] = ["employee", "approver", "finance"];
    for (const primary of roles) {
      const hrefs = getNavItems(roles, primary).map((i) => i.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  it("leads with the primaryRole's section regardless of roles[] order", () => {
    const roles: Role[] = ["finance", "employee", "approver"];
    // primaryRole = employee → employee dashboard leads.
    const itemsEmp = getNavItems(roles, "employee");
    expect(itemsEmp[0].href).toBe("/employee");
    // primaryRole = approver → approver dashboard leads.
    const itemsAppr = getNavItems(roles, "approver");
    expect(itemsAppr[0].href).toBe("/approver");
    // primaryRole = finance → finance dashboard leads.
    const itemsFin = getNavItems(roles, "finance");
    expect(itemsFin[0].href).toBe("/finance");
  });

  it("returns no entries for an empty roles list (invalid session)", () => {
    expect(getNavItems([], "employee")).toEqual([]);
  });

  it("keeps the Finance exception badge live for a multi-role Finance user", () => {
    const items = getNavItems(["finance", "employee"], "finance", 7);
    const exceptions = items.find((i) => i.href === "/finance/exceptions");
    expect(exceptions?.badge).toBe(7);
  });
});

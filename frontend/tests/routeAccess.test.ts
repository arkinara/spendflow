import { describe, it, expect } from "vitest";
import { canAccess, routeAccess, ROLE_HOME } from "@/lib/auth/routeAccess";
import type { Role } from "@/lib/types";

describe("routeAccess", () => {
  it("marks landing and login as public", () => {
    expect(routeAccess("/")).toBe("public");
    expect(routeAccess("/login")).toBe("public");
    expect(routeAccess("/login?next=/finance")).toBe("public");
  });

  it("scopes each role section to its own role", () => {
    expect(routeAccess("/employee")).toEqual(["employee"]);
    expect(routeAccess("/employee/claims/clm-1001")).toEqual(["employee"]);
    expect(routeAccess("/approver")).toEqual(["approver"]);
    expect(routeAccess("/finance/payments")).toEqual(["finance"]);
  });
});

describe("canAccess (single-role, #45 signature)", () => {
  it("lets an Employee reach Employee routes, not Finance/Approver", () => {
    expect(canAccess(["employee"], "/employee")).toBe(true);
    expect(canAccess(["employee"], "/employee/claims/new")).toBe(true);
    expect(canAccess(["employee"], "/finance")).toBe(false);
    expect(canAccess(["employee"], "/approver")).toBe(false);
    expect(canAccess(["employee"], "/finance/exceptions")).toBe(false);
  });

  it("blocks Approver from Finance and Employee routes", () => {
    expect(canAccess(["approver"], "/approver")).toBe(true);
    expect(canAccess(["approver"], "/finance")).toBe(false);
    expect(canAccess(["approver"], "/employee")).toBe(false);
    expect(canAccess(["approver"], "/reports")).toBe(false);
  });

  it("blocks Finance Admin from Employee and Approver routes", () => {
    expect(canAccess(["finance"], "/finance")).toBe(true);
    expect(canAccess(["finance"], "/employee")).toBe(false);
    expect(canAccess(["finance"], "/approver")).toBe(false);
    expect(canAccess(["finance"], "/reports")).toBe(true);
  });
});

describe("canAccess (multi-role, #45)", () => {
  it("approver + employee reaches both /employee/* and /approver/*", () => {
    const roles: Role[] = ["approver", "employee"];
    expect(canAccess(roles, "/employee")).toBe(true);
    expect(canAccess(roles, "/employee/claims/new")).toBe(true);
    expect(canAccess(roles, "/approver")).toBe(true);
    expect(canAccess(roles, "/finance")).toBe(false);
  });

  it("finance + employee reaches /finance/*, /reports, and /employee/*", () => {
    const roles: Role[] = ["finance", "employee"];
    expect(canAccess(roles, "/finance/exceptions")).toBe(true);
    expect(canAccess(roles, "/reports")).toBe(true);
    expect(canAccess(roles, "/employee/claims")).toBe(true);
    expect(canAccess(roles, "/approver")).toBe(false);
  });

  it("all three roles reach every role-scoped route", () => {
    const roles: Role[] = ["employee", "approver", "finance"];
    expect(canAccess(roles, "/employee")).toBe(true);
    expect(canAccess(roles, "/approver")).toBe(true);
    expect(canAccess(roles, "/finance/payments")).toBe(true);
    expect(canAccess(roles, "/reports")).toBe(true);
  });

  it("approver-only (no employee) is still denied /employee/* until #46 implies it", () => {
    expect(canAccess(["approver"], "/employee/claims/new")).toBe(false);
  });

  it("an empty roles list is rejected everywhere (invalid session)", () => {
    expect(canAccess([], "/employee")).toBe(false);
    expect(canAccess([], "/finance")).toBe(false);
    expect(canAccess([], "/approver")).toBe(false);
    // Public + auth-only routes still admit anyone (no role required).
    expect(canAccess([], "/login")).toBe(true);
    expect(canAccess([], "/anything-else")).toBe(true);
  });
});

describe("ROLE_HOME redirect targets", () => {
  it("provides a role home for redirect targets", () => {
    expect(ROLE_HOME.employee).toBe("/employee");
    expect(ROLE_HOME.approver).toBe("/approver");
    expect(ROLE_HOME.finance).toBe("/finance");
  });
});

import { describe, it, expect } from "vitest";
import { canAccess, routeAccess, ROLE_HOME } from "@/lib/auth/routeAccess";

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

describe("canAccess", () => {
  it("lets an Employee reach Employee routes, not Finance/Approver", () => {
    expect(canAccess("employee", "/employee")).toBe(true);
    expect(canAccess("employee", "/employee/claims/new")).toBe(true);
    expect(canAccess("employee", "/finance")).toBe(false);
    expect(canAccess("employee", "/approver")).toBe(false);
    expect(canAccess("employee", "/finance/exceptions")).toBe(false);
  });

  it("blocks Approver from Finance and Employee routes", () => {
    expect(canAccess("approver", "/approver")).toBe(true);
    expect(canAccess("approver", "/finance")).toBe(false);
    expect(canAccess("approver", "/employee")).toBe(false);
    expect(canAccess("approver", "/reports")).toBe(true);
  });

  it("blocks Finance Admin from Employee and Approver routes", () => {
    expect(canAccess("finance", "/finance")).toBe(true);
    expect(canAccess("finance", "/employee")).toBe(false);
    expect(canAccess("finance", "/approver")).toBe(false);
    expect(canAccess("finance", "/reports")).toBe(true);
  });

  it("provides a role home for redirect targets", () => {
    expect(ROLE_HOME.employee).toBe("/employee");
    expect(ROLE_HOME.approver).toBe("/approver");
    expect(ROLE_HOME.finance).toBe("/finance");
  });
});

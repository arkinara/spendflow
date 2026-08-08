import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Role } from "@/lib/types";
import { SESSION_STORAGE_KEY } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/finance",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: vi.fn() }),
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { SessionProvider } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { RouteGuard } from "@/components/shell/RouteGuard";

/** Seed a session. Single-role by default; pass `roles` + `primaryRole` for a
 *  multi-role session (#45). Mirrors the `tests/setup.ts` `/api/me` mock that
 *  hydrates `roles`/`primaryRole` from this localStorage payload. */
function seed(
  role: Role,
  opts: { roles?: Role[]; primaryRole?: Role; userId?: string } = {},
) {
  const userId =
    opts.userId ??
    (role === "employee" ? "u-emp-1" : role === "approver" ? "u-mgr-1" : "u-fin-1");
  const primaryRole = opts.primaryRole ?? role;
  const roles = opts.roles ?? [primaryRole];
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId, role, roles, primaryRole, issuedAt: Date.now() }),
  );
}

function renderGuard(allowed: Role[]) {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={allowed}>
            <div>SECRET CONTENT</div>
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.push.mockClear();
  mocks.replace.mockClear();
  mocks.pathname = "/finance";
});

describe("RouteGuard redirect behavior (single-role)", () => {
  it("redirects an unauthenticated user to /login with a next param", async () => {
    // no seeded session
    renderGuard(["finance"]);
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/finance")}`);
    });
    expect(screen.queryByText("SECRET CONTENT")).not.toBeInTheDocument();
  });

  it("redirects an Employee hitting a Finance route to the Employee home", async () => {
    seed("employee");
    renderGuard(["finance"]);
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/employee");
    });
    expect(screen.queryByText("SECRET CONTENT")).not.toBeInTheDocument();
  });

  it("renders content when the authenticated role is allowed", async () => {
    seed("finance");
    renderGuard(["finance"]);
    await waitFor(() => {
      expect(screen.getByText("SECRET CONTENT")).toBeInTheDocument();
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("redirects an Approver hitting an Employee route to the Approver home", async () => {
    seed("approver");
    mocks.pathname = "/employee";
    renderGuard(["employee"]);
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/approver");
    });
  });
});

describe("RouteGuard multi-role access (#45)", () => {
  it("a multi-role user can access both /employee and /approver routes", async () => {
    seed("approver", { roles: ["approver", "employee"], primaryRole: "approver" });
    mocks.pathname = "/employee";
    const { rerender } = renderGuard(["employee"]);
    await waitFor(() => {
      expect(screen.getByText("SECRET CONTENT")).toBeInTheDocument();
    });

    // Re-render against the approver route with the same session.
    mocks.pathname = "/approver";
    rerender(
      <ThemeProvider>
        <SessionProvider>
          <SnackbarProvider>
            <RouteGuard allowedRoles={["approver"]}>
              <div>SECRET CONTENT</div>
            </RouteGuard>
          </SnackbarProvider>
        </SessionProvider>
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("SECRET CONTENT")).toBeInTheDocument();
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("a single-role Employee cannot reach the Approver route (role must be present, not implied)", async () => {
    seed("employee");
    mocks.pathname = "/approver";
    renderGuard(["approver"]);
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/employee");
    });
    expect(screen.queryByText("SECRET CONTENT")).not.toBeInTheDocument();
  });

  it("a denied multi-role user is redirected to their primaryRole's home", async () => {
    // Holds employee + approver, primaryRole employee → denied on /finance,
    // redirected to the employee home (not the approver home).
    seed("employee", { roles: ["employee", "approver"], primaryRole: "employee" });
    mocks.pathname = "/finance";
    renderGuard(["finance"]);
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/employee");
    });
  });

  it("a finance + employee multi-role user reaches /finance and /employee", async () => {
    seed("finance", { roles: ["finance", "employee"], primaryRole: "finance" });
    mocks.pathname = "/finance";
    renderGuard(["finance"]);
    await waitFor(() => {
      expect(screen.getByText("SECRET CONTENT")).toBeInTheDocument();
    });

    mocks.pathname = "/employee";
    render(
      <ThemeProvider>
        <SessionProvider>
          <SnackbarProvider>
            <RouteGuard allowedRoles={["employee"]}>
              <div>SECRET CONTENT</div>
            </RouteGuard>
          </SnackbarProvider>
        </SessionProvider>
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("SECRET CONTENT")).toBeInTheDocument();
    });
  });

  it("an empty-roles session is rejected and bounced to /login (never silently let through)", async () => {
    seed("employee", { roles: [], primaryRole: "employee" });
    mocks.pathname = "/employee";
    renderGuard(["employee"]);
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/employee")}`);
    });
    expect(screen.queryByText("SECRET CONTENT")).not.toBeInTheDocument();
  });

  it("a session whose primaryRole is not in roles is treated as invalid and sent to /login", async () => {
    // Corrupt invariant: primaryRole finance but roles only lists employee.
    seed("employee", { roles: ["employee"], primaryRole: "finance" });
    mocks.pathname = "/finance";
    renderGuard(["finance"]);
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/finance")}`);
    });
  });
});

describe("RouteGuard cross-role flows (#47)", () => {
  it("a triple-role user reaches employee, approver, and finance sections in one session", async () => {
    seed("employee", {
      roles: ["employee", "approver", "finance"],
      primaryRole: "employee",
    });

    // Employee section: initial render renders content.
    mocks.pathname = "/employee";
    const { rerender } = renderGuard(["employee"]);
    await waitFor(() => {
      expect(screen.getByText("SECRET CONTENT")).toBeInTheDocument();
    });

    // Approver section: same session, rerender against the approver allow-list.
    mocks.pathname = "/approver";
    rerender(
      <ThemeProvider>
        <SessionProvider>
          <SnackbarProvider>
            <RouteGuard allowedRoles={["approver"]}>
              <div>SECRET CONTENT</div>
            </RouteGuard>
          </SnackbarProvider>
        </SessionProvider>
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("SECRET CONTENT")).toBeInTheDocument();
    });

    // Finance section: same session again — all three reachable, no redirect.
    mocks.pathname = "/finance/payments";
    rerender(
      <ThemeProvider>
        <SessionProvider>
          <SnackbarProvider>
            <RouteGuard allowedRoles={["finance"]}>
              <div>SECRET CONTENT</div>
            </RouteGuard>
          </SnackbarProvider>
        </SessionProvider>
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("SECRET CONTENT")).toBeInTheDocument();
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("cross-role deny: [employee, approver] primaryRole approver denied /finance → approver home", async () => {
    // Holds employee + approver; finance is NOT held. Deny target must be the
    // primaryRole (approver) home, not the other held role's home.
    seed("approver", { roles: ["employee", "approver"], primaryRole: "approver" });
    mocks.pathname = "/finance";
    renderGuard(["finance"]);
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/approver");
    });
    expect(screen.queryByText("SECRET CONTENT")).not.toBeInTheDocument();
  });

  it("primaryRole swap within a held set changes the deny redirect target", async () => {
    // Same held set [employee, approver], but primaryRole = employee this time:
    // denied on /finance, redirect lands on /employee (the primary home).
    seed("employee", { roles: ["employee", "approver"], primaryRole: "employee" });
    mocks.pathname = "/finance";
    renderGuard(["finance"]);
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/employee");
    });
  });
});

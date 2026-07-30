import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Role } from "@/lib/mock/mock_data";
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

function seed(role: Role) {
  const userId = role === "employee" ? "u-emp-1" : role === "approver" ? "u-mgr-1" : "u-fin-1";
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId, role, issuedAt: Date.now() })
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
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.push.mockClear();
  mocks.replace.mockClear();
  mocks.pathname = "/finance";
});

describe("RouteGuard redirect behavior", () => {
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

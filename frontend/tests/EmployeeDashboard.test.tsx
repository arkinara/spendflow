import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClaimStatus } from "@/lib/types";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/employee",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navMocks.push, replace: navMocks.replace, refresh: vi.fn() }),
  usePathname: () => navMocks.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * #18: the employee dashboard reads through `useEmployeeDashboard` →
 * `listClaims` (HTTP), then shapes via the pure `buildDashboard` selector.
 * Mock the client so the dashboard is fed the in-memory fixtures the
 * assertions derive their expected counts from.
 */
vi.mock("@/lib/api/claims", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/claims")>();
  const { claimsForEmployee } = await import("@/lib/seed-data");
  return {
    ...actual,
    listClaims: vi.fn(async () => claimsForEmployee("u-emp-1")),
  };
});

import EmployeeDashboard from "@/app/employee/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { claimsForEmployee } from "@/lib/seed-data";
import * as claimsApi from "@/lib/api/claims";

function seedEmployee() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-emp-1", role: "employee", issuedAt: Date.now() })
  );
}

function renderDashboard() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["employee"]}>
            <EmployeeDashboard />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

function countFor(employeeId: string, status: ClaimStatus): number {
  return claimsForEmployee(employeeId).filter((c) => c.status === status).length;
}

beforeEach(() => {
  localStorage.clear();
  seedEmployee();
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  vi.mocked(claimsApi.listClaims).mockClear();
  // Re-establish the default impl after a per-test override may have run.
  vi.mocked(claimsApi.listClaims).mockImplementation(async () =>
    claimsForEmployee("u-emp-1"),
  );
});

describe("Employee dashboard — claim status summary", () => {
  it("renders the four status groups with counts matching mock data", async () => {
    renderDashboard();

    const region = await screen.findByRole("region", { name: /claim status summary/i });
    const draft = countFor("u-emp-1", "draft");
    const pending = countFor("u-emp-1", "pending");
    const action = countFor("u-emp-1", "action_required");
    const paid = countFor("u-emp-1", "paid");

    expect(
      within(region).getByRole("link", { name: new RegExp(`^${draft} draft claim`, "i") })
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: new RegExp(`^${pending} pending approval claim`, "i") })
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: new RegExp(`^${action} action required claim`, "i") })
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: new RegExp(`^${paid} paid claim`, "i") })
    ).toBeInTheDocument();
  });

  it("distinguishes Action Required with a warning badge and banner", async () => {
    renderDashboard();
    // Distinct badge on the action-required card.
    expect(await screen.findByText(/needs action/i)).toBeInTheDocument();
    // Prominent banner announcing returned claims.
    expect(await screen.findByText(/need your attention/i)).toBeInTheDocument();
  });

  it("links each status group to a pre-filtered claim history", async () => {
    renderDashboard();
    const region = await screen.findByRole("region", { name: /claim status summary/i });
    const pendingCard = within(region).getByRole("link", {
      name: /pending approval claim/i,
    });
    expect(pendingCard.getAttribute("href")).toBe("/employee/claims?status=pending");
  });
});

describe("Employee dashboard — quick-start new claim", () => {
  it("exposes a one-click New claim entry point to the wizard", async () => {
    renderDashboard();
    // Wait for content to mount so all New claim links are present.
    await screen.findByRole("region", { name: /claim status summary/i });
    const newClaimLinks = screen
      .getAllByRole("link")
      .filter((a) => /new claim/i.test(a.textContent ?? ""));
    expect(newClaimLinks.length).toBeGreaterThan(0);
    for (const link of newClaimLinks) {
      expect(link.getAttribute("href")).toBe("/employee/claims/new");
    }
  });
});

describe("Employee dashboard — recently paid overview", () => {
  it("lists paid claims newest-first by paid date", async () => {
    renderDashboard();
    const region = await screen.findByRole("region", { name: /recently paid claims/i });

    const bali = await within(region).findByRole("link", { name: /training conference/i });
    const bandung = within(region).getByRole("link", { name: /team offsite/i });

    // Bali (paid 20 Jun) must precede Bandung (paid 12 May).
    expect(
      bali.compareDocumentPosition(bandung) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // Each entry surfaces the paid date.
    expect(within(region).getByText(/20 jun 2026/i)).toBeInTheDocument();
    expect(within(region).getByText(/12 may 2026/i)).toBeInTheDocument();
  });
});

describe("Employee dashboard — empty + error states", () => {
  it("renders an empty-state dashboard for a first-time employee with no claims", async () => {
    // BE returns an empty claim list → buildDashboard yields hasAnyClaims=false.
    vi.mocked(claimsApi.listClaims).mockImplementationOnce(async () => []);

    renderDashboard();

    expect(await screen.findByText(/welcome to spendflow/i)).toBeInTheDocument();
    // New claim must remain prominent even with zero claims.
    const heroCta = screen
      .getAllByRole("link")
      .filter((a) => /new claim/i.test(a.textContent ?? ""));
    expect(heroCta.length).toBeGreaterThan(0);
    // No status summary region when there is nothing to summarise.
    expect(screen.queryByRole("region", { name: /claim status summary/i })).toBeNull();
  });

  it("shows a retry-capable error state instead of a blank dashboard on load failure", async () => {
    vi.mocked(claimsApi.listClaims).mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    renderDashboard();

    expect(await screen.findByText(/load your dashboard/i)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toBeInTheDocument();

    // Retry recovers: default impl runs again and the dashboard mounts.
    await userEvent.click(retry);
    expect(await screen.findByRole("region", { name: /claim status summary/i })).toBeInTheDocument();
  });
});

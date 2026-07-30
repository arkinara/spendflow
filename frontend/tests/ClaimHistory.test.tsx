import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/employee/claims",
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navMocks.push,
    replace: navMocks.replace,
    refresh: vi.fn(),
  }),
  usePathname: () => navMocks.pathname,
  useSearchParams: () => new URLSearchParams(navMocks.search),
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

import ClaimHistoryPage from "@/app/employee/claims/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { claimsForEmployee } from "@/lib/mock/mock_data";
import { createClaim, __removeClaim } from "@/lib/mock/claimStore";

function seedEmployee() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-emp-1", role: "employee", issuedAt: Date.now() })
  );
}

function renderHistory() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["employee"]}>
            <ClaimHistoryPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

/** Links whose href points at a claim detail row (excludes "New claim"). */
function claimRowLinks(): HTMLElement[] {
  return screen
    .getAllByRole("link")
    .filter((a) => /\/employee\/claims\/clm-/.test(a.getAttribute("href") ?? ""));
}

const seededIds: string[] = [];

beforeEach(() => {
  localStorage.clear();
  seedEmployee();
  navMocks.search = "";
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
});

afterEach(() => {
  seededIds.splice(0).forEach(__removeClaim);
});

describe("Claim list — status filter & ?status= deep link", () => {
  it("shows all of the employee's claims by default", async () => {
    renderHistory();
    const expected = claimsForEmployee("u-emp-1").length;
    await screen.findByText(/q2 client visit/i);
    expect(claimRowLinks()).toHaveLength(expected);
  });

  it("pre-applies the status filter from the ?status= query param", async () => {
    navMocks.search = "status=paid";
    renderHistory();

    // Paid tab is the active segment.
    const paidTab = await screen.findByRole("tab", { name: /paid/i });
    expect(paidTab.getAttribute("aria-selected")).toBe("true");

    // Only the two paid claims render; a pending claim does not.
    expect(screen.getByText(/training conference/i)).toBeInTheDocument();
    expect(screen.getByText(/team offsite/i)).toBeInTheDocument();
    expect(screen.queryByText(/q2 client visit/i)).toBeNull();
  });

  it("narrows the list when a status segment is clicked", async () => {
    renderHistory();
    await screen.findByText(/q2 client visit/i);

    fireEvent.click(screen.getByRole("tab", { name: /^draft/i }));
    // Only the draft claim (Warehouse Audit) remains.
    expect(screen.getByText(/warehouse audit/i)).toBeInTheDocument();
    expect(screen.queryByText(/q2 client visit/i)).toBeNull();
  });
});

describe("Claim list — date-range filter", () => {
  it("returns only claims whose date falls inside the selected range", async () => {
    renderHistory();
    await screen.findByText(/q2 client visit/i);

    fireEvent.change(screen.getByLabelText(/from this date/i), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText(/up to this date/i), {
      target: { value: "2026-07-31" },
    });

    // July claims are present.
    expect(screen.getByText(/q2 client visit/i)).toBeInTheDocument();
    expect(screen.getByText(/warehouse audit/i)).toBeInTheDocument();
    expect(screen.getByText(/vendor workshop/i)).toBeInTheDocument();
    // Out-of-range claims are filtered out.
    expect(screen.queryByText(/training conference/i)).toBeNull();
    expect(screen.queryByText(/team offsite/i)).toBeNull();
  });
});

describe("Claim list — empty state & clear filters", () => {
  it("shows a no-match empty state with a Clear filters action, then restores results", async () => {
    renderHistory();
    await screen.findByText(/q2 client visit/i);

    // The employee has no rejected claims → no matches.
    fireEvent.click(screen.getByRole("tab", { name: /rejected/i }));
    expect(await screen.findByText(/no matching claims/i)).toBeInTheDocument();
    expect(claimRowLinks()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /clear all filters/i }));
    // Default set restored.
    expect(await screen.findByText(/q2 client visit/i)).toBeInTheDocument();
  });
});

describe("Claim list — pagination over a large data set", () => {
  it("paginates 100+ claims, showing a bounded first page and next-page navigation", async () => {
    // Seed 100 extra claims for the current employee to exercise pagination.
    for (let i = 0; i < 100; i++) {
      const claim = createClaim({
        employeeId: "u-emp-1",
        title: `Seed Claim ${i}`,
        purpose: "pagination fixture",
        destination: "Jakarta",
        tripStart: "2026-08-01",
        tripEnd: "2026-08-02",
        currency: "IDR",
        lines: [
          {
            categoryId: "taxi",
            description: "Cab",
            date: "2026-08-01",
            amount: 50000,
            currency: "IDR",
          },
        ],
      });
      seededIds.push(claim.id);
    }

    renderHistory();

    const nav = await screen.findByRole("navigation", { name: /claim pages/i });
    expect(within(nav).getByText(/page 1 of/i)).toBeInTheDocument();

    // First page is bounded to the page size (10), not all 105 rows. The seeded
    // claims are newest, so they sort onto the first pages.
    const firstPageRows = await screen.findAllByText(/^seed claim \d+$/i);
    expect(firstPageRows).toHaveLength(10);
    expect(claimRowLinks()).toHaveLength(10);

    // Navigate to the next page and confirm a different bounded slice renders.
    fireEvent.click(within(nav).getByRole("button", { name: /next page/i }));
    await screen.findByText(/page 2 of/i);
    expect(claimRowLinks()).toHaveLength(10);
  });
});

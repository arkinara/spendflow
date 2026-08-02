import { describe, it, expect, vi, beforeEach } from "vitest";
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

/**
 * #18: the list page reads through `useEmployeeClaims` → `listClaims` (HTTP).
 * Mock the client so the page is fed the same in-memory fixtures the prior
 * mock-store-backed tests asserted against. Default returns u-emp-1's claims;
 * individual tests override (e.g. the pagination case) via mockImplementationOnce.
 */
vi.mock("@/lib/api/claims", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/claims")>();
  const { claimsForEmployee } = await import("@/lib/mock/mock_data");
  return {
    ...actual,
    listClaims: vi.fn(async () => claimsForEmployee("u-emp-1")),
  };
});

import ClaimHistoryPage from "@/app/employee/claims/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { claimsForEmployee, type Claim } from "@/lib/mock/mock_data";
import * as claimsApi from "@/lib/api/claims";

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

/** Build N synthetic claims for the pagination test (BE-shaped → FE shape is
 *  the listClaims mock's contract; we return FE-shaped rows directly). */
function syntheticClaims(n: number): Claim[] {
  const now = Date.parse("2026-08-01T00:00:00Z");
  const out: Claim[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `clm-seed-${i}`,
      reference: `EXP-2026-S${i}`,
      title: `Seed Claim ${i}`,
      purpose: "pagination fixture",
      employeeId: "u-emp-1",
      status: "pending",
      currency: "IDR",
      createdAt: new Date(now - i * 1000).toISOString(),
      submittedAt: new Date(now - i * 1000).toISOString(),
      destination: "Jakarta",
      lineItems: [
        {
          id: `seed-li-${i}`,
          categoryId: "taxi",
          description: "Cab",
          date: "2026-08-01",
          amount: 50_000,
          currency: "IDR",
          hasReceipt: false,
        },
      ],
      attachments: [],
      approvals: [],
    });
  }
  return out;
}

beforeEach(() => {
  localStorage.clear();
  seedEmployee();
  navMocks.search = "";
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  vi.mocked(claimsApi.listClaims).mockClear();
  // Re-establish the default impl after a per-test override may have run.
  vi.mocked(claimsApi.listClaims).mockImplementation(async () =>
    claimsForEmployee("u-emp-1"),
  );
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
    // Seed 100 synthetic claims via the mocked HTTP client.
    vi.mocked(claimsApi.listClaims).mockImplementationOnce(async () => [
      ...syntheticClaims(100),
      ...claimsForEmployee("u-emp-1"),
    ]);

    renderHistory();

    const nav = await screen.findByRole("navigation", { name: /claim pages/i });
    expect(within(nav).getByText(/page 1 of/i)).toBeInTheDocument();

    // First page is bounded to the page size (10), not all rows. The seeded
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

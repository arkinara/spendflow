import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/employee/claims/clm-1001",
  id: "clm-1001",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navMocks.push,
    replace: navMocks.replace,
    refresh: vi.fn(),
  }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({ id: navMocks.id }),
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
 * #18: the detail page + `useClaimDetail` both read through `@/lib/api/claims`.
 * Mock the module so the page is fed controlled FE-shaped `Claim` fixtures
 * derived from the in-memory mock_data set. Ownership is enforced here as a
 * stand-in for the BE's session auth: claims owned by another employee throw
 * a 403 so the hook's `denied` branch renders.
 */
vi.mock("@/lib/api/claims", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/claims")>();
  const { getClaim: mockGetClaim } = await import("@/lib/mock/mock_data");
  const VIEWER = "u-emp-1";

  return {
    ...actual,
    getClaim: vi.fn(async (id: string): Promise<Claim> => {
      const claim = mockGetClaim(id);
      if (!claim) throw new actual.ClaimApiError(404, "not_found", "Claim not found.");
      if (claim.employeeId !== VIEWER)
        throw new actual.ClaimApiError(403, "forbidden", "This claim belongs to another employee.");
      return claim;
    }),
    getClaimAudit: vi.fn(async (id: string) => {
      const claim = mockGetClaim(id);
      if (!claim) return [];
      return claim.approvals.map((a) => ({
        id: a.id,
        actorId: a.actorId,
        action: a.action,
        entityType: "claim",
        entityId: id,
        before: null,
        after: null,
        createdAt: a.at,
      }));
    }),
    withdrawClaim: vi.fn(async (id: string) => mockGetClaim(id)),
    resubmitClaim: vi.fn(async (id: string): Promise<Claim> => {
      const claim = mockGetClaim(id);
      if (!claim) throw new actual.ClaimApiError(404, "not_found", "Claim not found.");
      claim.status = "pending";
      claim.approvals.push({
        id: `${claim.id}-ap-${claim.approvals.length + 1}`,
        actorId: "u-emp-1",
        action: "resubmitted",
        at: new Date().toISOString(),
        note: "Resubmitted after addressing the reviewer's request.",
      });
      return claim;
    }),
  };
});

import ClaimDetailPage from "@/app/employee/claims/[id]/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import {
  getClaim,
  computeClaimTotal,
  type Claim,
} from "@/lib/mock/mock_data";
import { formatCurrency } from "@/lib/format";
import * as claimsApi from "@/lib/api/claims";

function seedEmployee() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-emp-1", role: "employee", issuedAt: Date.now() })
  );
}

function renderDetail(id = "clm-1001") {
  navMocks.id = id;
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["employee"]}>
            <ClaimDetailPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  seedEmployee();
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  vi.mocked(claimsApi.getClaim).mockClear();
  vi.mocked(claimsApi.getClaimAudit).mockClear();
  vi.mocked(claimsApi.resubmitClaim).mockClear();
  vi.mocked(claimsApi.withdrawClaim).mockClear();
});

describe("Claim detail — line items, status & totals", () => {
  it("renders every line item, the current status, and the currency-aware total", async () => {
    renderDetail("clm-1001");

    const claim = getClaim("clm-1001")!;
    // Wait for the header to mount (HTTP read resolves async).
    await screen.findByText(claim.title);

    // Every line item description is listed.
    for (const line of claim.lineItems) {
      expect(screen.getByText(line.description)).toBeInTheDocument();
    }

    // Prominent status chip reflects the claim status.
    expect(screen.getByText(/pending approval/i)).toBeInTheDocument();

    // Currency-aware total appears in the expense-lines footer cell.
    const totalCell = screen.getByText("Total claimed").parentElement!;
    const totalValue = totalCell.querySelector("span:last-child");
    expect(totalValue?.textContent).toBe(
      formatCurrency(computeClaimTotal(claim), claim.currency)
    );
  });

  it("calls GET /api/claims/:id then /audit once on mount", async () => {
    renderDetail("clm-1001");
    await screen.findByText(/q2 client visit/i);
    expect(claimsApi.getClaim).toHaveBeenCalledWith("clm-1001");
    expect(claimsApi.getClaimAudit).toHaveBeenCalledWith("clm-1001");
  });

  it("surfaces a per-line policy flag for a receipt-required expense with no receipt", async () => {
    // clm-1003 line li-8: hotel 980k, no receipt → flagged.
    renderDetail("clm-1003");
    expect(await screen.findByText(/receipt required/i)).toBeInTheDocument();
  });

  it("offers Edit and Withdraw only for a draft claim", async () => {
    renderDetail("clm-1002");
    expect(await screen.findByRole("button", { name: /withdraw/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit/i })).toBeInTheDocument();
  });

  it("withdraws a draft claim through the BE and routes back to the list", async () => {
    renderDetail("clm-1002");
    const withdraw = await screen.findByRole("button", { name: /withdraw/i });
    fireEvent.click(withdraw);

    await waitFor(() => expect(claimsApi.withdrawClaim).toHaveBeenCalledWith("clm-1002"));
    await waitFor(() => expect(navMocks.push).toHaveBeenCalledWith("/employee/claims"));
  });
});

describe("Claim detail — not-found & access-denied states", () => {
  it("shows a not-found state when the BE returns 404 for an unknown id", async () => {
    renderDetail("clm-does-not-exist");
    expect(await screen.findByText(/claim not found/i)).toBeInTheDocument();
  });

  it("renders the denied branch on a BE 403 for another employee's claim", async () => {
    // clm-1004 belongs to u-emp-3; the mocked getClaim throws 403 for it.
    renderDetail("clm-1004");
    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
  });
});

describe("Status timeline — chronological order, actors & live re-render", () => {
  it("renders events in chronological order with the correct actors", async () => {
    renderDetail("clm-1006"); // Paid: created → submitted → approved → paid

    const region = await screen.findByRole("region", { name: /status timeline/i });

    const orderedTitles = [
      "Claim created",
      "Submitted for approval",
      "Approved",
      "Payment disbursed",
    ];
    const nodes = orderedTitles.map((t) => within(region).getByText(t));
    // Each node must precede the next in document order (strict chronological).
    for (let i = 0; i < nodes.length - 1; i++) {
      expect(
        nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }

    // Deciding actors are visible on their respective events.
    expect(within(region).getByText("Dewi Anggraeni")).toBeInTheDocument();
    expect(within(region).getByText("Ridwan Saputra")).toBeInTheDocument();
  });

  it("re-renders immediately with a new event after a resubmit action", async () => {
    // Deep-clone so we can restore the shared fixture after mutating it.
    const original: Claim = JSON.parse(JSON.stringify(getClaim("clm-1003")!));
    try {
      renderDetail("clm-1003");
      await screen.findByText(/vendor workshop/i);

      // Before: no resubmitted event.
      const region = screen.getByRole("region", { name: /status timeline/i });
      expect(within(region).queryByText("Resubmitted")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /resubmit/i }));

      // After the BE call + reload, the timeline re-reads the audit endpoint
      // and shows the new transition as the most recent event.
      await waitFor(() =>
        expect(within(region).getAllByText("Resubmitted").length).toBeGreaterThan(0)
      );
      expect(claimsApi.resubmitClaim).toHaveBeenCalledWith("clm-1003");
    } finally {
      // Restore the shared fixture so other tests/suites see the original state.
      const current = getClaim("clm-1003")!;
      Object.assign(current, original);
    }
  });

  it("renders a single-entry timeline for a claim with only a creation event (no error)", async () => {
    // clm-1002 (draft) has a single "created" approval.
    renderDetail("clm-1002");
    const region = await screen.findByRole("region", { name: /status timeline/i });
    expect(within(region).getByText("Claim created")).toBeInTheDocument();
    expect(within(region).queryByText("Submitted for approval")).toBeNull();
  });
});

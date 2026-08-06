import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";

/* ------------------------------------------------------------------ mocks */

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/reports",
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

// Capture CSV export payloads without triggering a real browser download.
const downloadSpy = vi.hoisted(() => vi.fn());
// Toggle to force `getReport` down a rejection path for a single call
// (network failure / 403), reset in `beforeEach`.
const rejectNext = vi.hoisted<{ current: Error | null }>(() => ({ current: null }));

/**
 * #23: the reports page reads through `@/lib/api/reporting`. Mock the module
 * so the page is fed report rows derived from the live `claims` mock fixture
 * (AND-combined the same way the real BE's `services/reporting.ts` does —
 * claim-level date/department/status, line-item-level category), and the BE's
 * typed-error invariants (400 empty_filter / inverted_date_range /
 * date_range_required, 403 forbidden) so the FE's unfiltered-prompt,
 * inline-validation, and access-denied branches render under test.
 */
vi.mock("@/lib/api/reporting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/reporting")>();
  const { claims } = await import("@/lib/fixtures");
  const { getUser, getCategory } = await import("@/lib/seed-data");

  type Filters = {
    dateStart?: string;
    dateEnd?: string;
    departments: string[];
    categories: string[];
    statuses: string[];
  };

  function isEmpty(f: Filters) {
    return (
      !f.dateStart &&
      !f.dateEnd &&
      f.departments.length === 0 &&
      f.categories.length === 0 &&
      f.statuses.length === 0
    );
  }

  function submittedDate(c: (typeof claims)[number]) {
    return (c.submittedAt ?? c.createdAt).slice(0, 10);
  }

  function buildRows(f: Filters) {
    const matchingClaims = claims.filter((c) => {
      const submitted = submittedDate(c);
      if (f.dateStart && submitted < f.dateStart) return false;
      if (f.dateEnd && submitted > f.dateEnd) return false;
      if (f.departments.length > 0) {
        const dept = getUser(c.employeeId)?.department;
        if (!dept || !f.departments.includes(dept)) return false;
      }
      if (f.statuses.length > 0 && !f.statuses.includes(c.status)) return false;
      return true;
    });
    const rows: import("@/lib/api/reporting").ReportRow[] = [];
    for (const c of matchingClaims) {
      for (const li of c.lineItems) {
        if (f.categories.length > 0 && !f.categories.includes(li.categoryId)) continue;
        rows.push({
          claimId: c.id,
          reference: c.reference,
          employeeId: c.employeeId,
          employeeName: getUser(c.employeeId)?.name ?? c.employeeId,
          department: getUser(c.employeeId)?.department ?? null,
          lineItemId: li.id,
          categoryId: li.categoryId,
          categoryName: getCategory(li.categoryId)?.name ?? li.categoryId,
          description: li.description,
          date: li.date,
          amount: li.amount,
          currency: li.currency,
          status: c.status,
          paymentReference: c.payment?.reference ?? null,
          submittedAt: submittedDate(c),
        });
      }
    }
    return rows;
  }

  function computeTotals(rows: import("@/lib/api/reporting").ReportRow[]) {
    const map = new Map<string, { currency: string; total: number; count: number }>();
    const claimSet = new Set<string>();
    for (const r of rows) {
      claimSet.add(r.claimId);
      const e = map.get(r.currency) ?? { currency: r.currency, total: 0, count: 0 };
      e.total += r.amount;
      e.count += 1;
      map.set(r.currency, e);
    }
    return {
      totals: [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      claimCount: claimSet.size,
    };
  }

  return {
    ...actual,
    ReportingApiError: actual.ReportingApiError,
    reportCsvFilename: actual.reportCsvFilename,
    downloadBlob: downloadSpy,
    getReport: vi.fn(async (f: Filters) => {
      if (rejectNext.current) {
        const err = rejectNext.current;
        rejectNext.current = null;
        throw err;
      }
      if (isEmpty(f)) {
        throw new actual.ReportingApiError(
          400,
          "empty_filter",
          "At least one filter (start, end, dept, cat, or status) is required"
        );
      }
      if (f.dateStart && f.dateEnd && f.dateEnd < f.dateStart) {
        throw new actual.ReportingApiError(400, "inverted_date_range", "`end` must be on or after `start`");
      }
      const rows = buildRows(f);
      const { totals, claimCount } = computeTotals(rows);
      return { rows, totals, claimCount };
    }),
    exportCsv: vi.fn(async (f: Filters) => {
      if (!f.dateStart || !f.dateEnd) {
        throw new actual.ReportingApiError(400, "date_range_required", "CSV export requires both start and end dates");
      }
      if (f.dateEnd < f.dateStart) {
        throw new actual.ReportingApiError(400, "inverted_date_range", "`end` must be on or after `start`");
      }
      const rows = buildRows(f);
      const header = [
        "claim_id",
        "employee",
        "category",
        "amount",
        "currency",
        "status",
        "payment_reference",
        "submitted_at",
      ].join(",");
      const lines = rows.map((r) =>
        [r.reference, r.employeeName, r.categoryName, r.amount, r.currency, r.status, r.paymentReference ?? "", r.submittedAt ?? ""].join(",")
      );
      return new Blob([[header, ...lines].join("\r\n")], { type: "text/csv" });
    }),
  };
});

import ReportsPage from "@/app/reports/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { claims } from "@/lib/fixtures";
import { getUser } from "@/lib/seed-data";
import type { Claim, User } from "@/lib/types";
import { ReportingApiError } from "@/lib/api/reporting";

/* ---------------------------------------------------------------- helpers */

function seedFinance() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-fin-1", role: "finance", issuedAt: Date.now() })
  );
}

const PRISTINE_CLAIMS: Claim[] = claims.map((c) => JSON.parse(JSON.stringify(c)));
const PRISTINE_USERS: User[] = claims
  .map((c) => getUser(c.employeeId))
  .filter((u): u is User => !!u)
  .map((u) => ({ ...u }));

function restoreStore() {
  claims.splice(0, claims.length, ...PRISTINE_CLAIMS.map((c) => JSON.parse(JSON.stringify(c))));
  for (const u of PRISTINE_USERS) {
    const live = getUser(u.id);
    if (live) {
      live.name = u.name;
      live.department = u.department;
    }
  }
}

function renderReports() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["finance"]}>
            <ReportsPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

/** Reference cell → enclosing <tr> (so per-row queries stay scoped). */
function chipInGroup(groupLabel: string, chipLabel: string): HTMLElement {
  const group = screen.getByRole("group", { name: groupLabel });
  return within(group).getByRole("button", { name: chipLabel });
}

beforeEach(() => {
  restoreStore();
  localStorage.clear();
  seedFinance();
  navMocks.search = "";
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  downloadSpy.mockClear();
  rejectNext.current = null;
});

afterEach(() => {
  restoreStore();
});

/* ============================================ Initial render / unfiltered */

describe("Reports page — initial render (no filters)", () => {
  it("shows a loading skeleton then the unfiltered prompt when no filter is active", async () => {
    renderReports();
    expect(screen.getAllByRole("status", { name: /loading/i }).length).toBeGreaterThan(0);
    expect(
      await screen.findByText(/choose a filter to generate a report/i)
    ).toBeInTheDocument();
    // No results table / totals render until a filter is chosen.
    expect(screen.queryByText(/matching$/)).toBeNull();
  });
});

/* ============================================ Filter combinations ==== */

describe("Reports page — combinable filters", () => {
  it("filters by a single status chip (Paid)", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);

    fireEvent.click(chipInGroup("Status", "Paid"));

    const paidLines = claims
      .filter((c) => c.status === "paid")
      .flatMap((c) => c.lineItems);
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${paidLines.length} matching`))).toBeInTheDocument();
    });
    expect(screen.getAllByText(/EXP-2026-1006/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/EXP-2026-1001/)).toBeNull();
  });

  it("combines department + category + status chips with AND semantics", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);

    fireEvent.click(chipInGroup("Department", "Sales"));
    fireEvent.click(chipInGroup("Category", "Flight"));
    fireEvent.click(chipInGroup("Status", "Approved"));

    const expectedLines = claims
      .filter((c) => getUser(c.employeeId)?.department === "Sales")
      .filter((c) => c.status === "approved")
      .flatMap((c) => c.lineItems.filter((li) => li.categoryId === "flight"));

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`${expectedLines.length} matching`))
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/EXP-2026-1001/)).toBeNull();
  });

  it("shows an empty state (zero rows) when a valid filter set matches nothing", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);

    fireEvent.click(chipInGroup("Status", "Paid"));
    await waitFor(() => screen.getByText(/matching$/));

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2020-12-31" } });

    expect(await screen.findByRole("heading", { name: /no claims match/i })).toBeInTheDocument();
    expect(screen.getByText("0 matching")).toBeInTheDocument();
  });

  it("Clear all filters returns to the unfiltered prompt", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);

    fireEvent.click(chipInGroup("Status", "Paid"));
    await waitFor(() => screen.getByText(/matching$/));

    fireEvent.click(screen.getByRole("button", { name: /clear all filters/i }));
    await waitFor(() => {
      expect(screen.getByText(/choose a filter to generate a report/i)).toBeInTheDocument();
    });
  });
});

/* ============================================ Totals reactivity ====== */

describe("Reports page — per-currency totals", () => {
  it("renders per-currency totals and claim count for the active filter set", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);

    fireEvent.click(chipInGroup("Status", "Approved"));
    const approvedClaims = claims.filter((c) => c.status === "approved");
    await waitFor(() => {
      expect(screen.getAllByText("IDR").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(String(approvedClaims.length))).toBeInTheDocument();
  });
});

/* ============================================ CSV export ============= */

describe("Reports page — CSV export", () => {
  it("Export button is disabled with no filter and with zero results", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);
    expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();

    fireEvent.click(chipInGroup("Status", "Paid"));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2020-12-31" } });
    await screen.findByRole("heading", { name: /no claims match/i });
    expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();
  });

  it("Export is blocked while the date range is inverted, with an inline error", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-07-31" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-07-01" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/end date must be on or after/i);
    const exportBtn = screen.getByRole("button", { name: /export csv/i });
    expect(exportBtn).toBeDisabled();
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("Export downloads a timestamped CSV matching the active filter set", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);

    fireEvent.click(chipInGroup("Status", "Paid"));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-12-31" } });
    await waitFor(() => screen.getByText(/matching$/));

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));
    const [filename, blob] = downloadSpy.mock.calls[0];
    expect(filename).toMatch(/^spendflow-report-\d{8}-\d{6}\.csv$/);
    // jsdom's Blob lacks `.text()`/`.arrayBuffer()` and isn't accepted by
    // undici's `Response`, so read it back via FileReader instead.
    const content: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const lines = content.split("\r\n");
    expect(lines[0]).toBe("claim_id,employee,category,amount,currency,status,payment_reference,submitted_at");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("shows a retry-capable error banner when export fails over the network", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);

    fireEvent.click(chipInGroup("Status", "Paid"));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-12-31" } });
    await waitFor(() => screen.getByText(/matching$/));

    const { exportCsv } = await import("@/lib/api/reporting");
    (exportCsv as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t reach the server/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});

/* ============================================ Access control ========= */

describe("Reports page — access control & failures", () => {
  it("renders the access-denied panel on a 403 from the BE", async () => {
    rejectNext.current = new ReportingApiError(403, "forbidden", "Finance Admin access required");
    navMocks.search = "status=paid";
    renderReports();
    expect(await screen.findByText(/not authorized to view reports/i)).toBeInTheDocument();
  });

  it("renders a retry-capable error card on a network failure", async () => {
    rejectNext.current = new Error("Network down");
    navMocks.search = "status=paid";
    renderReports();
    expect(await screen.findByText(/couldn.t load report data/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

/* ============================================ URL state sync ========= */

describe("Reports page — URL query-param sync", () => {
  it("restores the report view from a copied URL (status=paid)", async () => {
    navMocks.search = "status=paid";
    renderReports();

    const paidLines = claims.filter((c) => c.status === "paid").flatMap((c) => c.lineItems);
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${paidLines.length} matching`))).toBeInTheDocument();
    });
    expect(chipInGroup("Status", "Paid")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/EXP-2026-1001/)).toBeNull();
  });

  it("restores a multi-dimension filter (dept + cat + date range)", async () => {
    navMocks.search = "start=2026-01-01&end=2026-12-31&dept=Sales&cat=flight&status=approved";
    renderReports();

    await waitFor(() => screen.getByText(/matching$/));
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-12-31");
    expect(chipInGroup("Department", "Sales")).toHaveAttribute("aria-pressed", "true");
    expect(chipInGroup("Category", "Flight")).toHaveAttribute("aria-pressed", "true");
    expect(chipInGroup("Status", "Approved")).toHaveAttribute("aria-pressed", "true");
  });

  it("writes a filter change into the URL via router.replace", async () => {
    renderReports();
    await screen.findByText(/choose a filter/i);
    navMocks.replace.mockClear();

    fireEvent.click(chipInGroup("Status", "Paid"));
    await waitFor(() => {
      expect(navMocks.replace).toHaveBeenCalled();
    });
    const calls = navMocks.replace.mock.calls;
    const last = calls[calls.length - 1];
    expect(last[0]).toMatch(/^\/reports\?status=paid$/);
  });
});

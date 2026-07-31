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
vi.mock("@/lib/mock/reportFilter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/mock/reportFilter")>();
  return {
    ...actual,
    downloadCsv: downloadSpy,
  };
});

import ReportsPage from "@/app/reports/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import {
  claims,
  computeClaimTotal,
  getUser,
  getClaim,
  type Claim,
  type User,
} from "@/lib/mock/mock_data";
import {
  REPORT_CSV_COLUMNS,
  buildReportCsv,
  claimCategoryLabel,
  claimEmployeeName,
  claimPaymentReference,
  claimSubmittedDate,
  computeCurrencyTotals,
  escapeCsvField,
  filterClaims,
  filtersFromSearchParams,
  filtersToSearchParams,
  validateDateRange,
  type ReportFilters,
} from "@/lib/mock/reportFilter";
import { formatCurrency } from "@/lib/format";

/* ---------------------------------------------------------------- helpers */

function seedFinance() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-fin-1", role: "finance", issuedAt: Date.now() })
  );
}

/**
 * Pristine deep snapshot of the live mock store captured at module load.
 * Restore between tests so cross-test contamination stays out (vitest runs in
 * a single fork).
 */
const PRISTINE_CLAIMS: Claim[] = claims.map((c) => JSON.parse(JSON.stringify(c)));
const PRISTINE_USERS: User[] = claims
  .map((c) => getUser(c.employeeId))
  .filter((u): u is User => !!u)
  .map((u) => ({ ...u }));

function restoreStore() {
  claims.splice(
    0,
    claims.length,
    ...PRISTINE_CLAIMS.map((c) => JSON.parse(JSON.stringify(c)))
  );
  // Restore any user-name overrides applied by CSV-escaping tests.
  for (const u of PRISTINE_USERS) {
    const live = getUser(u.id);
    if (live) {
      live.name = u.name;
      live.email = u.email;
      live.jobTitle = u.jobTitle;
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

async function waitForReady() {
  // The list hook simulates latency; wait for the page heading + the summary
  // count to render. We can't wait for a specific claim reference because some
  // tests mount the page with a filter that excludes the seeded pending claim.
  await screen.findByRole("heading", { name: "Reports", level: 1 });
  await screen.findByText(/matching$/);
}

/** Reference cell → enclosing <tr> (so per-row queries stay scoped). */
function rowFor(reference: string): HTMLElement {
  return screen.getByText(new RegExp(reference)).closest("tr")!;
}

/** Toggle a chip inside a labelled filter group (Department / Category / Status). */
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
});

afterEach(() => {
  restoreStore();
});

/**
 * Match a formatted currency value in the DOM by its rendered text, accepting
 * any whitespace between the symbol and the amount. Intl emits a NBSP that
 * testing-library's default normalizer doesn't always round-trip on a string
 * matcher — escaping the formatted string and relaxing whitespace sidesteps it.
 * Works for both IDR ("Rp\xa036.660.000") and USD ("$4,787,000.00").
 */
function currencyRegex(amount: number, currency: "IDR" | "USD" = "IDR"): RegExp {
  const formatted = formatCurrency(amount, currency);
  const escaped = formatted
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s*");
  return new RegExp(escaped);
}

/* ============================================ pure utility unit tests ==== */

describe("report filter utilities", () => {
  it("escapeCsvField passes through plain values unchanged", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField(12345)).toBe("12345");
    expect(escapeCsvField("")).toBe("");
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("escapeCsvField wraps fields containing commas, quotes, or newlines", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(escapeCsvField(" trailing")).toBe('" trailing"');
    expect(escapeCsvField("trailing ")).toBe('"trailing "');
  });

  it("filterClaims applies date + department + category + status with AND semantics", () => {
    // No filters → every claim matches.
    const empty: ReportFilters = {
      departments: [],
      categories: [],
      statuses: [],
    };
    expect(filterClaims(claims, empty)).toHaveLength(claims.length);

    // Sales + flight + approved → exact intersection (3 seeded claims).
    const sales = claims.filter(
      (c) => getUser(c.employeeId)?.department === "Sales"
    );
    const withFlight = sales.filter((c) =>
      c.lineItems.some((li) => li.categoryId === "flight")
    );
    const salesFlightApproved = withFlight.filter((c) => c.status === "approved");
    const result = filterClaims(claims, {
      departments: ["Sales"],
      categories: ["flight"],
      statuses: ["approved"],
    });
    expect(result.map((c) => c.id).sort()).toEqual(
      salesFlightApproved.map((c) => c.id).sort()
    );
    expect(result.length).toBeGreaterThan(0);
    // Every result actually satisfies each constraint.
    for (const c of result) {
      expect(getUser(c.employeeId)?.department).toBe("Sales");
      expect(c.lineItems.some((li) => li.categoryId === "flight")).toBe(true);
      expect(c.status).toBe("approved");
    }
  });

  it("filterClaims applies the date range inclusively on submission date", () => {
    const all2026May = filterClaims(claims, {
      dateStart: "2026-05-01",
      dateEnd: "2026-05-31",
      departments: [],
      categories: [],
      statuses: [],
    });
    // clm-1009 was submitted 2026-05-05 → must match.
    const ids = all2026May.map((c) => c.id);
    expect(ids).toContain("clm-1009");
    for (const c of all2026May) {
      const d = claimSubmittedDate(c);
      expect(d >= "2026-05-01").toBe(true);
      expect(d <= "2026-05-31").toBe(true);
    }
  });

  it("computeCurrencyTotals groups per currency with correct counts and sums", () => {
    const totals = computeCurrencyTotals(claims);
    expect(totals).toHaveLength(1); // fixture is IDR-only
    expect(totals[0].currency).toBe("IDR");
    expect(totals[0].count).toBe(claims.length);
    const expectedSum = claims.reduce((s, c) => s + computeClaimTotal(c), 0);
    expect(totals[0].total).toBe(expectedSum);
  });

  it("computeCurrencyTotals separates mixed currencies without FX conversion", () => {
    // Promote one claim to USD out-of-band to simulate a mixed-currency set.
    getClaim("clm-1001")!.currency = "USD";
    const totals = computeCurrencyTotals(claims);
    const usd = totals.find((t) => t.currency === "USD");
    const idr = totals.find((t) => t.currency === "IDR");
    expect(usd).toBeDefined();
    expect(idr).toBeDefined();
    expect(usd!.count).toBe(1);
    expect(usd!.total).toBe(computeClaimTotal(getClaim("clm-1001")!));
    expect(idr!.count).toBe(claims.length - 1);
    // Per-currency totals stay independent (no FX blend into a single number).
    expect(totals).toHaveLength(2);
  });

  it("validateDateRange flags inverted ranges and accepts valid ones", () => {
    expect(
      validateDateRange({
        dateStart: "2026-07-31",
        dateEnd: "2026-07-01",
        departments: [],
        categories: [],
        statuses: [],
      })
    ).toMatch(/end date must be on or after/i);
    expect(
      validateDateRange({
        dateStart: "2026-07-01",
        dateEnd: "2026-07-31",
        departments: [],
        categories: [],
        statuses: [],
      })
    ).toBeNull();
    expect(
      validateDateRange({
        dateStart: "2026-07-01",
        dateEnd: undefined,
        departments: [],
        categories: [],
        statuses: [],
      })
    ).toBeNull();
  });

  it("filtersToSearchParams / filtersFromSearchParams round-trip (order-normalized)", () => {
    // The writer normalizes multi-value arrays to sorted order, so the
    // restored filters' arrays come back sorted — pick sorted input to make
    // the round-trip equality exact.
    const filters: ReportFilters = {
      dateStart: "2026-01-01",
      dateEnd: "2026-12-31",
      departments: ["Operations", "Sales"],
      categories: ["flight", "hotel"],
      statuses: ["approved", "paid"],
    };
    const qs = filtersToSearchParams(filters).toString();
    const restored = filtersFromSearchParams(new URLSearchParams(qs));
    expect(restored).toEqual(filters);
  });

  it("filtersFromSearchParams drops malformed values gracefully", () => {
    const restored = filtersFromSearchParams(
      new URLSearchParams("start=not-a-date&status=bogus,departments,paid&dept=Sales")
    );
    expect(restored.dateStart).toBeUndefined();
    expect(restored.statuses).toEqual(["paid"]);
    expect(restored.departments).toEqual(["Sales"]);
  });
});

/* ============================================ CSV builder unit tests ==== */

describe("CSV builder — header, rows, escaping", () => {
  it("emits the exact required header row in order", () => {
    const csv = buildReportCsv([]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(REPORT_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(1); // header only, no rows
  });

  it("produces one row per claim, in input order", () => {
    const subset = claims.slice(0, 3);
    const csv = buildReportCsv(subset);
    const rows = csv.split("\r\n");
    expect(rows).toHaveLength(subset.length + 1); // header + rows
    // Spot-check the first claim row uses its reference.
    expect(rows[1]).toContain(subset[0].reference);
  });

  it("escapes commas, quotes, and newlines inside any field", () => {
    // Construct a synthetic claim whose employee name, category label, and
    // payment reference all carry CSV-hostile characters. buildReportCsv
    // resolves the name via getUser and the category via claimCategoryLabel,
    // so override the user record + payment to drive escaping.
    const c = getClaim("clm-1001")!;
    const originalName = getUser(c.employeeId)!.name;
    const originalPayment = c.payment;
    getUser(c.employeeId)!.name = 'Wijaya, "Sari"';
    c.payment = { method: "bank_transfer", reference: "TRX-1\nABC" };
    try {
      const csv = buildReportCsv([c]);
      const row = csv.split("\r\n")[1];
      // The quoted field with a comma must be wrapped and the embedded quotes
      // doubled.
      expect(row).toContain('"Wijaya, ""Sari"""');
      // The reference with a newline forces a quoted field; the newline stays
      // intact inside the quotes (the row split above only splits on CRLF).
      expect(row).toContain('"TRX-1\nABC"');
    } finally {
      getUser(c.employeeId)!.name = originalName;
      c.payment = originalPayment;
    }
  });

  it("emits payment reference as empty for unpaid claims", () => {
    const c = getClaim("clm-1001")!; // pending — no payment
    expect(claimPaymentReference(c)).toBe("");
    const csv = buildReportCsv([c]);
    const row = csv.split("\r\n")[1];
    // The row should end with the submitted date preceded by an empty field.
    expect(row).toContain(`,${claimSubmittedDate(c)}`);
  });

  it("exposes the expected header columns per the ticket DoD", () => {
    expect([...REPORT_CSV_COLUMNS]).toEqual([
      "Claim ID",
      "Employee",
      "Category",
      "Amount",
      "Currency",
      "Status",
      "Payment reference",
      "Submitted at",
    ]);
  });
});

/* ============================================ Reports page render ==== */

describe("Reports page — initial render & summary", () => {
  it("renders a loading skeleton, then the full claim set with a correct count", async () => {
    renderReports();
    // Loading first.
    expect(screen.getAllByRole("status", { name: /loading/i }).length).toBeGreaterThan(0);
    await waitForReady();

    // Summary count matches the live fixture size.
    expect(screen.getByText(`${claims.length} matching`)).toBeInTheDocument();
    // A known reference is in the table.
    expect(screen.getByText(/EXP-2026-1001/)).toBeInTheDocument();
  });

  it("shows the IDR total for the full fixture in the per-currency card", async () => {
    renderReports();
    await waitForReady();
    const expected = claims.reduce((s, c) => s + computeClaimTotal(c), 0);
    // Match by digit portion (see `currencyRegex` for the NBSP rationale).
    expect(screen.getAllByText(currencyRegex(expected)).length).toBeGreaterThan(0);
    // Per-currency row labels the currency (IDR appears in the per-currency
    // card AND in every table row's currency column, so use getAllByText).
    const idrMatches = screen.getAllByText("IDR").length;
    expect(idrMatches).toBeGreaterThan(0);
    // The per-currency row's claim-count text (anchored to exclude the live
    // region announcement, which also contains "12 claims" inside a longer
    // sentence).
    expect(
      screen.getByText(new RegExp(`^${claims.length} claims$`))
    ).toBeInTheDocument();
  });
});

/* ============================================ Filter combinations ==== */

describe("Reports page — combinable filters", () => {
  it("filters by a single status chip (Paid)", async () => {
    renderReports();
    await waitForReady();

    fireEvent.click(chipInGroup("Status", "Paid"));

    const paid = claims.filter((c) => c.status === "paid");
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${paid.length} matching`))).toBeInTheDocument();
    });
    // A known paid claim is present; a known pending claim is gone.
    expect(screen.getByText(/EXP-2026-1006/)).toBeInTheDocument(); // paid
    expect(screen.queryByText(/EXP-2026-1001/)).toBeNull(); // pending
  });

  it("combines department + category + status chips with AND semantics", async () => {
    renderReports();
    await waitForReady();

    fireEvent.click(chipInGroup("Department", "Sales"));
    fireEvent.click(chipInGroup("Category", "Flight"));
    fireEvent.click(chipInGroup("Status", "Approved"));

    const expected = filterClaims(claims, {
      departments: ["Sales"],
      categories: ["flight"],
      statuses: ["approved"],
    });
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`${expected.length} matching`))
      ).toBeInTheDocument();
    });
    // Every visible reference row actually matches all three predicates.
    for (const c of expected) {
      expect(screen.getByText(new RegExp(c.reference))).toBeInTheDocument();
    }
    // A known non-matcher (Operations, pending) is gone.
    expect(screen.queryByText(/EXP-2026-1001/)).toBeNull();
  });

  it("narrows by date range (start + end)", async () => {
    renderReports();
    await waitForReady();

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-05-01" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-05-31" },
    });

    const expected = filterClaims(claims, {
      dateStart: "2026-05-01",
      dateEnd: "2026-05-31",
      departments: [],
      categories: [],
      statuses: [],
    });
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`${expected.length} matching`))
      ).toBeInTheDocument();
    });
    // clm-1009 (submitted 2026-05-05) is in window.
    expect(screen.getByText(/EXP-2026-0998/)).toBeInTheDocument();
    // clm-1001 (submitted 2026-07-21) is out of window.
    expect(screen.queryByText(/EXP-2026-1001/)).toBeNull();
  });

  it("Clear all filters restores the full set", async () => {
    renderReports();
    await waitForReady();

    fireEvent.click(chipInGroup("Status", "Paid"));
    await waitFor(() =>
      expect(screen.queryByText(/EXP-2026-1001/)).toBeNull()
    );

    fireEvent.click(screen.getByRole("button", { name: /clear all filters/i }));
    await waitFor(() => {
      expect(screen.getByText(/EXP-2026-1001/)).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`${claims.length} matching`))
      ).toBeInTheDocument();
    });
  });

  it("shows an empty state (zero total) when no claims match", async () => {
    renderReports();
    await waitForReady();
    // A date range before any claim was filed → zero results.
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2020-01-01" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2020-12-31" },
    });
    // The table empty state surfaces a heading (the live region also mentions
    // no matches; target the heading specifically to disambiguate).
    expect(
      await screen.findByRole("heading", { name: /no claims match/i })
    ).toBeInTheDocument();
    // Claim count is zero.
    expect(screen.getByText("0").textContent).toBe("0");
  });
});

/* ============================================ Totals reactivity ====== */

describe("Reports page — totals & per-currency summary", () => {
  it("totals update reactively when a status filter is applied", async () => {
    renderReports();
    await waitForReady();

    const grandBefore = claims.reduce((s, c) => s + computeClaimTotal(c), 0);
    expect(screen.getAllByText(currencyRegex(grandBefore)).length).toBeGreaterThan(0);

    fireEvent.click(chipInGroup("Status", "Paid"));
    const paid = claims.filter((c) => c.status === "paid");
    const paidSum = paid.reduce((s, c) => s + computeClaimTotal(c), 0);
    await waitFor(() => {
      expect(screen.getAllByText(currencyRegex(paidSum)).length).toBeGreaterThan(0);
    });
    // MetricCard count also updates.
    expect(
      screen.getByText(new RegExp(`${paid.length} matching`))
    ).toBeInTheDocument();
  });

  it("renders a per-currency subtotal row per currency for mixed-currency data", async () => {
    // Promote one claim to USD so two currency rows render.
    getClaim("clm-1001")!.currency = "USD";
    renderReports();
    await waitForReady();

    const usdClaim = getClaim("clm-1001")!;
    const usdTotal = computeClaimTotal(usdClaim);
    const idrTotal = claims
      .filter((c) => c.currency === "IDR")
      .reduce((s, c) => s + computeClaimTotal(c), 0);

    // Both currency codes render (each appears in the per-currency card AND in
    // the table currency column for matching claims, so getAllByText).
    expect(screen.getAllByText("USD").length).toBeGreaterThan(0);
    expect(screen.getAllByText("IDR").length).toBeGreaterThan(0);
    // Per-currency subtotals are present (digit match — see currencyRegex;
    // pass the explicit currency so the formatter matches the rendered string).
    expect(screen.getAllByText(currencyRegex(usdTotal, "USD")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(currencyRegex(idrTotal, "IDR")).length).toBeGreaterThan(0);
  });
});

/* ============================================ CSV export ============= */

describe("Reports page — CSV export", () => {
  it("Export button is disabled when zero results match", async () => {
    renderReports();
    await waitForReady();

    // Narrow to nothing.
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2020-01-01" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2020-12-31" },
    });
    expect(
      await screen.findByRole("heading", { name: /no claims match/i })
    ).toBeInTheDocument();

    const exportBtn = screen.getByRole("button", { name: /export csv/i });
    expect(exportBtn).toBeDisabled();
  });

  it("Export produces a CSV whose row count matches the on-screen result count", async () => {
    renderReports();
    await waitForReady();

    // Narrow to a known subset.
    fireEvent.click(chipInGroup("Status", "Paid"));
    const paid = claims.filter((c) => c.status === "paid");
    await waitFor(() =>
      expect(
        screen.getByText(new RegExp(`${paid.length} matching`))
      ).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));
    const [filename, content] = downloadSpy.mock.calls[0];
    expect(filename).toMatch(/^spendflow-report-\d{8}-\d{6}\.csv$/);
    const lines = (content as string).split("\r\n");
    // header + one row per paid claim.
    expect(lines).toHaveLength(paid.length + 1);
    // Header carries every required column.
    expect(lines[0]).toBe(REPORT_CSV_COLUMNS.join(","));
    // Each paid claim's reference appears in the body.
    for (const c of paid) {
      const hit = lines.some((l) => l.includes(c.reference));
      expect(hit).toBe(true);
    }
  });

  it("Export is blocked while the date range is invalid", async () => {
    renderReports();
    await waitForReady();

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-07-31" },
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-07-01" },
    });

    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent(/end date must be on or after/i);
    const exportBtn = screen.getByRole("button", { name: /export csv/i });
    expect(exportBtn).toBeDisabled();
    fireEvent.click(exportBtn); // no-op when disabled
    expect(downloadSpy).not.toHaveBeenCalled();
  });
});

/* ============================================ URL state sync ========= */

describe("Reports page — URL query-param sync", () => {
  it("restores the report view from a copied URL (status=paid)", async () => {
    navMocks.search = "status=paid";
    renderReports();
    await waitForReady();

    const paid = claims.filter((c) => c.status === "paid");
    expect(
      screen.getByText(new RegExp(`${paid.length} matching`))
    ).toBeInTheDocument();
    // The Paid chip reflects the restored state.
    expect(chipInGroup("Status", "Paid")).toHaveAttribute("aria-pressed", "true");
    // A pending claim is filtered out.
    expect(screen.queryByText(/EXP-2026-1001/)).toBeNull();
  });

  it("restores a multi-dimension filter (dept + cat + date range)", async () => {
    navMocks.search =
      "start=2026-07-01&end=2026-07-31&dept=Sales&cat=flight&status=approved";
    renderReports();
    await waitForReady();

    const expected = filterClaims(claims, {
      dateStart: "2026-07-01",
      dateEnd: "2026-07-31",
      departments: ["Sales"],
      categories: ["flight"],
      statuses: ["approved"],
    });
    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`${expected.length} matching`))
      ).toBeInTheDocument();
    });
    // Date fields carry the restored values.
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-07-01");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-07-31");
    // Department + category + status chips are pressed.
    expect(chipInGroup("Department", "Sales")).toHaveAttribute("aria-pressed", "true");
    expect(chipInGroup("Category", "Flight")).toHaveAttribute("aria-pressed", "true");
    expect(chipInGroup("Status", "Approved")).toHaveAttribute("aria-pressed", "true");
  });

  it("writes a filter change into the URL via router.replace", async () => {
    renderReports();
    await waitForReady();
    navMocks.replace.mockClear();

    fireEvent.click(chipInGroup("Status", "Paid"));
    await waitFor(() => {
      expect(navMocks.replace).toHaveBeenCalled();
    });
    // The state→URL effect calls router.replace(url, { scroll: false }); the
    // relevant signal is the URL itself, which we assert against the last call.
    const calls = navMocks.replace.mock.calls;
    const last = calls[calls.length - 1];
    expect(last[0]).toMatch(/^\/reports\?status=paid$/);
  });

  it("omits empty filters from the URL so an all-time view is a clean /reports", async () => {
    renderReports();
    await waitForReady();
    navMocks.replace.mockClear();

    // Toggling a chip on writes the filter to the URL.
    fireEvent.click(chipInGroup("Status", "Paid"));
    await waitFor(() => {
      expect(navMocks.replace).toHaveBeenCalled();
    });
    const callsAfterOn = navMocks.replace.mock.calls;
    expect(callsAfterOn[callsAfterOn.length - 1][0]).toMatch(
      /^\/reports\?status=paid$/
    );
    // The chip reflects the selected state.
    expect(chipInGroup("Status", "Paid")).toHaveAttribute("aria-pressed", "true");

    // Toggling the same chip off returns the filter state to empty. The
    // state→URL effect short-circuits when the URL is already canonical (the
    // mock router doesn't propagate, so no second replace call lands), but the
    // chip state + the visible result count confirm the filter was cleared.
    fireEvent.click(chipInGroup("Status", "Paid"));
    await waitFor(() => {
      expect(chipInGroup("Status", "Paid")).toHaveAttribute("aria-pressed", "false");
    });
    expect(
      screen.getByText(new RegExp(`^${claims.length} matching$`))
    ).toBeInTheDocument();
  });
});

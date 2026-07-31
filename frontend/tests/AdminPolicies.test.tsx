import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/finance/policies",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navMocks.push,
    replace: navMocks.replace,
    refresh: vi.fn(),
  }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({}),
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

import PoliciesAdminPage from "@/app/finance/policies/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import {
  categories,
  policies,
  routingRules,
  claims,
  getClaim,
  type ExpenseCategory,
  type Policy,
  type RoutingRule,
} from "@/lib/mock/mock_data";
import {
  createCategory,
  updateCategory,
  setCategoryActive,
  getActiveCategories,
  createPolicy,
  updatePolicy,
  setPolicyActive,
  policyEffectiveOn,
  activePolicyFor,
  createRoute,
  updateRoute,
  setRouteActive,
  reorderRouteSteps,
  matchRouteForClaim,
  isSupportedPolicyCurrency,
  SUPPORTED_POLICY_CURRENCIES,
  type PolicyInput,
} from "@/lib/mock/adminStore";
import * as adminStoreModule from "@/lib/mock/adminStore";

/* ----------------------------------------------------------------- helpers */

function seedFinance() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-fin-1", role: "finance", issuedAt: Date.now() })
  );
}

function seedEmployee() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-emp-1", role: "employee", issuedAt: Date.now() })
  );
}

/**
 * Pristine deep snapshot of the live admin collections captured at module
 * load. Admin actions mutate the shared store (categories/policies/routes),
 * and vitest runs every file in a single fork, so we restore this baseline
 * between tests to keep each test (and neighbouring suites) isolated.
 */
const PRISTINE_CATEGORIES: ExpenseCategory[] = categories.map((c) => ({
  ...c,
}));
const PRISTINE_POLICIES: Policy[] = policies.map((p) => ({ ...p }));
const PRISTINE_ROUTES: RoutingRule[] = routingRules.map((r) => ({
  ...r,
  match: { ...r.match },
  steps: r.steps.map((s) => ({ ...s })),
}));

function restoreStore() {
  categories.splice(
    0,
    categories.length,
    ...PRISTINE_CATEGORIES.map((c) => ({ ...c }))
  );
  policies.splice(
    0,
    policies.length,
    ...PRISTINE_POLICIES.map((p) => ({ ...p }))
  );
  routingRules.splice(
    0,
    routingRules.length,
    ...PRISTINE_ROUTES.map((r) => ({
      ...r,
      match: { ...r.match },
      steps: r.steps.map((s) => ({ ...s })),
    }))
  );
}

/**
 * Renders the admin page through the finance RouteGuard, mirroring the real
 * `/finance/*` layout. RouteGuard shows a skeleton during session loading and
 * only mounts the page (whose AppShell calls `useRole`) once authenticated —
 * so the page never renders against an unauthenticated session.
 */
function renderPage() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["finance"]}>
            <PoliciesAdminPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

/** Open a tab by its segmented label (regex keeps it count-agnostic). */
async function openTab(label: RegExp) {
  const tab = await screen.findByRole("tab", { name: label });
  fireEvent.click(tab);
}

/** Wait for the ready state by probing for a known seeded row label. */
async function waitForReady(probe: RegExp) {
  await waitFor(() => expect(screen.getByText(probe)).toBeInTheDocument());
}

beforeEach(() => {
  restoreStore();
  localStorage.clear();
  seedFinance();
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
});

afterEach(() => {
  restoreStore();
});

/* ============================================================ STORE LOGIC == */
/* Pure store behaviour validated in isolation first (fast, no render latency). */

describe("Admin store — category CRUD + soft delete", () => {
  it("creates a category and surfaces it in the active list immediately", () => {
    const before = getActiveCategories().length;
    const row = createCategory({
      name: "Training",
      code: "trn",
      requiresMileage: true,
      requiresReceipt: true,
      receiptThreshold: 250_000,
    });
    expect(row.code).toBe("TRN"); // normalised to upper-case
    expect(getActiveCategories().length).toBe(before + 1);
    expect(getActiveCategories().some((c) => c.id === row.id)).toBe(true);
  });

  it("rejects a duplicate code and a missing name", () => {
    expect(() =>
      createCategory({
        name: "Dup",
        code: "FLT", // already used by seeded Flight
        requiresMileage: false,
        requiresReceipt: true,
        receiptThreshold: 0,
      })
    ).toThrow(/already used/i);
    expect(() =>
      createCategory({
        name: "   ",
        code: "XYZ",
        requiresMileage: false,
        requiresReceipt: true,
        receiptThreshold: 0,
      })
    ).toThrow(/name is required/i);
  });

  it("deactivates (soft delete) without removing the row from the list", () => {
    const row = createCategory({
      name: "Conference",
      code: "CNF",
      requiresMileage: false,
      requiresReceipt: true,
      receiptThreshold: 100_000,
    });
    setCategoryActive(row.id, false);
    const all = categories.map((c) => c.id);
    expect(all).toContain(row.id); // still present
    expect(getActiveCategories().some((c) => c.id === row.id)).toBe(false);
    // Re-enable to confirm toggle is reversible.
    setCategoryActive(row.id, true);
    expect(getActiveCategories().some((c) => c.id === row.id)).toBe(true);
  });
});

describe("Admin store — policy CRUD + effective dating", () => {
  const today = "2026-07-31";

  it("creates a policy and rejects a non-positive max amount", () => {
    const before = policies.length;
    const row = createPolicy({
      name: "Per diem cap",
      limit: 400_000,
      period: "per_day",
      currency: "IDR",
      receiptRequired: true,
      receiptRequiredAbove: 250_000,
      justificationRequiredAbove: 400_000,
      effectiveDate: today,
    });
    expect(policies.length).toBe(before + 1);
    expect(row.active).toBe(true);

    expect(() =>
      createPolicy({
        name: "Bad",
        limit: -5,
        period: "per_item",
        currency: "IDR",
        receiptRequired: true,
        receiptRequiredAbove: 0,
        justificationRequiredAbove: 0,
        effectiveDate: today,
      })
    ).toThrow(/positive/i);
  });

  it("rejects an unsupported currency at the store boundary", () => {
    // Currency is TypeScript-typed, but the store must enforce the allowlist at
    // runtime so a cast/bypass (or future BE payload) is rejected, not stored.
    expect(isSupportedPolicyCurrency("IDR")).toBe(true);
    expect(isSupportedPolicyCurrency("EUR")).toBe(false);
    const base: Omit<PolicyInput, "currency" | "name"> = {
      limit: 400_000,
      period: "per_item",
      receiptRequired: true,
      receiptRequiredAbove: 100_000,
      justificationRequiredAbove: 400_000,
      effectiveDate: today,
    };
    expect(() =>
      createPolicy({ ...base, name: "Bad currency", currency: "EUR" as never })
    ).toThrow(/not supported/i);
    // Supported currency still persists.
    expect(
      createPolicy({ ...base, name: "OK currency", currency: "USD" }).currency
    ).toBe("USD");
    expect(SUPPORTED_POLICY_CURRENCIES).toContain("IDR");
  });

  it("blocks a policy where a threshold exceeds the max amount (min<max guard)", () => {
    // Receipt-required threshold above the limit — blocked.
    expect(() =>
      createPolicy({
        name: "Bad receipt",
        limit: 500_000,
        period: "per_item",
        currency: "IDR",
        receiptRequired: true,
        receiptRequiredAbove: 800_000,
        justificationRequiredAbove: 500_000,
        effectiveDate: today,
      })
    ).toThrow(/receipt-required threshold cannot exceed the max amount/i);
    // Justification-required threshold above the limit — blocked.
    expect(() =>
      createPolicy({
        name: "Bad just",
        limit: 500_000,
        period: "per_item",
        currency: "IDR",
        receiptRequired: true,
        receiptRequiredAbove: 250_000,
        justificationRequiredAbove: 750_000,
        effectiveDate: today,
      })
    ).toThrow(/justification-required threshold cannot exceed the max amount/i);
    // Threshold equal to the limit is permitted (justification at/above the cap).
    expect(() =>
      createPolicy({
        name: "Equal threshold ok",
        limit: 500_000,
        period: "per_item",
        currency: "IDR",
        receiptRequired: true,
        receiptRequiredAbove: 250_000,
        justificationRequiredAbove: 500_000,
        effectiveDate: today,
      })
    ).not.toThrow();
  });

  it("policyEffectiveOn honours the effective date (future policy not yet in force)", () => {
    const future = createPolicy({
      name: "Next year cap",
      categoryId: "hotel",
      limit: 1_500_000,
      period: "per_item",
      currency: "IDR",
      receiptRequired: true,
      receiptRequiredAbove: 500_000,
      justificationRequiredAbove: 1_500_000,
      effectiveDate: "2027-01-01",
    });
    expect(policyEffectiveOn(future, "2026-07-31")).toBe(false);
    expect(policyEffectiveOn(future, "2027-01-01")).toBe(true);
    expect(policyEffectiveOn(future, "2027-06-01")).toBe(true);
  });

  it("keeps historical claims under the old rule when a new policy is effective later", () => {
    // Seeded hotel cap is 1,200,000 effective 2026-01-01 — in force today.
    expect(activePolicyFor("hotel", today)?.limit).toBe(1_200_000);
    // Schedule a higher cap for next year: today's claims still use the old cap.
    createPolicy({
      name: "Hotel cap 2027",
      categoryId: "hotel",
      limit: 2_000_000,
      period: "per_item",
      currency: "IDR",
      receiptRequired: true,
      receiptRequiredAbove: 500_000,
      justificationRequiredAbove: 2_000_000,
      effectiveDate: "2027-01-01",
    });
    expect(activePolicyFor("hotel", today)?.limit).toBe(1_200_000);
    expect(activePolicyFor("hotel", "2027-06-01")?.limit).toBe(2_000_000);
  });

  it("deactivates a policy without removing it from the list", () => {
    const before = policies.length;
    setPolicyActive("pol-1", false);
    expect(policies.length).toBe(before);
    expect(policies.find((p) => p.id === "pol-1")?.active).toBe(false);
  });
});

describe("Admin store — routing CRUD, reorder & match fall-through", () => {
  it("blocks a route with zero steps", () => {
    expect(() =>
      createRoute({ name: "Empty", match: {}, steps: [] })
    ).toThrow(/at least one approval step/i);
  });

  it("reorders steps and rejects a partial permutation", () => {
    const route = createRoute({
      name: "Reorder test",
      match: { minAmount: 1_000_000 },
      steps: [
        { approverType: "submitter_manager" },
        { approverType: "finance" },
      ],
    });
    const [a, b] = route.steps;
    reorderRouteSteps(route.id, [b.id, a.id]);
    expect(
      routingRules.find((r) => r.id === route.id)!.steps.map((s) => s.id)
    ).toEqual([b.id, a.id]);
    // Partial permutation (missing a step) is rejected.
    expect(() => reorderRouteSteps(route.id, [b.id])).toThrow(/every step/i);
  });

  it("matches a high-value claim to the specific route and falls other claims back", () => {
    // clm-1001 (Operations, ~4.79M) is under the 5M threshold and not Sales —
    // no specific route matches, so the fallback applies (single step).
    const standard = getClaim("clm-1001")!;
    const matched = matchRouteForClaim(standard);
    expect(matched.isFallback).toBe(true);
    expect(matched.steps).toHaveLength(1);

    // clm-1010 is owned by u-emp-3 (Sales dept) → matches the Sales-specific
    // route (2 steps) even though its total is under 5M.
    const salesClaim = getClaim("clm-1010")!;
    expect(salesClaim.employeeId).toBe("u-emp-3");
    const salesMatch = matchRouteForClaim(salesClaim);
    expect(salesMatch.id).toBe("rt-2");
    expect(salesMatch.steps).toHaveLength(2);

    // A high-value claim (clm-1008 ~5.1M) matches the high-value route.
    const highValue = matchRouteForClaim(getClaim("clm-1008")!);
    expect(highValue.id).toBe("rt-1");
    expect(highValue.name).toBe("High-value claim");
  });

  it("keeps a deactivated route from matching (falls through)", () => {
    // Deactivate the high-value route; a high-value claim should now fall back.
    setRouteActive("rt-1", false);
    const matched = matchRouteForClaim(getClaim("clm-1008")!);
    expect(matched.isFallback).toBe(true);
  });

  it("requires a named approver when approverType is specific_user", () => {
    expect(() =>
      createRoute({
        name: "Bad approver",
        match: {},
        steps: [{ approverType: "specific_user" }],
      })
    ).toThrow(/specific user/i);
  });
});

/* ================================================================ UI FLOWS == */

describe("Policy admin UI — destructive ops require confirmation", () => {
  it("opens a deactivate dialog and only flips status on confirm", async () => {
    renderPage();
    await waitForReady(/Hotel nightly cap/i);

    // Deactivate icon on the policy row.
    const cell = screen.getByText("Hotel nightly cap");
    const row = cell.closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Deactivate"));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /deactivate policy/i })
    ).toBeInTheDocument();
    // Status unchanged until confirmed.
    expect(policies.find((p) => p.id === "pol-1")!.active).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: /deactivate policy/i }));
    await waitFor(() =>
      expect(policies.find((p) => p.id === "pol-1")!.active).toBe(false)
    );
  });
});

describe("Category admin UI — add/edit/deactivate + live preview", () => {
  it("blocks save when required fields are missing, then creates the category and shows it in the list + preview", async () => {
    renderPage();
    await openTab(/categories/i);
    await waitForReady(/Taxi/i);

    fireEvent.click(screen.getByRole("button", { name: /new category/i }));
    const dialog = await screen.findByRole("dialog");

    // Submit empty → inline validation blocks save.
    fireEvent.click(within(dialog).getByRole("button", { name: /create category/i }));
    expect(await within(dialog).findByText(/name is required/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/code is required/i)
    ).toBeInTheDocument();

    // Fill required fields + toggle the mileage flag. (Required labels carry a
    // trailing "*" so match by regex rather than an exact string.)
    fireEvent.change(within(dialog).getByLabelText(/^name/i), {
      target: { value: "Training" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^code/i), {
      target: { value: "trn" },
    });
    fireEvent.change(within(dialog).getByLabelText(/receipt required above/i), {
      target: { value: "250000" },
    });
    fireEvent.click(
      within(dialog).getByRole("switch", { name: /mileage category/i })
    );

    const before = categories.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /create category/i }));

    // Row appears in the admin list immediately.
    await waitFor(() => expect(screen.getAllByText("Training").length).toBeGreaterThan(0));
    expect(categories.length).toBe(before + 1);
    const created = categories.find((c) => c.code === "TRN")!;
    expect(created.requiresMileage).toBe(true);

    // Preview reflects the active category (DoD: claim-builder preview).
    await waitFor(() =>
      expect(screen.getByText(/claim-builder preview/i)).toBeInTheDocument()
    );
  });

  it("edits an existing category and reflects the change inline", async () => {
    renderPage();
    await openTab(/categories/i);
    await waitForReady(/Taxi/i);

    // The category name appears in both the admin table and the live
    // claim-builder preview chips — scope to the table row.
    const cell = screen
      .getAllByText("Taxi / Ride-hailing")
      .find((el) => !!el.closest("tr"))!;
    const row = cell.closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Edit"));

    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText(/^name/i);
    fireEvent.change(nameField, { target: { value: "Taxi / Ride-share" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(
        categories.find((c) => c.id === "taxi")!.name
      ).toBe("Taxi / Ride-share")
    );
  });

  it("deactivates a category and keeps it visible marked inactive", async () => {
    renderPage();
    await openTab(/categories/i);
    await waitForReady(/Taxi/i);

    // Scope to the table row — the name also appears in the live preview chips.
    const cell = screen
      .getAllByText("Taxi / Ride-hailing")
      .find((el) => !!el.closest("tr"))!;
    const row = cell.closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Deactivate"));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /deactivate category/i })
    );

    await waitFor(() =>
      expect(categories.find((c) => c.id === "taxi")!.active).toBe(false)
    );
    // Still present in the list (soft delete) and now shows the Inactive pill.
    expect(
      screen.getAllByText("Taxi / Ride-hailing").length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
  });
});

describe("Policy admin UI — add/edit + effective-date display", () => {
  it("blocks a negative/non-numeric max amount, then creates the policy with all fields", async () => {
    renderPage();
    await waitForReady(/Hotel nightly cap/i);

    fireEvent.click(screen.getByRole("button", { name: /new policy/i }));
    const dialog = await screen.findByRole("dialog");

    // Name filled but max amount left empty → validation blocks save (the
    // amount field sanitises to digits-only, so the negative/non-numeric
    // guard is enforced at the store layer — see the store-level test above.
    fireEvent.change(within(dialog).getByLabelText(/^name/i), {
      target: { value: "Team event cap" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /create policy/i }));
    expect(await within(dialog).findByText(/positive max amount/i)).toBeInTheDocument();

    // Fill the limit + remaining required thresholds.
    fireEvent.change(within(dialog).getByLabelText(/max amount/i), {
      target: { value: "750000" },
    });
    fireEvent.change(
      within(dialog).getByLabelText(/receipt required above/i),
      { target: { value: "250000" } }
    );
    fireEvent.change(
      within(dialog).getByLabelText(/justification required above/i),
      { target: { value: "750000" } }
    );

    const before = policies.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /create policy/i }));
    // Store mutation is synchronous; the table re-renders after the hook's
    // simulated latency, so await the row label rather than asserting inline.
    await waitFor(() =>
      expect(screen.getByText("Team event cap")).toBeInTheDocument()
    );
    expect(policies.length).toBe(before + 1);
  });

  it("blocks a policy where the receipt threshold exceeds the max amount and surfaces the error inline", async () => {
    renderPage();
    await waitForReady(/Hotel nightly cap/i);

    fireEvent.click(screen.getByRole("button", { name: /new policy/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/^name/i), {
      target: { value: "Bad threshold policy" },
    });
    // Limit lower than the receipt threshold → cross-field min<max guard.
    fireEvent.change(within(dialog).getByLabelText(/max amount/i), {
      target: { value: "500000" },
    });
    fireEvent.change(within(dialog).getByLabelText(/receipt required above/i), {
      target: { value: "800000" },
    });
    fireEvent.change(
      within(dialog).getByLabelText(/justification required above/i),
      { target: { value: "500000" } }
    );

    const before = policies.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /create policy/i }));

    // Inline cross-field error renders and the store is untouched.
    expect(
      await within(dialog).findByText(/receipt threshold cannot exceed the max amount/i)
    ).toBeInTheDocument();
    expect(policies.length).toBe(before);
  });

  it("surfaces a store currency error inline instead of a silent toast", async () => {
    // The currency Select constrains to supported codes, so the runtime
    // allowlist is exercised at the store boundary — simulate a future caller
    // (or BE payload) that bypasses it, and assert the dialog shows the error
    // inline on the currency field.
    const spy = vi
      .spyOn(adminStoreModule, "createPolicy")
      .mockImplementation(() => {
        throw new Error(
          'Currency “XYZ” is not supported. Choose one of: IDR, USD.'
        );
      });

    try {
      renderPage();
      await waitForReady(/Hotel nightly cap/i);

      fireEvent.click(screen.getByRole("button", { name: /new policy/i }));
      const dialog = await screen.findByRole("dialog");

      fireEvent.change(within(dialog).getByLabelText(/^name/i), {
        target: { value: "Currency reject" },
      });
      fireEvent.change(within(dialog).getByLabelText(/max amount/i), {
        target: { value: "750000" },
      });
      fireEvent.change(within(dialog).getByLabelText(/receipt required above/i), {
        target: { value: "250000" },
      });
      fireEvent.change(
        within(dialog).getByLabelText(/justification required above/i),
        { target: { value: "750000" } }
      );

      fireEvent.click(within(dialog).getByRole("button", { name: /create policy/i }));
      expect(
        await within(dialog).findByText(/not supported/i)
      ).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it("edits an existing policy's effective date and updates the displayed value without touching other policies", async () => {
    renderPage();
    await waitForReady(/Hotel nightly cap/i);

    const cell = screen.getByText("Hotel nightly cap");
    const row = cell.closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Edit"));

    const dialog = await screen.findByRole("dialog");
    const dateField = within(dialog).getByLabelText(/effective date/i);
    fireEvent.change(dateField, { target: { value: "2026-09-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(policies.find((p) => p.id === "pol-1")!.effectiveDate).toBe("2026-09-01")
    );
    // Meal policy untouched.
    expect(policies.find((p) => p.id === "pol-2")!.effectiveDate).toBe("2026-01-01");
    // The displayed (formatted) date appears in the table (en-GB 2-digit day;
    // ICU may render the short month as "Sep" or "Sept" depending on the Node
    // build, so tolerate both).
    await waitFor(() =>
      expect(screen.getAllByText(/01 Sept? 2026/).length).toBeGreaterThan(0)
    );
  });
});

describe("Routing admin UI — create with criteria + steps, reorder persists", () => {
  it("blocks a route with zero steps, then creates a route with match criteria and ordered steps", async () => {
    renderPage();
    await openTab(/routing/i);
    await waitFor(() =>
      expect(screen.getByText("High-value claim")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /new route/i }));
    const dialog = await screen.findByRole("dialog");

    // Remove the default step → zero steps → blocked.
    fireEvent.click(within(dialog).getByLabelText("Remove step 1"));
    fireEvent.click(within(dialog).getByRole("button", { name: /create route/i }));
    expect(
      await within(dialog).findByText(/at least one approval step/i)
    ).toBeInTheDocument();

    // Re-add a step and name the route + criteria.
    fireEvent.click(within(dialog).getByRole("button", { name: /add step/i }));
    fireEvent.change(within(dialog).getByLabelText(/route name/i), {
      target: { value: "Marketing cap" },
    });
    fireEvent.change(within(dialog).getByLabelText("Min amount (optional)"), {
      target: { value: "2000000" },
    });

    const before = routingRules.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /create route/i }));
    await waitFor(() => expect(routingRules.length).toBe(before + 1));
    await waitFor(() =>
      expect(screen.getByText("Marketing cap")).toBeInTheDocument()
    );
  });

  it("reorders approval steps on a route card and persists the new order in mock state", async () => {
    renderPage();
    await openTab(/routing/i);
    // The high-value route (rt-1) is the first 2-step card rendered.
    await waitFor(() => expect(screen.getByText("High-value claim")).toBeInTheDocument());

    // Both 2-step cards expose a "Move step 1 down" control; the first one
    // belongs to the high-value card (routes render in declared order).
    const moveDownBtns = screen.getAllByLabelText("Move step 1 down");
    fireEvent.click(moveDownBtns[0]);

    const rule = routingRules.find((r) => r.id === "rt-1")!;
    await waitFor(() =>
      expect(rule.steps.map((s) => s.id)).toEqual(["rt-1-s2", "rt-1-s1"])
    );
  });
});

/* ------------------------------------------------------ access control guard */

describe("Policy admin — access control", () => {
  it("redirects a non-Finance (Employee) session away from the admin routes", async () => {
    seedEmployee();
    renderPage();

    await waitFor(() =>
      expect(navMocks.replace).toHaveBeenCalledWith("/employee")
    );
    // Admin content never mounts for the employee session.
    expect(screen.queryByText("Policy administration")).not.toBeInTheDocument();
  });

  it("renders an access-denied message before redirecting an Employee session", async () => {
    seedEmployee();
    renderPage();

    // A visible "not authorized" alert is rendered (not just a transient toast),
    // satisfying the access-denied acceptance criterion for /finance/policies.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not authorized/i);
    expect(navMocks.replace).toHaveBeenCalledWith("/employee");
  });
});

/* ------------------------------------- cross-test isolation sanity check */

describe("Policy admin — isolation", () => {
  it("does not leak admin-created categories into the claims array", () => {
    createCategory({
      name: "Isolation probe",
      code: "ISO",
      requiresMileage: false,
      requiresReceipt: true,
      receiptThreshold: 0,
    });
    // Claims collection is untouched by admin category creation.
    expect(claims.some((c) => c.id === "isolation-probe")).toBe(false);
  });
});

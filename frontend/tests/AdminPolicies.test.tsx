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

/**
 * #21: `/finance/policies` and `useAdminStore` read/write exclusively through
 * `@/lib/api/admin`. Mock that module so the page is fed controlled
 * `AdminCategory`/`AdminPolicy`/`AdminRoute` fixtures derived from the
 * fallback `lib/mock/adminStore` collections (still the FE's shared seed
 * data), and mutators delegate to the store's real validation so the BE's
 * invariants (duplicate code, min>=max thresholds, unsupported currency, zero
 * steps) are exercised through the same typed `AdminApiError` the real HTTP
 * client throws. A hoisted `adminMocks` flag lets a test force a 403 on the
 * next mutation, mirroring a session that loses Finance-Admin standing
 * mid-visit.
 */
const adminMocks = vi.hoisted(() => ({
  forceForbidden: false,
  forceCurrencyError: false,
}));

vi.mock("@/lib/api/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/admin")>();
  const store = await import("@/lib/mock/adminStore");
  const { AdminApiError } = actual;

  const STUB_TS = "2026-01-01T00:00:00Z";

  const toAdminCategory = (c: (typeof store.categories)[number]) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    icon: c.icon,
    requiresReceipt: c.requiresReceipt,
    receiptThreshold: c.receiptThreshold,
    perItemCap: c.perItemCap,
    requiresMileage: c.requiresMileage,
    active: c.active,
    createdAt: STUB_TS,
    updatedAt: STUB_TS,
  });

  const toAdminPolicy = (p: (typeof store.policies)[number]) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    categoryId: p.categoryId,
    limit: p.limit,
    period: p.period,
    currency: p.currency,
    receiptRequired: p.receiptRequired,
    receiptRequiredAbove: p.receiptRequiredAbove,
    justificationRequiredAbove: p.justificationRequiredAbove,
    effectiveDate: p.effectiveDate,
    active: p.active,
    createdAt: STUB_TS,
    updatedAt: STUB_TS,
  });

  const toAdminRoute = (r: (typeof store.routingRules)[number]) => ({
    id: r.id,
    name: r.name,
    match: { ...r.match },
    steps: r.steps.map((s) => ({ ...s })),
    isFallback: r.isFallback,
    active: r.active,
    createdAt: STUB_TS,
    updatedAt: STUB_TS,
  });

  /** Translate a thrown plain `Error` (from the fallback store's runtime
   *  guards) into the typed `AdminApiError` the real HTTP client throws, so
   *  the page's `instanceof AdminApiError` branches exercise the same code. */
  function wrapError(err: unknown): never {
    if (err instanceof AdminApiError) throw err;
    const message = err instanceof Error ? err.message : "Request failed.";
    if (/already used/i.test(message)) throw new AdminApiError(409, "duplicate_code", message);
    if (/at least one approval step|select a specific user/i.test(message)) {
      throw new AdminApiError(400, "invalid_steps", message);
    }
    throw new AdminApiError(400, "validation", message);
  }

  function checkForbidden() {
    if (adminMocks.forceForbidden) {
      throw new AdminApiError(403, "forbidden", "Your session no longer has Finance Admin access.");
    }
  }

  return {
    ...actual,
    AdminApiError,

    listCategories: vi.fn(async () => {
      checkForbidden();
      return store.categories.map(toAdminCategory);
    }),
    addCategory: vi.fn(async (input: Parameters<typeof store.createCategory>[0]) => {
      checkForbidden();
      try {
        return toAdminCategory(store.createCategory(input));
      } catch (err) {
        wrapError(err);
      }
    }),
    editCategory: vi.fn(async (id: string, patch: Parameters<typeof store.updateCategory>[1]) => {
      checkForbidden();
      try {
        return toAdminCategory(store.updateCategory(id, patch));
      } catch (err) {
        wrapError(err);
      }
    }),
    deactivateCategory: vi.fn(async (id: string) => {
      checkForbidden();
      try {
        return toAdminCategory(store.setCategoryActive(id, false));
      } catch (err) {
        wrapError(err);
      }
    }),

    listPolicies: vi.fn(async () => {
      checkForbidden();
      return store.policies.map(toAdminPolicy);
    }),
    addPolicy: vi.fn(async (input: Parameters<typeof store.createPolicy>[0]) => {
      checkForbidden();
      if (adminMocks.forceCurrencyError) {
        throw new AdminApiError(
          400,
          "validation",
          'Currency "XYZ" is not supported. Choose one of: IDR, USD.',
        );
      }
      try {
        return toAdminPolicy(store.createPolicy(input));
      } catch (err) {
        wrapError(err);
      }
    }),
    editPolicy: vi.fn(async (id: string, patch: Parameters<typeof store.updatePolicy>[1]) => {
      checkForbidden();
      try {
        return toAdminPolicy(store.updatePolicy(id, patch));
      } catch (err) {
        wrapError(err);
      }
    }),
    deactivatePolicy: vi.fn(async (id: string) => {
      checkForbidden();
      try {
        return toAdminPolicy(store.setPolicyActive(id, false));
      } catch (err) {
        wrapError(err);
      }
    }),

    listRoutes: vi.fn(async () => {
      checkForbidden();
      return store.routingRules.map(toAdminRoute);
    }),
    addRoute: vi.fn(async (input: Parameters<typeof store.createRoute>[0]) => {
      checkForbidden();
      try {
        return toAdminRoute(store.createRoute({ ...input, match: input.match ?? {} }));
      } catch (err) {
        wrapError(err);
      }
    }),
    editRoute: vi.fn(async (id: string, patch: Parameters<typeof store.updateRoute>[1]) => {
      checkForbidden();
      try {
        return toAdminRoute(store.updateRoute(id, patch));
      } catch (err) {
        wrapError(err);
      }
    }),
    reorderRouteSteps: vi.fn(async (id: string, orderedStepIds: string[]) => {
      checkForbidden();
      try {
        return toAdminRoute(store.reorderRouteSteps(id, orderedStepIds));
      } catch (err) {
        wrapError(err);
      }
    }),
    deactivateRoute: vi.fn(async (id: string) => {
      checkForbidden();
      try {
        return toAdminRoute(store.setRouteActive(id, false));
      } catch (err) {
        wrapError(err);
      }
    }),
  };
});

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
} from "@/lib/mock/mock_data";
import type {
  ExpenseCategory,
  Policy,
  RoutingRule,
} from "@/lib/types";
import { createCategory } from "@/lib/mock/adminStore";

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
 * load. Admin actions mutate the shared store (categories/policies/routes)
 * via the mocked API client, and vitest runs every file in a single fork, so
 * we restore this baseline between tests to keep each test isolated.
 */
const PRISTINE_CATEGORIES: ExpenseCategory[] = categories.map((c) => ({ ...c }));
const PRISTINE_POLICIES: Policy[] = policies.map((p) => ({ ...p }));
const PRISTINE_ROUTES: RoutingRule[] = routingRules.map((r) => ({
  ...r,
  match: { ...r.match },
  steps: r.steps.map((s) => ({ ...s })),
}));

function restoreStore() {
  categories.splice(0, categories.length, ...PRISTINE_CATEGORIES.map((c) => ({ ...c })));
  policies.splice(0, policies.length, ...PRISTINE_POLICIES.map((p) => ({ ...p })));
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
 * `/finance/*` layout.
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
  adminMocks.forceForbidden = false;
  adminMocks.forceCurrencyError = false;
});

afterEach(() => {
  restoreStore();
});

/* ================================================================ UI FLOWS == */

describe("Policy admin UI — reads through the API client", () => {
  it("renders categories, policies, and routes from the (mocked) lib/api/admin client", async () => {
    renderPage();
    await waitForReady(/Hotel nightly cap/i);

    await openTab(/categories/i);
    await waitForReady(/Taxi/i);

    await openTab(/routing/i);
    await waitFor(() => expect(screen.getByText("High-value claim")).toBeInTheDocument());
  });
});

describe("Policy admin UI — destructive ops require confirmation", () => {
  it("opens a deactivate dialog and only flips status on confirm", async () => {
    renderPage();
    await waitForReady(/Hotel nightly cap/i);

    const cell = screen.getByText("Hotel nightly cap");
    const row = cell.closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Deactivate"));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /deactivate policy/i })
    ).toBeInTheDocument();
    // Verb-named confirm button, not a bare "OK".
    expect(within(dialog).getByRole("button", { name: /deactivate policy/i })).toBeInTheDocument();
    // Status unchanged until confirmed.
    expect(policies.find((p) => p.id === "pol-1")!.active).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: /deactivate policy/i }));
    await waitFor(() => expect(policies.find((p) => p.id === "pol-1")!.active).toBe(false));
  });
});

describe("Category admin UI — add/edit/deactivate + live preview", () => {
  it("blocks save when required fields are missing, then creates the category and shows it in the list + preview", async () => {
    renderPage();
    await openTab(/categories/i);
    await waitForReady(/Taxi/i);

    fireEvent.click(screen.getByRole("button", { name: /new category/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: /create category/i }));
    expect(await within(dialog).findByText(/name is required/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/code is required/i)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Training" } });
    fireEvent.change(within(dialog).getByLabelText(/^code/i), { target: { value: "trn" } });
    fireEvent.change(within(dialog).getByLabelText(/receipt required above/i), {
      target: { value: "250000" },
    });
    fireEvent.click(within(dialog).getByRole("switch", { name: /mileage category/i }));

    const before = categories.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /create category/i }));

    await waitFor(() => expect(screen.getAllByText("Training").length).toBeGreaterThan(0));
    expect(categories.length).toBe(before + 1);
    const created = categories.find((c) => c.code === "TRN")!;
    expect(created.requiresMileage).toBe(true);

    await waitFor(() => expect(screen.getByText(/claim-builder preview/i)).toBeInTheDocument());
  });

  it("rejects a duplicate category code inline (mirrors the BE's 409 duplicate_code)", async () => {
    renderPage();
    await openTab(/categories/i);
    await waitForReady(/Taxi/i);

    fireEvent.click(screen.getByRole("button", { name: /new category/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Dup" } });
    fireEvent.change(within(dialog).getByLabelText(/^code/i), { target: { value: "TAX" } });
    fireEvent.change(within(dialog).getByLabelText(/receipt required above/i), {
      target: { value: "0" },
    });

    const before = categories.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /create category/i }));

    expect(await within(dialog).findByText(/already used/i)).toBeInTheDocument();
    expect(categories.length).toBe(before);
  });

  it("edits an existing category and reflects the change inline", async () => {
    renderPage();
    await openTab(/categories/i);
    await waitForReady(/Taxi/i);

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
      expect(categories.find((c) => c.id === "taxi")!.name).toBe("Taxi / Ride-share")
    );
  });

  it("deactivates a category and keeps it visible marked inactive", async () => {
    renderPage();
    await openTab(/categories/i);
    await waitForReady(/Taxi/i);

    const cell = screen
      .getAllByText("Taxi / Ride-hailing")
      .find((el) => !!el.closest("tr"))!;
    const row = cell.closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Deactivate"));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /deactivate category/i }));

    await waitFor(() => expect(categories.find((c) => c.id === "taxi")!.active).toBe(false));
    expect(screen.getAllByText("Taxi / Ride-hailing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
  });
});

describe("Policy admin UI — add/edit + effective-date display + validation edge ACs", () => {
  it("blocks a missing max amount, then creates the policy with all fields", async () => {
    renderPage();
    await waitForReady(/Hotel nightly cap/i);

    fireEvent.click(screen.getByRole("button", { name: /new policy/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/^name/i), {
      target: { value: "Team event cap" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /create policy/i }));
    expect(await within(dialog).findByText(/positive max amount/i)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/max amount/i), {
      target: { value: "750000" },
    });
    fireEvent.change(within(dialog).getByLabelText(/receipt required above/i), {
      target: { value: "250000" },
    });
    fireEvent.change(within(dialog).getByLabelText(/justification required above/i), {
      target: { value: "750000" },
    });

    const before = policies.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /create policy/i }));
    await waitFor(() => expect(screen.getByText("Team event cap")).toBeInTheDocument());
    expect(policies.length).toBe(before + 1);
  });

  it("edge AC: min>=max — receipt threshold exceeding the max amount is blocked with an inline error", async () => {
    renderPage();
    await waitForReady(/Hotel nightly cap/i);

    fireEvent.click(screen.getByRole("button", { name: /new policy/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/^name/i), {
      target: { value: "Bad threshold policy" },
    });
    fireEvent.change(within(dialog).getByLabelText(/max amount/i), {
      target: { value: "500000" },
    });
    fireEvent.change(within(dialog).getByLabelText(/receipt required above/i), {
      target: { value: "800000" },
    });
    fireEvent.change(within(dialog).getByLabelText(/justification required above/i), {
      target: { value: "500000" },
    });

    const before = policies.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /create policy/i }));

    // Client-side cross-field guard blocks the round trip.
    expect(
      await within(dialog).findByText(/receipt threshold cannot exceed the max amount/i)
    ).toBeInTheDocument();
    expect(policies.length).toBe(before);
  });

  it("edge AC: unknown currency from the BE (400 validation) surfaces inline on the currency field", async () => {
    adminMocks.forceCurrencyError = true;
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
    fireEvent.change(within(dialog).getByLabelText(/justification required above/i), {
      target: { value: "750000" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /create policy/i }));
    expect(await within(dialog).findByText(/not supported/i)).toBeInTheDocument();
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
    expect(policies.find((p) => p.id === "pol-2")!.effectiveDate).toBe("2026-01-01");
    await waitFor(() =>
      expect(screen.getAllByText(/01 Sept? 2026/).length).toBeGreaterThan(0)
    );
  });

  it("shows a 'Scheduled' badge for a policy whose effective date is in the future", async () => {
    renderPage();
    await waitForReady(/Hotel nightly cap/i);

    const cell = screen.getByText("Hotel nightly cap");
    const row = cell.closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Edit"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/effective date/i), {
      target: { value: "2099-01-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/scheduled/i)).toBeInTheDocument());
  });
});

describe("Routing admin UI — create with criteria + steps, reorder persists, edge ACs", () => {
  it("edge AC: zero steps is blocked with an inline error, then creates a route with match criteria and ordered steps", async () => {
    renderPage();
    await openTab(/routing/i);
    await waitFor(() => expect(screen.getByText("High-value claim")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /new route/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByLabelText("Remove step 1"));
    fireEvent.click(within(dialog).getByRole("button", { name: /create route/i }));
    expect(
      await within(dialog).findByText(/at least one approval step/i)
    ).toBeInTheDocument();

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
    await waitFor(() => expect(screen.getByText("Marketing cap")).toBeInTheDocument());
  });

  it("reorders approval steps on a route card and persists the new order through the API client", async () => {
    renderPage();
    await openTab(/routing/i);
    await waitFor(() => expect(screen.getByText("High-value claim")).toBeInTheDocument());

    const moveDownBtns = screen.getAllByLabelText("Move step 1 down");
    fireEvent.click(moveDownBtns[0]);

    const rule = routingRules.find((r) => r.id === "rt-1")!;
    await waitFor(() => expect(rule.steps.map((s) => s.id)).toEqual(["rt-1-s2", "rt-1-s1"]));
  });

  it("deactivates a route and keeps it visible marked inactive", async () => {
    renderPage();
    await openTab(/routing/i);
    await waitFor(() => expect(screen.getByText("High-value claim")).toBeInTheDocument());

    const card = screen.getByText("High-value claim").closest(".rounded-2xl")!;
    fireEvent.click(within(card as HTMLElement).getByLabelText("Deactivate"));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /deactivate route/i }));

    await waitFor(() => expect(routingRules.find((r) => r.id === "rt-1")!.active).toBe(false));
  });
});

/* ---------------------------------------------------- forced-403 (denied) === */

describe("Policy admin — 403 on a mutation renders the access-denied panel", () => {
  it("deactivating a category with a 403 response shows the denied panel instead of a silent failure", async () => {
    renderPage();
    await openTab(/categories/i);
    await waitForReady(/Taxi/i);

    adminMocks.forceForbidden = true;

    const cell = screen
      .getAllByText("Taxi / Ride-hailing")
      .find((el) => !!el.closest("tr"))!;
    const row = cell.closest("tr")!;
    fireEvent.click(within(row).getByLabelText("Deactivate"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /deactivate category/i }));

    expect(
      await screen.findByText(/not authorized to manage admin settings/i)
    ).toBeInTheDocument();
    // The category itself is untouched.
    expect(categories.find((c) => c.id === "taxi")!.active).toBe(true);
  });

  it("a 403 on the initial list load renders the denied panel", async () => {
    adminMocks.forceForbidden = true;
    renderPage();

    expect(
      await screen.findByText(/not authorized to manage admin settings/i)
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------ access control guard */

describe("Policy admin — cross-role access denied", () => {
  it("redirects a non-Finance (Employee) session away from the admin routes", async () => {
    seedEmployee();
    renderPage();

    await waitFor(() => expect(navMocks.replace).toHaveBeenCalledWith("/employee"));
    expect(screen.queryByText("Policy administration")).not.toBeInTheDocument();
  });

  it("renders an access-denied message before redirecting an Employee session", async () => {
    seedEmployee();
    renderPage();

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
    expect(claims.some((c) => c.id === "isolation-probe")).toBe(false);
  });
});

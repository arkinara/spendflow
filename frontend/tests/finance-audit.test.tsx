import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/finance/audit",
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navMocks.push,
    replace: navMocks.replace,
    refresh: vi.fn(),
  }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({}),
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
 * #71: `/finance/audit` reads the directory through `useUsers` and the audit
 * trail through `useGlobalAudit`, both of which route through
 * `@/lib/api/users`. Mock that module so the page is fed controlled fixtures
 * and the hook calls (incl. the composed `AuditAllFilters`) can be asserted.
 */
const usersMocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getGlobalAudit: vi.fn(),
}));

vi.mock("@/lib/api/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/users")>();
  return {
    ...actual,
    UsersApiError: actual.UsersApiError,
    listUsers: usersMocks.listUsers,
    getGlobalAudit: usersMocks.getGlobalAudit,
  };
});

import FinanceAuditPage from "@/app/finance/audit/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { UsersApiError, type BackendUser, type UserAuditEntry } from "@/lib/api/users";

/* ----------------------------------------------------------------- fixtures */

const TS = "2026-01-01T00:00:00Z";

function backendUser(overrides: Partial<BackendUser> = {}): BackendUser {
  return {
    id: "u-emp-1",
    name: "Aulia Pratiwi",
    email: "aulia.pratiwi@spendflow.example",
    emailVerified: true,
    image: null,
    role: "employee",
    managerId: "u-mgr-1",
    department: "Operations",
    costCenter: null,
    status: "active",
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

const FINANCE = backendUser({
  id: "u-fin-1",
  name: "Ridwan Saputra",
  email: "ridwan.saputra@spendflow.example",
  role: "finance",
  managerId: null,
  department: "Finance",
});

const MANAGER = backendUser({
  id: "u-mgr-1",
  name: "Dewi Anggraeni",
  email: "dewi.anggraeni@spendflow.example",
  role: "approver",
  managerId: null,
  department: "Operations",
});

const SEED_USERS: BackendUser[] = [FINANCE, MANAGER, backendUser()];

function auditEntry(overrides: Partial<UserAuditEntry> = {}): UserAuditEntry {
  return {
    id: "audit-1",
    actorId: "u-fin-1",
    action: "role.change",
    entityType: "user",
    entityId: "u-emp-1",
    before: { role: "employee" },
    after: { role: "approver" },
    createdAt: TS,
    ...overrides,
  };
}

function auditList(count: number): UserAuditEntry[] {
  return Array.from({ length: count }, (_, i) =>
    auditEntry({
      id: `a${i}`,
      actorId: i % 2 === 0 ? "u-fin-1" : "u-mgr-1",
      action: i % 3 === 0 ? "role.change" : i % 3 === 1 ? "manager.change" : "user.create",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    })
  );
}

const AUDIT_ENTRIES: UserAuditEntry[] = [
  auditEntry({
    id: "a1",
    actorId: "u-mgr-1",
    action: "manager.change",
    before: { managerId: null },
    after: { managerId: "u-mgr-1" },
    createdAt: "2026-01-02T00:00:00Z",
  }),
  auditEntry(),
];

/* ----------------------------------------------------------------- helpers */

beforeEach(() => {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-fin-1", role: "finance", issuedAt: Date.now() })
  );
  usersMocks.listUsers.mockReset();
  usersMocks.getGlobalAudit.mockReset();
  usersMocks.listUsers.mockResolvedValue(SEED_USERS);
  usersMocks.getGlobalAudit.mockResolvedValue(AUDIT_ENTRIES);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderPage() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["finance"]}>
            <FinanceAuditPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

async function waitForReady() {
  await waitFor(() => expect(screen.getByText(/Role change/)).toBeInTheDocument());
}

/* -------------------------------------------------------------------- tests */

describe("/finance/audit (#71)", () => {
  it("renders the page, directory-backed rows, and fetches the audit on mount", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Audit log/ })).toBeInTheDocument()
    );
    await waitForReady();

    // Directory resolves actor/target names into the rows (the signed-in
    // Finance Admin's name also appears in the nav, hence getAllByText).
    expect(screen.getAllByText("Ridwan Saputra").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dewi Anggraeni").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Aulia Pratiwi").length).toBeGreaterThan(0);
    // Both entries render.
    expect(screen.getAllByText("Role change")).toHaveLength(1);
    expect(screen.getAllByText("Manager change")).toHaveLength(1);

    expect(usersMocks.listUsers).toHaveBeenCalledTimes(1);
    expect(usersMocks.getGlobalAudit).toHaveBeenCalledWith({ limit: 500 });
  });

  it("re-fetches with the selected action and date-range filters", async () => {
    renderPage();
    await waitForReady();
    expect(usersMocks.getGlobalAudit).toHaveBeenCalledTimes(1);

    // Action select → Role change.
    fireEvent.click(screen.getByLabelText("Action"));
    fireEvent.click(screen.getByRole("button", { name: "Role change" }));
    await waitFor(() => expect(usersMocks.getGlobalAudit).toHaveBeenCalledTimes(2));
    expect(usersMocks.getGlobalAudit).toHaveBeenLastCalledWith({
      action: "role.change",
      limit: 500,
    });

    // Date range → from/to as unix-seconds bounds.
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-31" } });
    await waitFor(() => expect(usersMocks.getGlobalAudit).toHaveBeenCalledTimes(4));
    expect(usersMocks.getGlobalAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "role.change",
        from: expect.any(Number),
        to: expect.any(Number),
        limit: 500,
      })
    );
  });

  it("paginates through the fetched window with Next/Prev", async () => {
    usersMocks.getGlobalAudit.mockResolvedValue(auditList(60));
    renderPage();

    await waitFor(() => expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument());

    const list = screen.getByRole("list", { name: "Audit entries" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);

    // Prev disabled on page 1.
    expect(screen.getByRole("button", { name: /Prev/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);

    // Next disabled on the last page.
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Prev/ }));
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
  });

  it("shows the empty state when the audit has no entries", async () => {
    usersMocks.getGlobalAudit.mockResolvedValue([]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No audit entries yet")).toBeInTheDocument()
    );
  });

  it("shows the error state and retries on failure", async () => {
    usersMocks.getGlobalAudit.mockRejectedValue(
      new UsersApiError(500, "internal", "Backend exploded.")
    );
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Couldn't load the audit log/)).toBeInTheDocument()
    );
    expect(screen.getByText(/Backend exploded/)).toBeInTheDocument();

    // Retry re-runs the fetch and recovers.
    usersMocks.getGlobalAudit.mockResolvedValue(AUDIT_ENTRIES);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitForReady();
    expect(usersMocks.getGlobalAudit).toHaveBeenCalledTimes(2);
  });
});

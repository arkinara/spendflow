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
  pathname: "/finance/users",
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
 * #30: `/finance/users` reads/writes exclusively through `@/lib/api/users`.
 * Mock that module so the page is fed controlled `BackendUser` fixtures (the
 * seeded persona set from `backend/src/db/seed.ts`) and mutators can be
 * asserted on directly.
 */
const usersMocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  changeUserRole: vi.fn(),
  changeUserRoles: vi.fn(),
  setUserManager: vi.fn(),
  bulkChangeRole: vi.fn(),
  deactivate: vi.fn(),
  reactivate: vi.fn(),
  deleteUser: vi.fn(),
  getUserAudit: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock("@/lib/api/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/users")>();
  return {
    ...actual,
    UsersApiError: actual.UsersApiError,
    BulkPartialFailureError: actual.BulkPartialFailureError,
    listUsers: usersMocks.listUsers,
    changeUserRole: usersMocks.changeUserRole,
    changeUserRoles: usersMocks.changeUserRoles,
    setUserManager: usersMocks.setUserManager,
    bulkChangeRole: usersMocks.bulkChangeRole,
    deactivate: usersMocks.deactivate,
    reactivate: usersMocks.reactivate,
    deleteUser: usersMocks.deleteUser,
    getUserAudit: usersMocks.getUserAudit,
    createUser: usersMocks.createUser,
  };
});

import UsersAdminPage from "@/app/finance/users/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { UsersApiError, BulkPartialFailureError, type BackendUser, type UserAuditEntry } from "@/lib/api/users";

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

const AUDIT_ENTRIES: UserAuditEntry[] = [
  auditEntry({
    id: "a1",
    actorId: "u-mgr-1",
    action: "manager.change",
    entityId: "u-emp-1",
    before: { managerId: null },
    after: { managerId: "u-mgr-1" },
    createdAt: "2026-01-02T00:00:00Z",
  }),
  auditEntry(),
];

/* ----------------------------------------------------------------- helpers */

function seedFinance() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-fin-1", role: "finance", issuedAt: Date.now() })
  );
}

function renderPage() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["finance"]}>
            <UsersAdminPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

async function waitForReady(probe: RegExp) {
  await waitFor(() => expect(screen.getByText(probe)).toBeInTheDocument());
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getAllByText(name).find((el) => !!el.closest("tr"))!;
  return cell.closest("tr")!;
}

/**
 * Row-scoped presence check for a user. The signed-in Finance Admin's name
 * also renders in the AppShell menu, and manager names repeat in the Manager
 * column — so a bare `getByText`/`queryByText` is ambiguous. The per-row
 * "Select {name}" checkbox (#32) only exists for visible table rows.
 */
function queryRow(name: string): HTMLElement | null {
  return screen.queryByRole("checkbox", {
    name: new RegExp(`^select ${name}$`, "i"),
  });
}

/** Accessible name of the per-row Deactivate button (#43 now carries a
 *  "soft disable" disambiguator so screen readers don't confuse it with the
 *  destructive Delete action). */
const DEACTIVATE_NAME = /^deactivate .* \(soft disable\)$/i;

/** Open the custom `Select` and click the option whose label matches. */
async function pickOption(dialog: HTMLElement, selectLabel: RegExp, optionLabel: RegExp) {
  const trigger = within(dialog).getByLabelText(selectLabel);
  fireEvent.click(trigger);
  const listbox = await within(dialog).findByRole("listbox");
  const option = within(listbox).getByRole("option", { name: optionLabel });
  fireEvent.click(within(option).getByRole("button"));
}

/** Toggle a RolesMultiSelect chip (#53). Each chip carries an aria-label of
 *  "Label selected" / "Label not selected" from its aria-pressed state. */
function toggleRole(dialog: HTMLElement, roleLabel: string, currentlySelected: boolean) {
  const chip = within(dialog).getByRole("button", {
    name: new RegExp(`^${roleLabel} ${currentlySelected ? "selected" : "not selected"}$`, "i"),
  });
  fireEvent.click(chip);
}

beforeEach(() => {
  localStorage.clear();
  seedFinance();
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  navMocks.search = "";
  usersMocks.listUsers.mockReset();
  usersMocks.changeUserRole.mockReset();
  usersMocks.changeUserRoles.mockReset();
  usersMocks.setUserManager.mockReset();
  usersMocks.bulkChangeRole.mockReset();
  usersMocks.deactivate.mockReset();
  usersMocks.reactivate.mockReset();
  usersMocks.deleteUser.mockReset();
  usersMocks.getUserAudit.mockReset();
  usersMocks.createUser.mockReset();
  usersMocks.listUsers.mockResolvedValue(SEED_USERS);
  usersMocks.bulkChangeRole.mockResolvedValue(SEED_USERS);
  usersMocks.getUserAudit.mockResolvedValue(AUDIT_ENTRIES);
  usersMocks.createUser.mockResolvedValue({
    user: backendUser({
      id: "u-new-1",
      name: "Citra Lestari",
      email: "citra.lestari@spendflow.example",
      role: "approver",
      managerId: null,
      department: "Operations",
      status: "pending",
    }),
    invite: {
      token: "tok_secret",
      sentAt: TS,
      expiresAt: "2026-01-08T00:00:00Z",
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ================================================================ UI FLOWS == */

describe("User directory — list render", () => {
  it("shows all five columns for every user", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    for (const header of ["Name", "Email", "Role", "Manager", "Department"]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }

    // Seeded persona emails render verbatim (matches the BE seed).
    expect(screen.getByText("aulia.pratiwi@spendflow.example")).toBeInTheDocument();
    expect(screen.getByText("dewi.anggraeni@spendflow.example")).toBeInTheDocument();
    expect(screen.getByText("ridwan.saputra@spendflow.example")).toBeInTheDocument();

    // Role chips + manager names ("—" when none).
    expect(screen.getByText("Finance Admin")).toBeInTheDocument();
    // "Approver"/"Employee" also render as role-filter chips (#35), so the
    // RolePill label may match more than once.
    expect(screen.getAllByText("Approver").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Employee").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    // Department column populated ("Finance" also matches the role chip #35).
    expect(screen.getAllByText("Finance").length).toBeGreaterThan(0);
  });

  it("renders an empty state when the directory has no users", async () => {
    usersMocks.listUsers.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no users yet/i)).toBeInTheDocument();
  });

  it("renders every role as a chip for multi-role users (single-role rows keep one pill)", async () => {
    usersMocks.listUsers.mockResolvedValue([
      FINANCE,
      backendUser({
        id: "u-multi",
        name: "Hana Permata",
        email: "hana.permata@spendflow.example",
        role: "finance",
        roles: ["employee", "approver", "finance"],
        primaryRole: "finance",
        managerId: null,
      }),
    ]);
    renderPage();
    await waitForReady(/Hana Permata/);

    // All three roles render as a chip group in the row's Role column (#53).
    const row = rowFor("Hana Permata");
    for (const label of ["Employee", "Approver", "Finance Admin"]) {
      expect(within(row).getByText(label)).toBeInTheDocument();
    }
    // A legacy user without `roles` still renders exactly one pill (back-compat).
    expect(within(rowFor("Ridwan Saputra")).getAllByText("Finance Admin")).toHaveLength(1);
  });
});

describe("User directory — role change dialog", () => {
  it("changes a role, closes the dialog, and refreshes the list", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    fireEvent.click(within(rowFor("Aulia Pratiwi")).getByRole("button", { name: /change role/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /change role/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/their current role is/i)).toBeInTheDocument();

    // Chip multi-select (#53): Aulia starts as an employee-only row, so the
    // Employee chip is selected. Add Approver, then drop Employee → the submit
    // fires the multi-role changeUserRoles with exactly ["approver"].
    toggleRole(dialog, "Approver", false);
    toggleRole(dialog, "Employee", true);

    // #64: submit stays disabled until a re-auth password is typed.
    const submit = within(dialog).getByRole("button", { name: /change role/i });
    expect(submit).toBeDisabled();
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
    fireEvent.click(submit);

    await waitFor(() =>
      expect(usersMocks.changeUserRoles).toHaveBeenCalledWith(
        "u-emp-1",
        ["approver"],
        "active",
        "demo1234"
      )
    );
    // The list refreshes automatically after the mutation.
    await waitFor(() => expect(usersMocks.listUsers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("pre-fills the chips from a multi-role user and submits the full set", async () => {
    usersMocks.listUsers.mockResolvedValue([
      FINANCE,
      backendUser({
        id: "u-multi",
        name: "Hana Permata",
        email: "hana.permata@spendflow.example",
        role: "approver",
        roles: ["employee", "approver"],
        primaryRole: "approver",
        managerId: null,
      }),
    ]);
    renderPage();
    await waitForReady(/Hana Permata/);

    const row = rowFor("Hana Permata");
    fireEvent.click(within(row).getByRole("button", { name: /change role/i }));

    const dialog = await screen.findByRole("dialog");
    // Both held roles pre-checked as chips.
    expect(within(dialog).getByRole("button", { name: /^employee selected$/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(dialog).getByRole("button", { name: /^approver selected$/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(dialog).getByRole("button", { name: /^finance admin not selected$/i })).toBeInTheDocument();

    // Add finance → 3 roles submitted as one array.
    toggleRole(dialog, "Finance Admin", false);
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /change role/i }));

    await waitFor(() =>
      expect(usersMocks.changeUserRoles).toHaveBeenCalledWith(
        "u-multi",
        ["employee", "approver", "finance"],
        "active",
        "demo1234"
      )
    );
  });

  it("shows the BE's 401 message inline and keeps the dialog open on a wrong password", async () => {
    usersMocks.changeUserRoles.mockRejectedValue(
      new UsersApiError(401, "invalid_password", "Incorrect password")
    );
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    fireEvent.click(within(rowFor("Aulia Pratiwi")).getByRole("button", { name: /change role/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "wrong-password" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /change role/i }));

    // BE's message surfaces verbatim; dialog stays open as the retry.
    expect(await within(dialog).findByText(/incorrect password/i)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: /change role/i })
    ).toBeInTheDocument();
  });
});

describe("User directory — set manager dialog", () => {
  it("shows the current manager and lists only active approvers as candidates", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: /set manager/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/current manager:/i)).toHaveTextContent(/Dewi Anggraeni/);

    const trigger = within(dialog).getByLabelText(/manager/i);
    fireEvent.click(trigger);
    const listbox = await within(dialog).findByRole("listbox");

    // Only active approvers are candidates — the target themselves, finance
    // admins, and other employees never appear (#43 role guard).
    expect(
      within(listbox).queryByRole("option", { name: /Aulia Pratiwi/i })
    ).not.toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /Dewi Anggraeni/i })).toBeInTheDocument();
    expect(
      within(listbox).queryByRole("option", { name: /Ridwan Saputra/i })
    ).not.toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /no manager/i })).toBeInTheDocument();
  });

  it("assigns a manager, closes, and refreshes the list", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: /set manager/i }));
    const dialog = await screen.findByRole("dialog");

    await pickOption(dialog, /^manager/i, /Dewi Anggraeni/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /set manager/i }));

    await waitFor(() =>
      expect(usersMocks.setUserManager).toHaveBeenCalledWith("u-emp-1", "u-mgr-1")
    );
    await waitFor(() => expect(usersMocks.listUsers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("clears the manager by submitting the 'No manager' option as null", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: /set manager/i }));
    const dialog = await screen.findByRole("dialog");

    await pickOption(dialog, /^manager/i, /no manager/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /set manager/i }));

    await waitFor(() =>
      expect(usersMocks.setUserManager).toHaveBeenCalledWith("u-emp-1", null)
    );
  });

  it("surfaces a BE self_manager error inline and keeps the dialog open", async () => {
    usersMocks.setUserManager.mockRejectedValue(
      new UsersApiError(400, "self_manager", "A user cannot be their own manager"),
    );
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: /set manager/i }));
    const dialog = await screen.findByRole("dialog");

    await pickOption(dialog, /^manager/i, /Dewi Anggraeni/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /set manager/i }));

    expect(
      await within(dialog).findByText(/cannot be their own manager/i)
    ).toBeInTheDocument();
    // Dialog stays open (no silent close on failure) — the save button is the retry.
    expect(within(dialog).getByRole("heading", { name: /set manager/i })).toBeInTheDocument();
  });

  it("surfaces a BE cycle error inline", async () => {
    usersMocks.setUserManager.mockRejectedValue(
      new UsersApiError(400, "cycle", "Setting that manager would create a circular reporting line"),
    );
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: /set manager/i }));
    const dialog = await screen.findByRole("dialog");

    await pickOption(dialog, /^manager/i, /Dewi Anggraeni/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /set manager/i }));

    expect(await within(dialog).findByText(/circular reporting line/i)).toBeInTheDocument();
  });
});

describe("Set manager — role guard + candidate filter", () => {
  const APPROVER_DISABLED = backendUser({
    id: "u-app-dis",
    name: "Eka Wahyuni",
    email: "eka.wahyuni@spendflow.example",
    role: "approver",
    managerId: null,
    status: "disabled",
  });
  const APPROVER_PENDING = backendUser({
    id: "u-app-pend",
    name: "Fajar Nugraha",
    email: "fajar.nugraha@spendflow.example",
    role: "approver",
    managerId: null,
    status: "pending",
  });
  const EMPLOYEE_OTHER = backendUser({
    id: "u-emp-2",
    name: "Budi Santoso",
    email: "budi.santoso@spendflow.example",
    role: "employee",
    managerId: null,
  });

  async function openSetManager(name: string) {
    const row = rowFor(name);
    fireEvent.click(within(row).getByRole("button", { name: /set manager/i }));
    return screen.findByRole("dialog");
  }

  it("lists only active approvers — no employees, finance admins, pending, disabled, or self", async () => {
    usersMocks.listUsers.mockResolvedValue([
      FINANCE,
      MANAGER,
      APPROVER_DISABLED,
      APPROVER_PENDING,
      EMPLOYEE_OTHER,
      backendUser(), // target: Aulia (employee)
    ]);
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const dialog = await openSetManager("Aulia Pratiwi");
    const trigger = within(dialog).getByLabelText(/manager/i);
    fireEvent.click(trigger);
    const listbox = await within(dialog).findByRole("listbox");

    // Only the single active approver (Dewi) is a candidate.
    expect(
      within(listbox).getByRole("option", { name: /Dewi Anggraeni/i })
    ).toBeInTheDocument();
    // Self
    expect(
      within(listbox).queryByRole("option", { name: /Aulia Pratiwi/i })
    ).not.toBeInTheDocument();
    // Other employee
    expect(
      within(listbox).queryByRole("option", { name: /Budi Santoso/i })
    ).not.toBeInTheDocument();
    // Finance admin
    expect(
      within(listbox).queryByRole("option", { name: /Ridwan Saputra/i })
    ).not.toBeInTheDocument();
    // Disabled approver
    expect(
      within(listbox).queryByRole("option", { name: /Eka Wahyuni/i })
    ).not.toBeInTheDocument();
    // Pending approver
    expect(
      within(listbox).queryByRole("option", { name: /Fajar Nugraha/i })
    ).not.toBeInTheDocument();
  });

  it("renders an inline empty state when no active approvers exist", async () => {
    usersMocks.listUsers.mockResolvedValue([
      FINANCE,
      APPROVER_DISABLED,
      APPROVER_PENDING,
      backendUser(), // target: Aulia (employee)
    ]);
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const dialog = await openSetManager("Aulia Pratiwi");
    expect(
      within(dialog).getByText(/no active approvers available/i)
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/add an approver user first/i)).toBeInTheDocument();
    // No manager picker is rendered when there are no candidates.
    expect(within(dialog).queryByLabelText(/^manager/i)).not.toBeInTheDocument();
  });

  it("hides the 'Set manager' button on approver and finance admin rows", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    // Seeded approver (dewi.anggraeni@spendflow.example) — no button.
    expect(
      within(rowFor("Dewi Anggraeni")).queryByRole("button", { name: /set manager/i })
    ).not.toBeInTheDocument();
    // Seeded finance admin (ridwan.saputra@spendflow.example) — no button.
    expect(
      within(rowFor("Ridwan Saputra")).queryByRole("button", { name: /set manager/i })
    ).not.toBeInTheDocument();
    // Employee rows keep the button.
    expect(
      within(rowFor("Aulia Pratiwi")).getByRole("button", { name: /set manager/i })
    ).toBeInTheDocument();
  });

  it("surfaces the BE's 400 invalid_manager message verbatim", async () => {
    usersMocks.setUserManager.mockRejectedValue(
      new UsersApiError(
        400,
        "invalid_manager",
        "Manager must be an Approver; user has role employee"
      )
    );
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const dialog = await openSetManager("Aulia Pratiwi");
    await pickOption(dialog, /^manager/i, /Dewi Anggraeni/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /set manager/i }));

    expect(
      await within(dialog).findByText(/manager must be an approver; user has role employee/i)
    ).toBeInTheDocument();
    // Dialog stays open (save button is the retry).
    expect(within(dialog).getByRole("heading", { name: /set manager/i })).toBeInTheDocument();
  });
});

/* ------------------------------------------- status chip + deactivate (#33) */

describe("User directory — status chip + deactivate/reactivate", () => {
  it("renders a green Active chip for active users and a grey Inactive chip for disabled users", async () => {
    usersMocks.listUsers.mockResolvedValue([
      FINANCE,
      backendUser(),
      backendUser({
        id: "u-dis",
        name: "Gadis Purnama",
        email: "gadis.purnama@spendflow.example",
        role: "employee",
        status: "disabled",
      }),
    ]);
    renderPage();
    await waitForReady(/Gadis Purnama/);

    const activeChip = within(rowFor("Aulia Pratiwi")).getByText("Active");
    expect(activeChip.className).toMatch(/bg-success-container/);

    const disabledChip = within(rowFor("Gadis Purnama")).getByText("Inactive");
    expect(disabledChip.className).toMatch(/bg-surface-container-high/);
  });

  it("deactivates a user with a verb-named confirm, flips the chip, and toasts", async () => {
    usersMocks.deactivate.mockResolvedValue(backendUser({ status: "disabled" }));
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: DEACTIVATE_NAME }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /deactivate aulia pratiwi/i })
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/can no longer sign in/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/claims and approvals are preserved/i)).toBeInTheDocument();
    // Optional free-text reason is captured (not sent to the BE yet).
    expect(within(dialog).getByLabelText(/reason \(optional\)/i)).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /deactivate aulia pratiwi/i })
    );

    await waitFor(() => expect(usersMocks.deactivate).toHaveBeenCalledWith("u-emp-1"));
    // Success → dialog closes + success toast.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/aulia pratiwi deactivated/i)).toBeInTheDocument();
    // The optimistic chip stays flipped WITHOUT a directory re-read.
    await waitFor(() =>
      expect(within(rowFor("Aulia Pratiwi")).getByText("Inactive")).toBeInTheDocument()
    );
    expect(usersMocks.listUsers).toHaveBeenCalledTimes(1);
  });

  it("shows a Reactivate button for a disabled user and reactivates on confirm", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, backendUser({ status: "disabled" })]);
    usersMocks.reactivate.mockResolvedValue(backendUser({ status: "active" }));
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    expect(within(row).getByRole("button", { name: /^reactivate$/i })).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: DEACTIVATE_NAME })
    ).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: /^reactivate$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /reactivate aulia pratiwi/i })
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/can sign in again/i)).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /reactivate aulia pratiwi/i })
    );

    await waitFor(() => expect(usersMocks.reactivate).toHaveBeenCalledWith("u-emp-1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/aulia pratiwi reactivated/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(rowFor("Aulia Pratiwi")).getByText("Active")).toBeInTheDocument()
    );
  });

  it("disables Deactivate for the signed-in user (self-protection)", async () => {
    renderPage();
    await waitForReady(/Ridwan Saputra/);

    const row = rowFor("Ridwan Saputra"); // u-fin-1 = the current session
    expect(within(row).getByRole("button", { name: DEACTIVATE_NAME })).toBeDisabled();
  });

  it("disables Deactivate when the target is the only active finance admin", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, backendUser()]);
    renderPage();
    await waitForReady(/Ridwan Saputra/);

    expect(
      within(rowFor("Ridwan Saputra")).getByRole("button", { name: DEACTIVATE_NAME })
    ).toBeDisabled();
  });

  it("allows deactivating a finance user when another active finance admin exists", async () => {
    usersMocks.listUsers.mockResolvedValue([
      FINANCE,
      backendUser({
        id: "u-fin-2",
        name: "Candra Wijaya",
        email: "candra.wijaya@spendflow.example",
        role: "finance",
        managerId: null,
      }),
      backendUser(),
    ]);
    renderPage();
    await waitForReady(/Candra Wijaya/);

    expect(
      within(rowFor("Candra Wijaya")).getByRole("button", { name: DEACTIVATE_NAME })
    ).toBeEnabled();
  });

  it("keeps the dialog open, surfaces the BE error inline, and rolls the chip back", async () => {
    usersMocks.deactivate.mockRejectedValue(
      new UsersApiError(
        400,
        "cannot_deactivate_last_finance",
        "Cannot deactivate the last Finance Admin"
      )
    );
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: DEACTIVATE_NAME }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /deactivate aulia pratiwi/i }));

    // Inline BE error + dialog stays open (save button is the retry).
    expect(
      await within(dialog).findByText(/cannot deactivate the last finance admin/i)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: /deactivate aulia pratiwi/i })
    ).toBeInTheDocument();
    // Chip rolled back to Active after the failure.
    await waitFor(() =>
      expect(within(rowFor("Aulia Pratiwi")).getByText("Active")).toBeInTheDocument()
    );
  });
});

/* --------------------------------------------------- delete user (#43) ===== */

describe("User directory — hard delete + password re-auth", () => {
  const PENDING = backendUser({
    id: "u-pend-1",
    name: "Budi Santoso",
    email: "budi.santoso@spendflow.example",
    role: "employee",
    status: "pending",
  });
  const DISABLED = backendUser({
    id: "u-dis-1",
    name: "Gadis Purnama",
    email: "gadis.purnama@spendflow.example",
    role: "employee",
    status: "disabled",
  });

  function deleteButton(name: string): HTMLElement {
    return within(rowFor(name)).getByRole("button", {
      name: new RegExp(`^delete ${name} permanently$`, "i"),
    });
  }

  async function openDeleteDialog(name: string) {
    fireEvent.click(deleteButton(name));
    return screen.findByRole("alertdialog");
  }

  async function submitDelete(dialog: HTMLElement, password: string) {
    fireEvent.change(within(dialog).getByLabelText(/re-enter your password to confirm/i), {
      target: { value: password },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /delete permanently/i }));
  }

  it("opens the dialog with the removal list + guard text when Delete is clicked on a pending row", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, MANAGER, PENDING, DISABLED]);
    renderPage();
    await waitForReady(/Budi Santoso/);

    const dialog = await openDeleteDialog("Budi Santoso");
    expect(
      within(dialog).getByRole("heading", { name: /delete budi santoso\?/i })
    ).toBeInTheDocument();
    // Removal list.
    expect(within(dialog).getByText(/user account \+ login credentials/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/pending invitations/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/active sessions/i)).toBeInTheDocument();
    // Plain-English guard.
    expect(
      within(dialog).getByText(/only available for pending or deactivated users/i)
    ).toBeInTheDocument();
    // Password field + verb-named submit (disabled until a password is typed).
    expect(
      within(dialog).getByLabelText(/re-enter your password to confirm/i)
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /delete permanently/i })).toBeDisabled();
  });

  it("opens the same dialog for a disabled row", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, MANAGER, PENDING, DISABLED]);
    renderPage();
    await waitForReady(/Gadis Purnama/);

    const dialog = await openDeleteDialog("Gadis Purnama");
    expect(
      within(dialog).getByRole("heading", { name: /delete gadis purnama\?/i })
    ).toBeInTheDocument();
  });

  it("wrong password → inline error, dialog stays open, password field cleared", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, MANAGER, PENDING]);
    usersMocks.deleteUser.mockRejectedValue(
      new UsersApiError(401, "invalid_password", "Invalid password")
    );
    renderPage();
    await waitForReady(/Budi Santoso/);

    const dialog = await openDeleteDialog("Budi Santoso");
    await submitDelete(dialog, "wrong-pass");

    expect(
      await within(dialog).findByText(/incorrect password/i)
    ).toBeInTheDocument();
    // Dialog stays open (no silent close on failure).
    expect(
      within(dialog).getByRole("heading", { name: /delete budi santoso\?/i })
    ).toBeInTheDocument();
    // Password cleared for the retry.
    expect(
      within(dialog).getByLabelText(/re-enter your password to confirm/i)
    ).toHaveValue("");
    expect(usersMocks.deleteUser).toHaveBeenCalledWith("u-pend-1", "wrong-pass");
  });

  it("correct password → dialog closes, row disappears, toast, no refetch", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, MANAGER, PENDING]);
    usersMocks.deleteUser.mockResolvedValue(undefined);
    renderPage();
    await waitForReady(/Budi Santoso/);

    const dialog = await openDeleteDialog("Budi Santoso");
    await submitDelete(dialog, "right-pass");

    await waitFor(() =>
      expect(usersMocks.deleteUser).toHaveBeenCalledWith("u-pend-1", "right-pass")
    );
    // Success → dialog closes + success toast + row removed from the table.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/budi santoso deleted permanently/i)).toBeInTheDocument();
    await waitFor(() => expect(queryRow("Budi Santoso")).toBeNull());
    expect(usersMocks.listUsers).toHaveBeenCalledTimes(1);
  });

  it("Delete is disabled with a tooltip on active rows but enabled on pending rows", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, MANAGER, PENDING]);
    renderPage();
    await waitForReady(/Budi Santoso/);

    const activeDelete = deleteButton("Ridwan Saputra");
    expect(activeDelete).toBeDisabled();
    expect(activeDelete.closest("span")).toHaveAttribute(
      "title",
      "Activate the user first to use this"
    );

    expect(deleteButton("Budi Santoso")).toBeEnabled();
  });

  it("Deactivate uses the error tone while Reactivate stays on the primary text color", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, DISABLED, backendUser()]);
    renderPage();
    await waitForReady(/Gadis Purnama/);

    const deactivate = within(rowFor("Aulia Pratiwi")).getByRole("button", {
      name: DEACTIVATE_NAME,
    });
    expect(deactivate.className).toMatch(/text-error/);
    // Destructive-soft text button — NOT the filled-danger style (which uses
    // `text-error-container` as its foreground + a solid `bg-error`).
    expect(deactivate.className).not.toMatch(/text-error-container/);
    expect(deactivate.className).toMatch(/hover:bg-error\/10/);

    // Delete (on a non-active row) is heavier than Deactivate — the filled-danger
    // variant uses `bg-error ` (with a trailing space, solid background) + `text-error-container`,
    // which visually distinguishes "permanent delete" from "soft disable".
    const deleteBtn = deleteButton("Gadis Purnama");
    expect(deleteBtn.className).toMatch(/bg-error /); // trailing space — not "bg-error/10"
    expect(deleteBtn.className).toMatch(/text-error-container/);
    // ...and Deactivate does NOT match the danger variant (it has text-error but no solid bg-error fill,
    // only the hover:bg-error/10 tint) — confirms the visual distinction.
    expect(deactivate.className).not.toMatch(/bg-error /);

    const reactivate = within(rowFor("Gadis Purnama")).getByRole("button", {
      name: /^reactivate$/i,
    });
    expect(reactivate.className).toMatch(/text-primary/);
    expect(reactivate.className).not.toMatch(/text-error/);
  });

  it("surfaces a 409 as an inline error suggesting deactivation first", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, MANAGER, PENDING]);
    usersMocks.deleteUser.mockRejectedValue(
      new UsersApiError(
        409,
        "cannot_delete_active_user",
        "Active users cannot be deleted"
      )
    );
    renderPage();
    await waitForReady(/Budi Santoso/);

    const dialog = await openDeleteDialog("Budi Santoso");
    await submitDelete(dialog, "right-pass");

    expect(
      await within(dialog).findByText(/deactivate them first, then try again/i)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: /delete budi santoso\?/i })
    ).toBeInTheDocument();
  });

  it("Esc closes the dialog without submitting (password never sent)", async () => {
    usersMocks.listUsers.mockResolvedValue([FINANCE, MANAGER, PENDING]);
    renderPage();
    await waitForReady(/Budi Santoso/);

    const dialog = await openDeleteDialog("Budi Santoso");
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "secret" } }
    );
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // The delete was never fired — Esc only closes.
    expect(usersMocks.deleteUser).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------- bulk role change (#32) */

describe("User directory — bulk role change", () => {
  it("disables the bulk button until 2+ users are selected", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const button = screen.getByRole("button", { name: /bulk change role/i });
    expect(button).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /select aulia pratiwi/i }));
    expect(
      screen.getByRole("button", { name: /bulk change role \(1\)/i })
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /select ridwan saputra/i }));
    expect(
      screen.getByRole("button", { name: /bulk change role \(2\)/i })
    ).toBeEnabled();
  });

  it("changes all selected users, closes the dialog, toasts, and clears selection", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    // Select all visible rows via the header checkbox.
    fireEvent.click(screen.getByRole("checkbox", { name: /select all users/i }));
    fireEvent.click(screen.getByRole("button", { name: /bulk change role \(3\)/i }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /bulk change role/i })
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/change the role of 3 selected users/i)
    ).toBeInTheDocument();

    await pickOption(dialog, /new role/i, /approver/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /change role for 3 users/i }));

    await waitFor(() =>
      expect(usersMocks.bulkChangeRole).toHaveBeenCalledWith(
        expect.arrayContaining(["u-fin-1", "u-mgr-1", "u-emp-1"]),
        "approver"
      )
    );
    // Success → dialog closes + success toast + list refreshed.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/3 users changed to approver/i)).toBeInTheDocument();
    await waitFor(() => expect(usersMocks.listUsers).toHaveBeenCalledTimes(2));

    // Selection cleared after the successful action.
    expect(screen.getByRole("button", { name: /^bulk change role$/i })).toBeDisabled();
  });

  it("keeps the dialog open and shows failing ids on a partial failure", async () => {
    usersMocks.bulkChangeRole.mockRejectedValue(
      new BulkPartialFailureError(
        [
          {
            userId: "u-mgr-1",
            error: new UsersApiError(404, "not_found", "User gone"),
          },
        ],
        2,
        3
      )
    );
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    fireEvent.click(screen.getByRole("checkbox", { name: /select all users/i }));
    fireEvent.click(screen.getByRole("button", { name: /bulk change role \(3\)/i }));
    const dialog = await screen.findByRole("dialog");

    await pickOption(dialog, /new role/i, /approver/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /change role for 3 users/i }));

    expect(
      await within(dialog).findByText(/1 of 3 users could not be updated/i)
    ).toBeInTheDocument();
    expect(within(dialog).getByText("u-mgr-1")).toBeInTheDocument();
    expect(within(dialog).getByText(/user gone/i)).toBeInTheDocument();
    // Dialog stays open (no silent close on failure).
    expect(
      within(dialog).getByRole("heading", { name: /bulk change role/i })
    ).toBeInTheDocument();
  });
});

/* --------------------------------------------------- search + role filter (#35) */

describe("User directory — search + role filter", () => {
  /** The role-filter chip row (there are two tablists on the page). */
  function roleTab(name: string): HTMLElement {
    const list = screen.getByRole("tablist", { name: /filter users by role/i });
    return within(list).getByRole("tab", { name: new RegExp(name, "i") });
  }

  function searchInput(): HTMLElement {
    return screen.getByLabelText(/search users/i);
  }

  /** Last URL written via router.replace (report-style inspection). */
  function lastReplacedUrl(): string {
    const calls = navMocks.replace.mock.calls;
    return calls[calls.length - 1][0] as string;
  }

  it("filters by name substring after the 200ms debounce (no instant filter)", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    fireEvent.change(searchInput(), { target: { value: "Aulia" } });

    // Debounce: the table must NOT re-filter on the keystroke itself.
    expect(queryRow("Ridwan Saputra")).not.toBeNull();
    expect(queryRow("Dewi Anggraeni")).not.toBeNull();

    // ~200ms later the filter applies.
    await waitFor(() => {
      expect(queryRow("Ridwan Saputra")).toBeNull();
      expect(queryRow("Dewi Anggraeni")).toBeNull();
    });
    expect(queryRow("Aulia Pratiwi")).not.toBeNull();
  });

  it("filters by email substring (case-insensitive)", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    fireEvent.change(searchInput(), {
      target: { value: "RIDWAN.SAPUTRA" },
    });

    await waitFor(() => {
      expect(queryRow("Aulia Pratiwi")).toBeNull();
      expect(queryRow("Dewi Anggraeni")).toBeNull();
    });
    expect(queryRow("Ridwan Saputra")).not.toBeNull();
  });

  it("role chip filters by a single role; All restores everyone", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    fireEvent.click(roleTab("Finance"));
    expect(roleTab("Finance")).toHaveAttribute("aria-selected", "true");
    expect(queryRow("Ridwan Saputra")).not.toBeNull();
    expect(queryRow("Aulia Pratiwi")).toBeNull();
    expect(queryRow("Dewi Anggraeni")).toBeNull();

    fireEvent.click(roleTab("All"));
    expect(roleTab("All")).toHaveAttribute("aria-selected", "true");
    expect(queryRow("Aulia Pratiwi")).not.toBeNull();
    expect(queryRow("Dewi Anggraeni")).not.toBeNull();
  });

  it("composes search + role with AND semantics", async () => {
    // A second finance user whose name/email does NOT contain "a" — so a
    // finance-only role filter alone is not enough to prove composition.
    const RIZKY = backendUser({
      id: "u-fin-2",
      name: "Rizky Hakim",
      email: "rizky.hakim@spendflow.example",
      role: "finance",
      managerId: null,
      department: "Finance",
    });
    usersMocks.listUsers.mockResolvedValue([FINANCE, RIZKY, MANAGER, backendUser()]);
    renderPage();
    await waitForReady(/Rizky Hakim/);

    fireEvent.click(roleTab("Finance"));
    fireEvent.change(searchInput(), { target: { value: "ridwan" } });

    // AND: Ridwan matches the query AND the role; Rizky passes the role but
    // fails the query; Aulia (employee) and Dewi (approver) fail the role.
    await waitFor(() => {
      expect(queryRow("Ridwan Saputra")).not.toBeNull();
      expect(queryRow("Rizky Hakim")).toBeNull();
      expect(queryRow("Aulia Pratiwi")).toBeNull();
      expect(queryRow("Dewi Anggraeni")).toBeNull();
    });
  });

  it("shows an empty state with a working Clear filters action", async () => {
    // Seed a URL combo that matches nobody so "Clear filters" can also be
    // observed clearing the query string (the mock never updates it itself).
    navMocks.search = "q=zzzz-no-match&role=finance";
    renderPage();

    expect(await screen.findByText(/no matching users/i)).toBeInTheDocument();
    expect(queryRow("Ridwan Saputra")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /clear filters/i })[0]);

    await waitFor(() => expect(queryRow("Aulia Pratiwi")).not.toBeNull());
    expect(queryRow("Ridwan Saputra")).not.toBeNull();
    expect(queryRow("Dewi Anggraeni")).not.toBeNull();
    expect(searchInput()).toHaveValue("");
    await waitFor(() =>
      expect(navMocks.replace).toHaveBeenCalledWith("/finance/users", { scroll: false })
    );
  });

  it("seeds filters from the URL query string on first render", async () => {
    navMocks.search = "q=ridwan&role=finance";
    renderPage();

    // Ridwan also renders in the AppShell menu, so wait on the seeded input.
    await waitFor(() => expect(searchInput()).toHaveValue("ridwan"));
    expect(queryRow("Aulia Pratiwi")).toBeNull();
    expect(queryRow("Dewi Anggraeni")).toBeNull();
    expect(roleTab("Finance")).toHaveAttribute("aria-selected", "true");
    expect(roleTab("All")).toHaveAttribute("aria-selected", "false");
  });

  it("mirrors filter changes into the URL after the debounce", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    fireEvent.change(searchInput(), { target: { value: "ridwan" } });
    await waitFor(() =>
      expect(lastReplacedUrl()).toBe("/finance/users?q=ridwan")
    );

    fireEvent.click(roleTab("Finance"));
    await waitFor(() =>
      expect(lastReplacedUrl()).toBe("/finance/users?q=ridwan&role=finance")
    );
  });

  it("renders the All chip selected and no filter for an invalid ?role value", async () => {
    navMocks.search = "role=admin";
    renderPage();

    await waitForReady(/Aulia Pratiwi/);
    expect(roleTab("All")).toHaveAttribute("aria-selected", "true");
    expect(roleTab("Finance")).toHaveAttribute("aria-selected", "false");
    // No user is filtered out by the bogus role.
    expect(queryRow("Ridwan Saputra")).not.toBeNull();
    expect(queryRow("Dewi Anggraeni")).not.toBeNull();
    expect(searchInput()).toHaveValue("");
  });
});

/* ---------------------------------------------------- forced-403 (denied) === */

describe("User directory — 403 access denied", () => {
  it("a 403 on the initial list load renders the denied panel", async () => {
    usersMocks.listUsers.mockRejectedValue(
      new UsersApiError(403, "forbidden", "Finance admins only."),
    );
    renderPage();

    expect(
      await screen.findByText(/not authorized to manage users/i)
    ).toBeInTheDocument();
  });

  it("a 403 on a mutation renders the denied panel", async () => {
    usersMocks.changeUserRoles.mockRejectedValue(
      new UsersApiError(403, "forbidden", "Finance admins only."),
    );
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: /change role/i }));
    const dialog = await screen.findByRole("dialog");
    toggleRole(dialog, "Approver", false);
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /change role/i }));

    expect(
      await screen.findByText(/not authorized to manage users/i)
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------ error + retry path == */

describe("User directory — error + retry", () => {
  it("shows an error panel with a working Retry button", async () => {
    usersMocks.listUsers
      .mockRejectedValueOnce(new Error("Backend is unreachable."))
      .mockResolvedValueOnce(SEED_USERS);
    renderPage();

    expect(await screen.findByText(/couldn't load the user directory/i)).toBeInTheDocument();
    expect(screen.getByText(/backend is unreachable/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitForReady(/Aulia Pratiwi/);
    expect(usersMocks.listUsers).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------ cross-role access control */

describe("User directory — cross-role access denied", () => {
  it("redirects a non-Finance (Employee) session away from the page", async () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ userId: "u-emp-1", role: "employee", issuedAt: Date.now() })
    );
    renderPage();

    await waitFor(() => expect(navMocks.replace).toHaveBeenCalledWith("/employee"));
    expect(screen.queryByText("User directory")).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------- recent activity (#34) == */

describe("User directory — recent activity", () => {
  async function expandActivity() {
    const toggle = screen.getByRole("button", { name: /recent activity/i });
    fireEvent.click(toggle);
    return toggle;
  }

  it("is collapsed by default and defers the audit fetch until expanded", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const toggle = screen.getByRole("button", { name: /recent activity/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // No fan-out on the common path.
    expect(usersMocks.getUserAudit).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: /recent activity/i })).not.toBeInTheDocument();
  });

  it("expanding fetches the audit and renders action label + actor + target", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    await expandActivity();

    await waitFor(() =>
      expect(usersMocks.getUserAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50,
          userIds: expect.arrayContaining(["u-fin-1", "u-mgr-1", "u-emp-1"]),
        })
      )
    );

    const region = await screen.findByRole("region", { name: /recent activity/i });
    expect(within(region).getByText("Role change")).toBeInTheDocument();
    expect(within(region).getByText("Manager change")).toBeInTheDocument();
    // Actor name + email resolved from the directory.
    expect(within(region).getByText("Ridwan Saputra")).toBeInTheDocument();
    expect(
      within(region).getByText(/ridwan\.saputra@spendflow\.example/)
    ).toBeInTheDocument();
    // Target user name.
    expect(within(region).getAllByText("Aulia Pratiwi").length).toBeGreaterThan(0);
  });

  it("shows a Refresh button that re-reads the audit", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    await expandActivity();

    await waitFor(() => expect(usersMocks.getUserAudit).toHaveBeenCalledTimes(1));
    const refresh = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(refresh);

    await waitFor(() => expect(usersMocks.getUserAudit).toHaveBeenCalledTimes(2));
  });

  it("shows an empty state when the directory has no admin actions", async () => {
    usersMocks.getUserAudit.mockResolvedValue([]);
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    await expandActivity();

    expect(await screen.findByText(/no admin activity yet/i)).toBeInTheDocument();
  });

  it("surfaces an error with a working retry when the audit fetch fails", async () => {
    usersMocks.getUserAudit
      .mockRejectedValueOnce(new UsersApiError(0, "audit_unavailable", "Backend exploded."))
      .mockResolvedValueOnce(AUDIT_ENTRIES);
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    await expandActivity();

    expect(await screen.findByText(/couldn't load recent activity/i)).toBeInTheDocument();
    expect(screen.getByText(/backend exploded/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("Role change")).toBeInTheDocument());
    expect(usersMocks.getUserAudit).toHaveBeenCalledTimes(2);
  });

  it("toggles the before/after JSON on click", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    await expandActivity();

    const region = await screen.findByRole("region", { name: /recent activity/i });
    expect(within(region).queryByText(/"role": "employee"/)).not.toBeInTheDocument();

    const roleChangeRow = within(region).getByText("Role change").closest("li")!;
    const show = within(roleChangeRow).getByRole("button", { name: /show changes/i });
    fireEvent.click(show);

    expect(within(region).getByText(/"role": "employee"/)).toBeInTheDocument();
    expect(within(region).getByText(/"role": "approver"/)).toBeInTheDocument();

    fireEvent.click(within(region).getByRole("button", { name: /hide changes/i }));
    expect(within(region).queryByText(/"role": "employee"/)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------ add user dialog (#36) */

describe("User directory — Add User dialog", () => {
  async function openAddDialog() {
    fireEvent.click(screen.getByRole("button", { name: /^add user$/i }));
    return screen.findByRole("dialog");
  }

  it("opens the dialog with the expected fields and help text", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const add = screen.getByRole("button", { name: /^add user$/i });
    expect(add).toBeEnabled();

    const dialog = await openAddDialog();
    expect(within(dialog).getByRole("heading", { name: /add a user/i })).toBeInTheDocument();
    expect(
      within(dialog).getByText(/we'll send an invitation email/i)
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/set a password before signing in/i)).toBeInTheDocument();
    for (const label of [/email/i, /name/i, /role/i, /manager/i, /department/i, /job title/i]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    expect(within(dialog).getByRole("button", { name: /send invite/i })).toBeEnabled();
  });

  it("creates the user, closes the dialog, toasts, and shows the pending row", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    const dialog = await openAddDialog();

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: "citra.lestari@spendflow.example" },
    });
    fireEvent.change(within(dialog).getByLabelText(/name/i), {
      target: { value: "Citra Lestari" },
    });
    // Chip multi-select (#53): default is employee; swap it for approver.
    toggleRole(dialog, "Approver", false);
    toggleRole(dialog, "Employee", true);
    fireEvent.click(within(dialog).getByRole("button", { name: /send invite/i }));

    await waitFor(() =>
      expect(usersMocks.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "citra.lestari@spendflow.example",
          name: "Citra Lestari",
          roles: ["approver"],
        })
      )
    );
    // The legacy single-role `role` field is no longer sent (#53).
    expect(usersMocks.createUser.mock.calls[0][0]).not.toHaveProperty("role");

    // Success → dialog closes + success toast.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/invitation sent to citra\.lestari@spendflow\.example/i)).toBeInTheDocument();

    // The new user row appears (prepended to the cache, no refetch) with a
    // Pending status chip.
    await waitFor(() => expect(queryRow("Citra Lestari")).not.toBeNull());
    expect(within(rowFor("Citra Lestari")).getByText("Pending")).toBeInTheDocument();
    expect(usersMocks.listUsers).toHaveBeenCalledTimes(1);
  });

  it("defaults to the employee role when no chips are toggled", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    const dialog = await openAddDialog();

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: "citra.lestari@spendflow.example" },
    });
    fireEvent.change(within(dialog).getByLabelText(/name/i), {
      target: { value: "Citra Lestari" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /send invite/i }));

    await waitFor(() =>
      expect(usersMocks.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ roles: ["employee"] })
      )
    );
    expect(usersMocks.createUser.mock.calls[0][0]).not.toHaveProperty("role");
  });

  it("derives the primaryRole preview as chips are toggled (#53)", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    const dialog = await openAddDialog();

    // Single role: no primary-role dropdown is shown yet.
    expect(within(dialog).queryByLabelText(/primary role/i)).not.toBeInTheDocument();

    // Approver on → 2 roles → dropdown appears, derived to the highest
    // privilege so far (approver).
    toggleRole(dialog, "Approver", false);
    expect(
      within(dialog).getByLabelText(/primary role/i)
    ).toHaveTextContent("Approver");

    // Finance on → derived primary bumps to Finance Admin.
    toggleRole(dialog, "Finance Admin", false);
    expect(
      within(dialog).getByLabelText(/primary role/i)
    ).toHaveTextContent("Finance Admin");

    // Dropping finance reverts to the next-highest (approver).
    toggleRole(dialog, "Finance Admin", true);
    expect(
      within(dialog).getByLabelText(/primary role/i)
    ).toHaveTextContent("Approver");
  });

  it("accepts a multi-role selection and submits the full roles array", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    const dialog = await openAddDialog();

    // Default: only the employee chip is checked.
    expect(
      within(dialog).getByRole("button", { name: /^employee selected$/i })
    ).toHaveAttribute("aria-pressed", "true");

    toggleRole(dialog, "Approver", false);
    toggleRole(dialog, "Finance Admin", false);

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: "citra.lestari@spendflow.example" },
    });
    fireEvent.change(within(dialog).getByLabelText(/name/i), {
      target: { value: "Citra Lestari" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /send invite/i }));

    await waitFor(() =>
      expect(usersMocks.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "citra.lestari@spendflow.example",
          name: "Citra Lestari",
          roles: ["employee", "approver", "finance"],
        })
      )
    );
    expect(usersMocks.createUser.mock.calls[0][0]).not.toHaveProperty("role");
  });

  it("surfaces a BE 409 email_exists inline and keeps the dialog open", async () => {
    usersMocks.createUser.mockRejectedValue(
      new UsersApiError(
        409,
        "email_exists",
        "A user with email citra.lestari@spendflow.example already exists"
      )
    );
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    const dialog = await openAddDialog();

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: "citra.lestari@spendflow.example" },
    });
    fireEvent.change(within(dialog).getByLabelText(/name/i), {
      target: { value: "Citra Lestari" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /send invite/i }));

    expect(
      await within(dialog).findByText(/citra\.lestari@spendflow\.example already exists/i)
    ).toBeInTheDocument();
    // Dialog stays open (no silent close on failure) — Send invite is the retry.
    expect(within(dialog).getByRole("heading", { name: /add a user/i })).toBeInTheDocument();
    // No new row was prepended.
    expect(queryRow("Citra Lestari")).toBeNull();
  });

  it("blocks a malformed email client-side without calling the API", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    const dialog = await openAddDialog();

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: "not-an-email" },
    });
    fireEvent.change(within(dialog).getByLabelText(/name/i), {
      target: { value: "Citra Lestari" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /send invite/i }));

    expect(await within(dialog).findByText(/enter a valid work email address/i)).toBeInTheDocument();
    expect(usersMocks.createUser).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("heading", { name: /add a user/i })).toBeInTheDocument();
  });

  it("requires a name before submitting", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    const dialog = await openAddDialog();

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: "citra.lestari@spendflow.example" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /send invite/i }));

    expect(await within(dialog).findByText(/enter the user's name/i)).toBeInTheDocument();
    expect(usersMocks.createUser).not.toHaveBeenCalled();
  });
});

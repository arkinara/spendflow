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
 * #30: `/finance/users` reads/writes exclusively through `@/lib/api/users`.
 * Mock that module so the page is fed controlled `BackendUser` fixtures (the
 * seeded persona set from `backend/src/db/seed.ts`) and mutators can be
 * asserted on directly.
 */
const usersMocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  changeUserRole: vi.fn(),
  setUserManager: vi.fn(),
}));

vi.mock("@/lib/api/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/users")>();
  return {
    ...actual,
    UsersApiError: actual.UsersApiError,
    listUsers: usersMocks.listUsers,
    changeUserRole: usersMocks.changeUserRole,
    setUserManager: usersMocks.setUserManager,
  };
});

import UsersAdminPage from "@/app/finance/users/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { UsersApiError, type BackendUser } from "@/lib/api/users";

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

/** Open the custom `Select` and click the option whose label matches. */
async function pickOption(dialog: HTMLElement, selectLabel: RegExp, optionLabel: RegExp) {
  const trigger = within(dialog).getByLabelText(selectLabel);
  fireEvent.click(trigger);
  const listbox = await within(dialog).findByRole("listbox");
  const option = within(listbox).getByRole("option", { name: optionLabel });
  fireEvent.click(within(option).getByRole("button"));
}

beforeEach(() => {
  localStorage.clear();
  seedFinance();
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  usersMocks.listUsers.mockReset();
  usersMocks.changeUserRole.mockReset();
  usersMocks.setUserManager.mockReset();
  usersMocks.listUsers.mockResolvedValue(SEED_USERS);
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
    expect(screen.getByText("Approver")).toBeInTheDocument();
    expect(screen.getByText("Employee")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    // Department column populated.
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("renders an empty state when the directory has no users", async () => {
    usersMocks.listUsers.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no users yet/i)).toBeInTheDocument();
  });
});

describe("User directory — role change dialog", () => {
  it("changes a role, closes the dialog, and refreshes the list", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);
    const rows = screen.getAllByRole("button", { name: /change role/i });
    fireEvent.click(rows[0]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /change role/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/their current role is/i)).toBeInTheDocument();

    await pickOption(dialog, /new role/i, /approver/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /change role/i }));

    await waitFor(() =>
      expect(usersMocks.changeUserRole).toHaveBeenCalledWith(expect.any(String), "approver")
    );
    // The list refreshes automatically after the mutation.
    await waitFor(() => expect(usersMocks.listUsers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("User directory — set manager dialog", () => {
  it("shows the current manager and lists all other users as candidates", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: /set manager/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/current manager:/i)).toHaveTextContent(/Dewi Anggraeni/);

    const trigger = within(dialog).getByLabelText(/manager/i);
    fireEvent.click(trigger);
    const listbox = await within(dialog).findByRole("listbox");

    // The target user cannot be picked as their own manager.
    expect(
      within(listbox).queryByRole("option", { name: /Aulia Pratiwi/i })
    ).not.toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /Dewi Anggraeni/i })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /Ridwan Saputra/i })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /no manager/i })).toBeInTheDocument();
  });

  it("assigns a manager, closes, and refreshes the list", async () => {
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: /set manager/i }));
    const dialog = await screen.findByRole("dialog");

    await pickOption(dialog, /^manager/i, /Ridwan Saputra/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /set manager/i }));

    await waitFor(() =>
      expect(usersMocks.setUserManager).toHaveBeenCalledWith("u-emp-1", "u-fin-1")
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
    usersMocks.changeUserRole.mockRejectedValue(
      new UsersApiError(403, "forbidden", "Finance admins only."),
    );
    renderPage();
    await waitForReady(/Aulia Pratiwi/);

    const row = rowFor("Aulia Pratiwi");
    fireEvent.click(within(row).getByRole("button", { name: /change role/i }));
    const dialog = await screen.findByRole("dialog");
    await pickOption(dialog, /new role/i, /approver/i);
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

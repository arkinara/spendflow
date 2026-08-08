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
  pathname: "/finance/exceptions",
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
 * #48 FE half: `/finance/exceptions` renders a "Resolve SoD" action on
 * `blocked_sod` rows and submits an unblock through the `@/lib/api/finance`
 * client. Mock the module so the queue is fed controlled exception fixtures
 * and the unblock mutator is assertable directly. The real error classes are
 * kept so `instanceof FinanceApiError` / `UsersApiError` branches (409
 * still_blocked inline error) run under test.
 */
const financeMocks = vi.hoisted(() => ({
  getExceptions: vi.fn(),
  getPayments: vi.fn(),
  unblockClaim: vi.fn(),
}));

vi.mock("@/lib/api/finance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/finance")>();
  return {
    ...actual,
    FinanceApiError: actual.FinanceApiError,
    getExceptions: financeMocks.getExceptions,
    getPayments: financeMocks.getPayments,
    unblockClaim: financeMocks.unblockClaim,
  };
});

const usersMocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
}));

vi.mock("@/lib/api/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/users")>();
  return {
    ...actual,
    UsersApiError: actual.UsersApiError,
    listUsers: usersMocks.listUsers,
  };
});

import ExceptionsPage from "@/app/finance/exceptions/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { UsersApiError, type BackendUser } from "@/lib/api/users";
import type { BackendClaim } from "@/lib/api/claims";
import type { FinanceExceptionItem } from "@/lib/api/finance";

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

const APPROVER = backendUser({
  id: "u-mgr-1",
  name: "Dewi Anggraeni",
  email: "dewi.anggraeni@spendflow.example",
  role: "approver",
  managerId: null,
  department: "Operations",
});

const APPROVER_2 = backendUser({
  id: "u-app-2",
  name: "Eka Wahyuni",
  email: "eka.wahyuni@spendflow.example",
  role: "approver",
  managerId: null,
  department: "Marketing",
});

const SEED_USERS: BackendUser[] = [FINANCE, APPROVER, APPROVER_2, backendUser()];

function exceptionItem(
  overrides: Partial<FinanceExceptionItem> = {},
): FinanceExceptionItem {
  return {
    id: "clm-9001",
    reference: "EXP-2026-9001",
    title: "Q3 Conference",
    purpose: "Conference travel",
    employeeId: "u-emp-2",
    status: "blocked_sod",
    currency: "IDR",
    createdAt: "2026-07-24T09:00:00Z",
    submittedAt: "2026-07-25T09:00:00Z",
    decidedAt: undefined,
    tripStart: undefined,
    tripEnd: undefined,
    destination: "Bali",
    lineItems: [
      {
        id: "li-1",
        categoryId: "flight",
        description: "Return flight",
        date: "2026-07-22",
        amount: 2_450_000,
        currency: "IDR",
        hasReceipt: true,
      },
    ],
    attachments: [],
    approvals: [],
    employeeName: "Budi Santoso",
    openFlagCount: 0,
    blockedReason:
      "Submitter has no manager — the route's manager step cannot resolve.",
    routeSteps: [
      {
        id: "rt-1-s1",
        label: "Line manager",
        approverType: "submitter_manager",
        approverId: null,
      },
      {
        id: "rt-1-s2",
        label: "Finance review",
        approverType: "finance",
        approverId: "u-fin-1",
      },
    ],
    ...overrides,
  };
}

/** A blocked_sod claim whose SoD conflict is a self-approval step (#46). */
function selfApprovalBlocked(): FinanceExceptionItem {
  return exceptionItem({
    id: "clm-9002",
    reference: "EXP-2026-9002",
    title: "Team Offsite",
    employeeName: "Budi Santoso",
    blockedReason:
      "Route step 1 resolves to the submitter (self-approval) — reassign it.",
    routeSteps: [
      {
        id: "rt-2-s1",
        label: "Line manager",
        approverType: "specific_user",
        approverId: "u-emp-2",
      },
    ],
  });
}

/** A fully-approved claim with an open policy flag (the non-SoD queue row). */
function flaggedApproved(): FinanceExceptionItem {
  return exceptionItem({
    id: "clm-9003",
    reference: "EXP-2026-9003",
    title: "Client Lunch",
    status: "approved",
    employeeName: "Aulia Pratiwi",
    openFlagCount: 1,
    blockedReason: undefined,
    routeSteps: undefined,
    exception: {
      id: "clm-9003-exc",
      type: "over_policy",
      severity: "medium",
      message: "Lunch exceeds the per-meal cap.",
      flaggedAt: TS,
      status: "open",
    },
  });
}

function backendClaim(overrides: Partial<BackendClaim> = {}): BackendClaim {
  return {
    id: "clm-9001",
    reference: "EXP-2026-9001",
    title: "Q3 Conference",
    purpose: "Conference travel",
    employeeId: "u-emp-2",
    status: "pending",
    currency: "IDR",
    tripStart: null,
    tripEnd: null,
    destination: "Bali",
    approvalRouteId: "rt-1",
    currentStepIndex: 0,
    policyException: null,
    blockedReason: null,
    submittedAt: "2026-07-25T09:00:00Z",
    decidedAt: null,
    createdAt: "2026-07-24T09:00:00Z",
    updatedAt: "2026-07-25T09:00:00Z",
    lineItems: [],
    ...overrides,
  };
}

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
            <ExceptionsPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

async function waitForQueue(probe: RegExp) {
  await waitFor(() => expect(screen.getByText(probe)).toBeInTheDocument());
}

function rowFor(title: string): HTMLElement {
  const cell = screen.getAllByText(title).find((el) => !!el.closest("tr"))!;
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
  navMocks.search = "";
  financeMocks.getExceptions.mockReset();
  financeMocks.getPayments.mockReset();
  financeMocks.unblockClaim.mockReset();
  usersMocks.listUsers.mockReset();
  financeMocks.getExceptions.mockResolvedValue([]);
  financeMocks.getPayments.mockResolvedValue({
    approved: [],
    processing: [],
    paid: [],
  });
  usersMocks.listUsers.mockResolvedValue(SEED_USERS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ================================================================ UI FLOWS == */

describe("Exception queue — Resolve SoD action", () => {
  it("renders a Resolve SoD button only on blocked_sod rows, not approved/flagged ones", async () => {
    financeMocks.getExceptions.mockResolvedValue([
      selfApprovalBlocked(),
      flaggedApproved(),
    ]);
    renderPage();
    await waitForQueue(/Team Offsite/);

    const blockedRow = rowFor("Team Offsite");
    const approvedRow = rowFor("Client Lunch");

    expect(
      within(blockedRow).getByRole("button", { name: /resolve sod/i })
    ).toBeInTheDocument();
    // SoD rows never offer the plain override action.
    expect(
      within(blockedRow).queryByRole("button", { name: /^resolve$/i })
    ).not.toBeInTheDocument();

    // The approved/flagged row keeps the standard Resolve action + no SoD.
    expect(
      within(approvedRow).queryByRole("button", { name: /resolve sod/i })
    ).not.toBeInTheDocument();
    expect(
      within(approvedRow).getByRole("button", { name: /^resolve$/i })
    ).toBeInTheDocument();
  });

  it("opens the dialog with the block copy: title, submitter name, blocked_reason", async () => {
    financeMocks.getExceptions.mockResolvedValue([selfApprovalBlocked()]);
    renderPage();
    await waitForQueue(/Team Offsite/);

    fireEvent.click(
      within(rowFor("Team Offsite")).getByRole("button", { name: /resolve sod/i })
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: /resolve sod block on 'team offsite'\?/i })
    ).toBeInTheDocument();
    // Submitter name surfaces in the action radio label.
    expect(
      within(dialog).getByRole("radio", { name: /assign manager to budi santoso/i })
    ).toBeInTheDocument();
    // The BE's blocked reason renders verbatim.
    expect(
      within(dialog).getByText(/self-approval/i)
    ).toBeInTheDocument();
    // The route steps are offered for the reassign action.
    expect(
      within(dialog).getByRole("radio", { name: /reassign this step's approver/i })
    ).toBeInTheDocument();
  });

  it("keeps Resolve & re-route disabled until a manager + 10+ char resolution are present", async () => {
    financeMocks.getExceptions.mockResolvedValue([exceptionItem()]);
    renderPage();
    await waitForQueue(/Q3 Conference/);

    fireEvent.click(
      within(rowFor("Q3 Conference")).getByRole("button", { name: /resolve sod/i })
    );
    const dialog = await screen.findByRole("alertdialog");

    const submit = within(dialog).getByRole("button", { name: /resolve & re-route/i });
    expect(submit).toBeDisabled();

    const reason = within(dialog).getByLabelText(/resolution reason/i);
    fireEvent.change(reason, { target: { value: "Too short" } });
    expect(submit).toBeDisabled();

    fireEvent.change(reason, { target: { value: "Assigning a manager to the submitter" } });
    // Still disabled — no manager selected yet.
    expect(submit).toBeDisabled();

    await pickOption(dialog, /^new manager/i, /Dewi Anggraeni/i);
    await waitFor(() => expect(submit).toBeEnabled());
  });
});

describe("Exception queue — unblock assign_manager", () => {
  it("submits assign_manager + resolution, toasts, and drops the row from the queue", async () => {
    financeMocks.getExceptions.mockResolvedValue([exceptionItem(), flaggedApproved()]);
    financeMocks.unblockClaim.mockResolvedValue({ claim: backendClaim() });
    renderPage();
    await waitForQueue(/Q3 Conference/);

    fireEvent.click(
      within(rowFor("Q3 Conference")).getByRole("button", { name: /resolve sod/i })
    );
    const dialog = await screen.findByRole("alertdialog");

    fireEvent.click(
      within(dialog).getByRole("radio", { name: /assign manager to budi santoso/i })
    );
    await pickOption(dialog, /^new manager/i, /Dewi Anggraeni/i);
    fireEvent.change(within(dialog).getByLabelText(/resolution reason/i), {
      target: { value: "Budi has no manager — assigning Dewi to unblock the route." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /resolve & re-route/i }));

    await waitFor(() =>
      expect(financeMocks.unblockClaim).toHaveBeenCalledWith("clm-9001", {
        resolution: "Budi has no manager — assigning Dewi to unblock the route.",
        action: "assign_manager",
        managerId: "u-mgr-1",
      })
    );

    // Success → dialog closes + success toast + row removed (no refetch).
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/q3 conference unblocked/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Q3 Conference")).not.toBeInTheDocument()
    );
    // The flagged row is untouched.
    expect(screen.getByText("Client Lunch")).toBeInTheDocument();
  });
});

describe("Exception queue — unblock reassign_step", () => {
  it("submits stepId + newApproverId + resolution, toasts, and drops the row", async () => {
    financeMocks.getExceptions.mockResolvedValue([selfApprovalBlocked()]);
    financeMocks.unblockClaim.mockResolvedValue({ claim: backendClaim() });
    renderPage();
    await waitForQueue(/Team Offsite/);

    fireEvent.click(
      within(rowFor("Team Offsite")).getByRole("button", { name: /resolve sod/i })
    );
    const dialog = await screen.findByRole("alertdialog");

    fireEvent.click(
      within(dialog).getByRole("radio", { name: /reassign this step's approver/i })
    );
    await pickOption(dialog, /^step to reassign/i, /line manager/i);
    await pickOption(dialog, /^new approver/i, /Dewi Anggraeni/i);
    fireEvent.change(within(dialog).getByLabelText(/resolution reason/i), {
      target: { value: "Step 1 resolves to the submitter — repointing to Dewi." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /resolve & re-route/i }));

    await waitFor(() =>
      expect(financeMocks.unblockClaim).toHaveBeenCalledWith("clm-9002", {
        resolution: "Step 1 resolves to the submitter — repointing to Dewi.",
        action: "reassign_step",
        stepId: "rt-2-s1",
        newApproverId: "u-mgr-1",
      })
    );

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/team offsite unblocked/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Team Offsite")).not.toBeInTheDocument()
    );
  });
});

describe("Exception queue — unblock failure + dismissal", () => {
  it("surfaces a 409 still_blocked message inline and keeps the dialog open", async () => {
    financeMocks.getExceptions.mockResolvedValue([exceptionItem()]);
    financeMocks.unblockClaim.mockRejectedValue(
      new UsersApiError(
        409,
        "still_blocked",
        "That reassignment would still violate SoD. Try a different approver."
      )
    );
    renderPage();
    await waitForQueue(/Q3 Conference/);

    fireEvent.click(
      within(rowFor("Q3 Conference")).getByRole("button", { name: /resolve sod/i })
    );
    const dialog = await screen.findByRole("alertdialog");

    fireEvent.click(
      within(dialog).getByRole("radio", { name: /assign manager to budi santoso/i })
    );
    await pickOption(dialog, /^new manager/i, /Dewi Anggraeni/i);
    fireEvent.change(within(dialog).getByLabelText(/resolution reason/i), {
      target: { value: "Assigning a manager to the submitter to unblock the route." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /resolve & re-route/i }));

    // BE's SoD message surfaces verbatim + the dialog stays open (submit is
    // the retry).
    expect(
      await within(dialog).findByText(/would still violate sod\. try a different approver/i)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: /resolve sod block on 'q3 conference'\?/i })
    ).toBeInTheDocument();
  });

  it("Esc closes without submitting and the resolution is cleared on reopen", async () => {
    financeMocks.getExceptions.mockResolvedValue([exceptionItem()]);
    renderPage();
    await waitForQueue(/Q3 Conference/);

    const openButton = within(rowFor("Q3 Conference")).getByRole("button", {
      name: /resolve sod/i,
    });
    fireEvent.click(openButton);
    const dialog = await screen.findByRole("alertdialog");

    const reason = within(dialog).getByLabelText(/resolution reason/i);
    fireEvent.change(reason, { target: { value: "A resolution that never gets sent." } });
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(financeMocks.unblockClaim).not.toHaveBeenCalled();

    // Reopen → the form starts clean (resolution + fields reset).
    fireEvent.click(openButton);
    const reopened = await screen.findByRole("alertdialog");
    expect(
      within(reopened).getByLabelText(/resolution reason/i)
    ).toHaveValue("");
    expect(financeMocks.unblockClaim).not.toHaveBeenCalled();
  });
});

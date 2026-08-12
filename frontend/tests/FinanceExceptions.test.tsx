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
  bulkApproveClaims: vi.fn(),
  bulkRejectClaims: vi.fn(),
  bulkPayClaims: vi.fn(),
}));

vi.mock("@/lib/api/finance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/finance")>();
  return {
    ...actual,
    FinanceApiError: actual.FinanceApiError,
    getExceptions: financeMocks.getExceptions,
    getPayments: financeMocks.getPayments,
    unblockClaim: financeMocks.unblockClaim,
    bulkApproveClaims: financeMocks.bulkApproveClaims,
    bulkRejectClaims: financeMocks.bulkRejectClaims,
    bulkPayClaims: financeMocks.bulkPayClaims,
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

/** #57b: mock the admin client so the dev-only panel's fetch is assertable. */
const adminMocks = vi.hoisted(() => ({
  getRecentDevInvites: vi.fn(),
}));

vi.mock("@/lib/api/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/admin")>();
  return {
    ...actual,
    AdminApiError: actual.AdminApiError,
    getRecentDevInvites: adminMocks.getRecentDevInvites,
  };
});

import ExceptionsPage from "@/app/finance/exceptions/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import {
  BulkPartialFailureError,
  UsersApiError,
  type BackendUser,
} from "@/lib/api/users";
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
function flaggedApproved(
  overrides: Partial<FinanceExceptionItem> = {},
): FinanceExceptionItem {
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
    ...overrides,
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
  financeMocks.bulkApproveClaims.mockReset();
  financeMocks.bulkRejectClaims.mockReset();
  financeMocks.bulkPayClaims.mockReset();
  usersMocks.listUsers.mockReset();
  adminMocks.getRecentDevInvites.mockReset();
  financeMocks.getExceptions.mockResolvedValue([]);
  financeMocks.getPayments.mockResolvedValue({
    approved: [],
    processing: [],
    paid: [],
  });
  usersMocks.listUsers.mockResolvedValue(SEED_USERS);
  adminMocks.getRecentDevInvites.mockResolvedValue([]);
  // Dev flag defaults off so existing tests run the production path.
  process.env.NEXT_PUBLIC_SPENDFLOW_DEV_MODE = "";
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

  it("keeps Resolve & re-route disabled until a manager + 10+ char resolution + password are present", async () => {
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
    // Still disabled — no re-auth password yet (#64).
    expect(submit).toBeDisabled();

    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
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
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /resolve & re-route/i }));

    await waitFor(() =>
      expect(financeMocks.unblockClaim).toHaveBeenCalledWith(
        "clm-9001",
        {
          resolution: "Budi has no manager — assigning Dewi to unblock the route.",
          action: "assign_manager",
          managerId: "u-mgr-1",
        },
        "demo1234"
      )
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
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /resolve & re-route/i }));

    await waitFor(() =>
      expect(financeMocks.unblockClaim).toHaveBeenCalledWith(
        "clm-9002",
        {
          resolution: "Step 1 resolves to the submitter — repointing to Dewi.",
          action: "reassign_step",
          stepId: "rt-2-s1",
          newApproverId: "u-mgr-1",
        },
        "demo1234"
      )
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
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
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

  it("shows the BE's 401 re-auth message inline and keeps the dialog open", async () => {
    financeMocks.getExceptions.mockResolvedValue([exceptionItem()]);
    financeMocks.unblockClaim.mockRejectedValue(
      new UsersApiError(401, "invalid_password", "Incorrect password")
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
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "wrong-password" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /resolve & re-route/i }));

    // #64: BE's 401 message surfaces verbatim + the dialog stays open as the
    // retry.
    expect(await within(dialog).findByText(/incorrect password/i)).toBeInTheDocument();
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

/* ------------------------------------------- bulk actions (#73) =========== */

describe("Exception queue — bulk actions (#73)", () => {
  it("renders a per-row checkbox column and enables the bulk action bar once 2 claims are selected", async () => {
    financeMocks.getExceptions.mockResolvedValue([
      flaggedApproved(),
      flaggedApproved({
        id: "clm-9004",
        reference: "EXP-2026-9004",
        title: "Client Dinner",
      }),
    ]);
    renderPage();
    await waitForQueue(/Client Lunch/);

    const headerCheckbox = screen.getByLabelText(/select all exceptions/i);
    const row1 = screen.getByLabelText(/select exp-2026-9003/i);
    const row2 = screen.getByLabelText(/select exp-2026-9004/i);
    expect(headerCheckbox).toBeInTheDocument();
    expect(row1).toBeInTheDocument();
    expect(row2).toBeInTheDocument();

    // No action bar until something is selected.
    expect(
      screen.queryByRole("button", { name: /approve/i })
    ).not.toBeInTheDocument();

    fireEvent.click(row1);
    expect(screen.getByRole("button", { name: /approve 1/i })).toBeInTheDocument();

    fireEvent.click(row2);
    expect(screen.getByRole("button", { name: /approve 2/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject 2/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pay 2/i })).toBeInTheDocument();

    // Select-all toggles every visible row (both already selected → clears).
    fireEvent.click(headerCheckbox);
    await waitFor(() => expect(headerCheckbox).not.toBeChecked());
    expect(
      screen.queryByRole("button", { name: /approve/i })
    ).not.toBeInTheDocument();

    // Clicking select-all again re-selects both.
    fireEvent.click(headerCheckbox);
    await waitFor(() => expect(headerCheckbox).toBeChecked());
    expect(screen.getByRole("button", { name: /approve 2/i })).toBeInTheDocument();
  });

  it("bulk approves 2 selected claims via the dialog, toasts, and drops the rows", async () => {
    financeMocks.getExceptions.mockResolvedValue([
      flaggedApproved(),
      flaggedApproved({
        id: "clm-9004",
        reference: "EXP-2026-9004",
        title: "Client Dinner",
      }),
    ]);
    financeMocks.bulkApproveClaims.mockResolvedValue({
      processed: ["clm-9003", "clm-9004"],
      failed: [],
    });
    renderPage();
    await waitForQueue(/Client Lunch/);

    fireEvent.click(screen.getByLabelText(/select exp-2026-9003/i));
    fireEvent.click(screen.getByLabelText(/select exp-2026-9004/i));
    fireEvent.click(screen.getByRole("button", { name: /approve 2/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: /approve 2 claims/i })
    ).toBeInTheDocument();

    const submit = within(dialog).getByRole("button", { name: /approve 2/i });
    expect(submit).toBeDisabled();

    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() =>
      expect(financeMocks.bulkApproveClaims).toHaveBeenCalledWith({
        claimIds: ["clm-9003", "clm-9004"],
        password: "demo1234",
      })
    );
    // Success → dialog closes + success toast + rows dropped (no refetch).
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
    expect(await screen.findByText(/2 claims approved/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Client Lunch")).not.toBeInTheDocument()
    );
    expect(screen.queryByText("Client Dinner")).not.toBeInTheDocument();
  });

  it("bulk rejects 1 selected claim with a shared comment via the dialog", async () => {
    financeMocks.getExceptions.mockResolvedValue([flaggedApproved()]);
    financeMocks.bulkRejectClaims.mockResolvedValue({
      processed: ["clm-9003"],
      failed: [],
    });
    renderPage();
    await waitForQueue(/Client Lunch/);

    fireEvent.click(screen.getByLabelText(/select exp-2026-9003/i));
    fireEvent.click(screen.getByRole("button", { name: /reject 1/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: /reject 1 claim/i })
    ).toBeInTheDocument();

    const submit = within(dialog).getByRole("button", { name: /reject 1/i });
    expect(submit).toBeDisabled();

    // A comment shorter than 10 chars keeps the submit disabled.
    fireEvent.change(
      within(dialog).getByLabelText(/comment to the employees/i),
      { target: { value: "Too short" } }
    );
    expect(submit).toBeDisabled();

    fireEvent.change(
      within(dialog).getByLabelText(/comment to the employees/i),
      { target: { value: "Receipt is required for these amounts." } }
    );
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() =>
      expect(financeMocks.bulkRejectClaims).toHaveBeenCalledWith({
        claimIds: ["clm-9003"],
        password: "demo1234",
        comment: "Receipt is required for these amounts.",
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
    expect(
      await screen.findByText(/1 claim returned to the employees/i)
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Client Lunch")).not.toBeInTheDocument()
    );
  });

  it("surfaces the BE's failed claim ids inline and keeps the dialog open on a batch rollback", async () => {
    financeMocks.getExceptions.mockResolvedValue([
      flaggedApproved(),
      flaggedApproved({
        id: "clm-9004",
        reference: "EXP-2026-9004",
        title: "Client Dinner",
      }),
    ]);
    financeMocks.bulkApproveClaims.mockRejectedValue(
      new BulkPartialFailureError(
        [
          {
            userId: "clm-9004",
            error: new UsersApiError(0, "wrong_status", "Claim is already approved"),
          },
        ],
        0,
        2
      )
    );
    renderPage();
    await waitForQueue(/Client Lunch/);

    fireEvent.click(screen.getByLabelText(/select exp-2026-9003/i));
    fireEvent.click(screen.getByLabelText(/select exp-2026-9004/i));
    fireEvent.click(screen.getByRole("button", { name: /approve 2/i }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /approve 2/i }));

    // The BE's failed claim id + message surface inline; the dialog stays open.
    expect(
      await within(dialog).findByText(/1 of 2 claims could not be approved/i)
    ).toBeInTheDocument();
    expect(within(dialog).getByText("clm-9004")).toBeInTheDocument();
    expect(within(dialog).getByText("— Claim is already approved")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: /approve 2 claims/i })
    ).toBeInTheDocument();
    // The queue rows are untouched.
    expect(screen.getByText("Client Lunch")).toBeInTheDocument();
  });

  it("bulk pays a selected claim via the dialog with method + reference", async () => {
    financeMocks.getExceptions.mockResolvedValue([flaggedApproved()]);
    financeMocks.bulkPayClaims.mockResolvedValue({
      processed: ["clm-9003"],
      failed: [],
    });
    renderPage();
    await waitForQueue(/Client Lunch/);

    fireEvent.click(screen.getByLabelText(/select exp-2026-9003/i));
    fireEvent.click(screen.getByRole("button", { name: /pay 1/i }));

    const dialog = await screen.findByRole("alertdialog");
    const submit = within(dialog).getByRole("button", { name: /pay 1/i });
    expect(submit).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/reference number/i), {
      target: { value: "BATCH-2026-08-001" },
    });
    fireEvent.change(
      within(dialog).getByLabelText(/re-enter your password to confirm/i),
      { target: { value: "demo1234" } }
    );
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() =>
      expect(financeMocks.bulkPayClaims).toHaveBeenCalledWith({
        claimIds: ["clm-9003"],
        password: "demo1234",
        paymentMethod: "bank_transfer",
        reference: "BATCH-2026-08-001",
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
    expect(await screen.findByText(/1 claim paid/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Client Lunch")).not.toBeInTheDocument()
    );
  });
});

/* ------------------------------------------- dev email panel (#57b) ========= */

describe("Recent dev emails panel (#57b)", () => {
  const DEV_ENTRIES = [
    {
      email: "dev1@spendflow.example",
      inviteUrl: "http://localhost:3000/invite/dev1_token",
      sentAt: "2026-08-10T11:05:44.888Z",
    },
    {
      email: "dev2@spendflow.example",
      inviteUrl: "http://localhost:3000/invite/dev2_token",
      sentAt: "2026-08-10T11:05:44.542Z",
    },
  ];

  it("renders the panel with per-row Copy buttons only when NEXT_PUBLIC_SPENDFLOW_DEV_MODE=true", async () => {
    process.env.NEXT_PUBLIC_SPENDFLOW_DEV_MODE = "true";
    adminMocks.getRecentDevInvites.mockResolvedValue(DEV_ENTRIES);
    renderPage();
    await waitForQueue(/exception queue/i);

    const heading = await screen.findByRole("heading", { name: /recent dev emails/i });
    expect(heading).toBeInTheDocument();

    // Each entry surfaces email + a Copy link button.
    expect(await screen.findByText(/dev1@spendflow\.example/i)).toBeInTheDocument();
    expect(screen.getByText(/dev2@spendflow\.example/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy link for dev1@spendflow\.example/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy link for dev2@spendflow\.example/i })
    ).toBeInTheDocument();

    // Copy writes the URL to the clipboard and flips the button label.
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.assign(navigator, { clipboard });
    fireEvent.click(
      screen.getByRole("button", { name: /copy link for dev1@spendflow\.example/i })
    );
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith("http://localhost:3000/invite/dev1_token")
    );
    // The button's visible label flips to "Copied" (aria-label stays the row name).
    expect(
      await screen.findByRole("button", { name: /copy link for dev1@spendflow\.example/i })
    ).toHaveTextContent(/copied/i);
  });

  it("renders an empty state when dev mode is on but the log has no entries", async () => {
    process.env.NEXT_PUBLIC_SPENDFLOW_DEV_MODE = "true";
    adminMocks.getRecentDevInvites.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no sandbox invites yet/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recent dev emails/i })).toBeInTheDocument();
  });

  it("renders an error state with a working Retry when the fetch fails", async () => {
    process.env.NEXT_PUBLIC_SPENDFLOW_DEV_MODE = "true";
    adminMocks.getRecentDevInvites
      .mockRejectedValueOnce(new Error("Backend unreachable."))
      .mockResolvedValueOnce(DEV_ENTRIES);
    renderPage();

    expect(await screen.findByText(/backend unreachable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(await screen.findByText(/dev1@spendflow\.example/i)).toBeInTheDocument();
    expect(adminMocks.getRecentDevInvites).toHaveBeenCalledTimes(2);
  });

  it("never renders the panel (or fetches) when dev mode is off", async () => {
    process.env.NEXT_PUBLIC_SPENDFLOW_DEV_MODE = "";
    renderPage();
    await waitForQueue(/exception queue/i);

    expect(
      screen.queryByRole("heading", { name: /recent dev emails/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/no sandbox invites yet/i)).not.toBeInTheDocument();
    expect(adminMocks.getRecentDevInvites).not.toHaveBeenCalled();
  });
});

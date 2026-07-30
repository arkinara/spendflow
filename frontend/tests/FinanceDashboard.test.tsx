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
  pathname: "/finance",
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

import FinanceDashboardPage from "@/app/finance/page";
import ExceptionsPage from "@/app/finance/exceptions/page";
import PaymentsBoardPage from "@/app/finance/payments/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import {
  claims,
  comments,
  notifications,
  auditLog,
  getClaim,
  computeClaimTotal,
  openFinanceExceptions,
  claimsReadyToPay,
  claimsProcessing,
  claimsPaid,
  type Claim,
} from "@/lib/mock/mock_data";
import {
  resolveException,
  markClaimProcessing,
  markClaimPaid,
} from "@/lib/mock/claimStore";
import { loadFinanceDashboard } from "@/lib/mock/financeDashboard";

/* ----------------------------------------------------------------- helpers */

function seedFinance() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-fin-1", role: "finance", issuedAt: Date.now() })
  );
}

/**
 * Pristine deep snapshot of the live mock store captured at module load.
 * Finance actions mutate the shared store (claims/approvals/audit/
 * notifications), and vitest runs every file in a single fork, so we restore
 * this baseline between tests to keep each test (and neighbouring suites)
 * isolated from cross-test contamination.
 */
const PRISTINE_CLAIMS: Claim[] = claims.map((c) => JSON.parse(JSON.stringify(c)));
const PRISTINE_COMMENTS = comments.map((c) => ({ ...c }));
const PRISTINE_NOTIFICATIONS = notifications.map((n) => ({ ...n }));
const PRISTINE_AUDIT = auditLog.map((a) => ({ ...a }));

function restoreStore() {
  claims.splice(
    0,
    claims.length,
    ...PRISTINE_CLAIMS.map((c) => JSON.parse(JSON.stringify(c)))
  );
  comments.splice(0, comments.length, ...PRISTINE_COMMENTS.map((c) => ({ ...c })));
  notifications.splice(
    0,
    notifications.length,
    ...PRISTINE_NOTIFICATIONS.map((n) => ({ ...n }))
  );
  auditLog.splice(0, auditLog.length, ...PRISTINE_AUDIT.map((a) => ({ ...a })));
}

function renderDashboard() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["finance"]}>
            <FinanceDashboardPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

function renderExceptions() {
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

function renderPayments() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["finance"]}>
            <PaymentsBoardPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

/** Resolve buttons are nested per-row; pick the one in the row that shows a
 *  given claim reference. */
function resolveButtonFor(reference: string): HTMLElement {
  const cell = screen.getByText(reference);
  const row = cell.closest("tr")!;
  return within(row).getByRole("button", { name: /resolve/i });
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

/* ------------------------------------- Finance Dashboard (sub-feature) */

describe("Finance dashboard — counts, quick actions & empty/error states", () => {
  it("renders metric counts consistent with the live claim set and quick-action entries", async () => {
    renderDashboard();

    const data = loadFinanceDashboard();

    // Exception banner surfaces the open-exception count.
    expect(
      await screen.findByText(
        new RegExp(`${data.openExceptionCount} open exception`)
      )
    ).toBeInTheDocument();

    // Ready-to-pay hint carries the approved (non-flagged) count.
    expect(
      screen.getByText(
        new RegExp(`${data.readyToPayCount} approved claim`)
      )
    ).toBeInTheDocument();

    // Quick-action entries link into the two finance workflows.
    expect(
      screen.getByRole("link", { name: /exception queue/i }).getAttribute("href")
    ).toBe("/finance/exceptions");
    expect(
      screen.getByRole("link", { name: /payment board/i }).getAttribute("href")
    ).toBe("/finance/payments");

    // Counts stay consistent with the underlying selectors.
    expect(data.openExceptionCount).toBe(openFinanceExceptions().length);
    expect(data.readyToPayCount).toBe(claimsReadyToPay().length);
    expect(data.inFlightCount).toBe(claimsProcessing().length);
    expect(data.paidCount).toBe(claimsPaid().length);
  });

  it("renders consistent totals even when no claims are Processing or Paid", () => {
    // Drain processing + paid by mutating the store out-of-band.
    claimsProcessing().forEach((c) => {
      const claim = getClaim(c.id)!;
      claim.status = "approved";
      claim.payment = undefined;
    });
    claimsPaid().forEach((c) => {
      const claim = getClaim(c.id)!;
      claim.status = "approved";
      claim.payment = undefined;
    });

    const data = loadFinanceDashboard();
    expect(data.inFlightCount).toBe(0);
    expect(data.paidCount).toBe(0);
    expect(data.inFlightAmount).toBe(0);
    expect(data.paidAmount).toBe(0);
    // Ready-to-pay absorbed the drained claims (those without open flags).
    expect(data.readyToPayCount).toBe(claimsReadyToPay().length);
    // Dashboard totals are exactly the sum of group amounts — never NaN/blank.
    expect(data.readyToPayAmount).toBe(
      claimsReadyToPay().reduce((s, c) => s + computeClaimTotal(c), 0)
    );
  });
});

/* ------------------------------------- Policy Exception Queue (sub-feature) */

describe("Exception queue — filters open flags & empty state", () => {
  it("lists only approved claims carrying an open policy flag (excludes action_required)", async () => {
    renderExceptions();

    // clm-1010 (over_policy) and clm-1011 (missing_receipt) are approved + open.
    expect(await screen.findByText("EXP-2026-1010")).toBeInTheDocument();
    expect(screen.getByText("EXP-2026-1011")).toBeInTheDocument();

    // clm-1003 is action_required with an open exception — NOT finance's queue.
    expect(screen.queryByText("EXP-2026-1003")).toBeNull();
    // Clean approved claims are not in the exception queue.
    expect(screen.queryByText("EXP-2026-1012")).toBeNull();
    expect(screen.queryByText("EXP-2026-1004")).toBeNull();

    // Severity tone chips render for both exception types.
    expect(screen.getByText("Over policy cap")).toBeInTheDocument();
    expect(screen.getByText("Missing receipt")).toBeInTheDocument();
  });

  it("shows an empty state (not a blank section) once every flag is resolved", async () => {
    // Resolve both flagged claims out-of-band so the queue drains.
    resolveException({
      claimId: "clm-1010",
      actorId: "u-fin-1",
      action: "override",
      note: "Pre-approved upgrade.",
    });
    resolveException({
      claimId: "clm-1011",
      actorId: "u-fin-1",
      action: "override",
      note: "Receipt waived.",
    });
    expect(openFinanceExceptions()).toHaveLength(0);

    renderExceptions();
    expect(await screen.findByText(/all clear/i)).toBeInTheDocument();
  });
});

/* ------------------------------------- Exception Resolution Dialogs */

describe("Exception resolution — override clears flag + audit; reject returns to employee", () => {
  it("blocks override with empty justification, then clears the flag, writes audit, and keeps the claim approved", async () => {
    renderExceptions();
    await screen.findByText("EXP-2026-1010");

    fireEvent.click(resolveButtonFor("EXP-2026-1010"));
    const dialog = await screen.findByRole("dialog");

    // Choose override → justification required.
    fireEvent.click(within(dialog).getByRole("button", { name: /override & accept/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm override/i }));
    expect(await within(dialog).findByText(/justification is required/i)).toBeInTheDocument();
    expect(getClaim("clm-1010")!.exception!.status).toBe("open");

    // Provide justification and confirm.
    fireEvent.change(
      within(dialog).getByLabelText(/justification/i),
      { target: { value: "Pre-approved by VP — accept the over-cap." } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm override/i }));

    await waitFor(() =>
      expect(getClaim("clm-1010")!.exception!.status).toBe("resolved")
    );
    // Claim stays approved (ready for payment processing).
    expect(getClaim("clm-1010")!.status).toBe("approved");
    // Audit row written.
    expect(
      auditLog.some(
        (a) => a.claimId === "clm-1010" && /overridden/i.test(a.action)
      )
    ).toBe(true);
    // Employee notified the exception was accepted.
    expect(
      notifications.some(
        (n) =>
          n.audience === "employee" &&
          n.claimId === "clm-1010" &&
          /exception approved/i.test(n.title)
      )
    ).toBe(true);
    // No longer in the finance exception queue.
    expect(openFinanceExceptions().some((c) => c.id === "clm-1010")).toBe(false);
  });

  it("blocks reject with empty comment, then returns the claim to the employee as Action Required", async () => {
    renderExceptions();
    await screen.findByText("EXP-2026-1011");

    fireEvent.click(resolveButtonFor("EXP-2026-1011"));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: /reject & return/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /reject & return/i }));
    expect(await within(dialog).findByText(/justification is required/i)).toBeInTheDocument();

    fireEvent.change(
      within(dialog).getByLabelText(/comment to employee/i),
      { target: { value: "Receipt required for IDR 620k — please attach and resubmit." } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /reject & return/i }));

    await waitFor(() =>
      expect(getClaim("clm-1011")!.status).toBe("action_required")
    );
    const last = getClaim("clm-1011")!.approvals.at(-1)!;
    expect(last.action).toBe("returned");
    expect(last.note).toContain("Receipt required");
    // Employee notified to take action.
    expect(
      notifications.some(
        (n) =>
          n.audience === "employee" &&
          n.claimId === "clm-1011" &&
          /action required/i.test(n.title)
      )
    ).toBe(true);
    // Returned claim leaves the finance queue.
    expect(openFinanceExceptions().some((c) => c.id === "clm-1011")).toBe(false);
  });
});

/* ------------------------------------- Payment Status Tracking UI */

describe("Payment lifecycle — Mark Processing captures method+reference, Mark Paid notifies", () => {
  it("blocks Mark Processing without a reference, then transitions and records method/reference/actor", async () => {
    renderPayments();
    // clm-1004 is a clean approved claim (ready to pay).
    await screen.findByText(/EXP-2026-1004/);

    const row = screen.getByText(/EXP-2026-1004/).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: /mark processing/i }));
    const dialog = await screen.findByRole("dialog");

    // Confirm with empty reference → validation message, no transition.
    fireEvent.click(within(dialog).getByRole("button", { name: /move to processing/i }));
    expect(await within(dialog).findByText(/reference is required/i)).toBeInTheDocument();
    expect(getClaim("clm-1004")!.status).toBe("approved");

    // Capture method + reference and confirm.
    fireEvent.change(
      within(dialog).getByLabelText(/reference/i),
      { target: { value: "TRX-900111" } }
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /move to processing/i }));

    await waitFor(() => expect(getClaim("clm-1004")!.status).toBe("processing"));
    const payment = getClaim("clm-1004")!.payment!;
    expect(payment.method).toBe("bank_transfer");
    expect(payment.reference).toBe("TRX-900111");
    expect(payment.processedBy).toBe("u-fin-1");
    expect(payment.processedAt).toBeTruthy();
    // Timeline + audit + employee notification recorded.
    expect(
      getClaim("clm-1004")!.approvals.some((a) => a.action === "processing")
    ).toBe(true);
    expect(
      auditLog.some(
        (a) => a.claimId === "clm-1004" && /processing started/i.test(a.action)
      )
    ).toBe(true);
    expect(
      notifications.some(
        (n) =>
          n.audience === "employee" &&
          n.claimId === "clm-1004" &&
          /payment processing/i.test(n.title)
      )
    ).toBe(true);
  });

  it("transitions a Processing claim to Paid, recording actor/timestamp and notifying the employee", async () => {
    renderPayments();
    // clm-1005 is seeded Processing with method+reference already captured.
    await screen.findByText(/EXP-2026-1005/);

    const row = screen.getByText(/EXP-2026-1005/).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: /mark paid/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: /mark paid/i }));

    await waitFor(() => expect(getClaim("clm-1005")!.status).toBe("paid"));
    const payment = getClaim("clm-1005")!.payment!;
    expect(payment.paidBy).toBe("u-fin-1");
    expect(payment.paidAt).toBeTruthy();
    expect(
      getClaim("clm-1005")!.approvals.some((a) => a.action === "paid")
    ).toBe(true);
    expect(
      auditLog.some(
        (a) => a.claimId === "clm-1005" && /disbursed/i.test(a.action)
      )
    ).toBe(true);
    expect(
      notifications.some(
        (n) =>
          n.audience === "employee" &&
          n.claimId === "clm-1005" &&
          /payment sent/i.test(n.title)
      )
    ).toBe(true);
  });

  it("blocks Mark Paid at the store level when method/reference are missing", () => {
    // Corrupt a processing claim's payment metadata out-of-band.
    getClaim("clm-1005")!.payment = undefined;
    expect(() =>
      markClaimPaid({ claimId: "clm-1005", actorId: "u-fin-1" })
    ).toThrow(/method and reference/i);
    expect(getClaim("clm-1005")!.status).toBe("processing");
  });

  it("blocks Mark Processing at the store level when the reference is missing", () => {
    expect(() =>
      markClaimProcessing({
        claimId: "clm-1012",
        actorId: "u-fin-1",
        method: "bank_transfer",
        reference: "   ",
      })
    ).toThrow(/reference/i);
    expect(getClaim("clm-1012")!.status).toBe("approved");
  });
});

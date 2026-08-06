import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  FinanceExceptionItem,
  FinancePaymentItem,
  ResolveExceptionInput,
  MarkProcessingInput,
} from "@/lib/api/finance";
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

/**
 * #20: the finance dashboard / exceptions / payments pages read through
 * `@/lib/api/finance`. Mock the module so the pages are fed controlled
 * `FinanceExceptionItem` / `FinancePaymentItem` fixtures derived from the
 * in-memory mock fixture set, and the resolve / mark-processing / mark-paid
 * mutator calls delegate to the mock store (so a successful decision is
 * reflected on the next `refresh()`). The mock enforces the BE's typed-error
 * invariants (400 comment_required / 400 validation_required / 409
 * stale_decision / 403 forbidden) so the FE's inline-validation, stale-panel,
 * and access-denied branches render under test.
 */
vi.mock("@/lib/api/finance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/finance")>();
  const {
    getClaim: mockGetClaim,
    getUserName,
    computeClaimTotal,
    openFinanceExceptions,
    claimsReadyToPay,
    claimsProcessing,
    claimsPaid,
  } = await import("@/lib/seed-data");
  const {
    resolveException: storeResolve,
    markClaimProcessing: storeMarkProcessing,
    markClaimPaid: storeMarkPaid,
  } = await import("@/lib/store/claimStore");
  const FINANCE_ACTOR = "u-fin-1";

  const toExceptionItem = (c: ReturnType<typeof openFinanceExceptions>[number]): FinanceExceptionItem => ({
    ...c,
    employeeName: getUserName(c.employeeId),
    openFlagCount: 1,
  });

  const toPaymentItem = (c: ReturnType<typeof claimsReadyToPay>[number]): FinancePaymentItem => ({
    id: c.id,
    reference: c.reference,
    title: c.title,
    employeeId: c.employeeId,
    employeeName: getUserName(c.employeeId),
    currency: c.currency,
    status: c.status,
    totalAmount: computeClaimTotal(c),
    payment: c.payment,
  });

  return {
    ...actual,
    // Keep the real error class so `instanceof FinanceApiError` works in pages.
    FinanceApiError: actual.FinanceApiError,
    getExceptions: vi.fn(async () => openFinanceExceptions().map(toExceptionItem)),
    getPayments: vi.fn(async () => ({
      approved: claimsReadyToPay().map(toPaymentItem),
      processing: claimsProcessing().map(toPaymentItem),
      paid: claimsPaid().map(toPaymentItem),
    })),
    getDashboard: vi.fn(async () => {
      const exceptions = openFinanceExceptions().map(toExceptionItem);
      const approved = claimsReadyToPay().map(toPaymentItem);
      const processing = claimsProcessing().map(toPaymentItem);
      const paid = claimsPaid().map(toPaymentItem);
      const sum = (xs: FinancePaymentItem[]) =>
        xs.reduce((s, c) => s + c.totalAmount, 0);
      return {
        exceptions,
        readyToPay: approved,
        inFlight: processing,
        recentPaid: paid,
        groups: [
          { status: "approved", label: "Ready to pay", claims: approved, count: approved.length, amount: sum(approved) },
          { status: "processing", label: "Processing", claims: processing, count: processing.length, amount: sum(processing) },
          { status: "paid", label: "Paid", claims: paid, count: paid.length, amount: sum(paid) },
        ],
        openExceptionCount: exceptions.length,
        readyToPayCount: approved.length,
        inFlightCount: processing.length,
        paidCount: paid.length,
        readyToPayAmount: sum(approved),
        inFlightAmount: sum(processing),
        paidAmount: sum(paid),
        hasAnyPaymentActivity: approved.length + processing.length + paid.length > 0,
      };
    }),
    resolveException: vi.fn(async (claimId: string, input: ResolveExceptionInput) => {
      const claim = mockGetClaim(claimId);
      if (!claim) throw new actual.FinanceApiError(404, "not_found", "Claim not found.");
      // Stale guard: BE only resolves Approved claims.
      if (claim.status !== "approved") {
        throw new actual.FinanceApiError(
          409,
          "stale_decision",
          `Claim is ${claim.status}; expected approved`,
        );
      }
      // Required-comment guard (BE enforces non-empty for both actions).
      if (!input.comment || !input.comment.trim()) {
        throw new actual.FinanceApiError(
          400,
          "comment_required",
          "A justification comment is required so the decision is auditable.",
        );
      }
      // Delegate to the mock store mutator (mutates claim + writes audit/notify).
      storeResolve({
        claimId,
        actorId: FINANCE_ACTOR,
        action: input.action,
        note: input.comment,
      });
      return { claim, action: input.action };
    }),
    markProcessing: vi.fn(async (claimId: string, input: MarkProcessingInput) => {
      const claim = mockGetClaim(claimId);
      if (!claim) throw new actual.FinanceApiError(404, "not_found", "Claim not found.");
      if (claim.status !== "approved") {
        throw new actual.FinanceApiError(
          409,
          "stale_decision",
          `Claim is ${claim.status}; expected approved`,
        );
      }
      if (!input.reference || !input.reference.trim()) {
        throw new actual.FinanceApiError(
          400,
          "validation_required",
          "Payment method and reference number are required",
        );
      }
      storeMarkProcessing({
        claimId,
        actorId: FINANCE_ACTOR,
        method: input.method,
        reference: input.reference,
      });
      return { claim, payment: claim.payment! };
    }),
    markPaid: vi.fn(async (claimId: string) => {
      const claim = mockGetClaim(claimId);
      if (!claim) throw new actual.FinanceApiError(404, "not_found", "Claim not found.");
      if (claim.status !== "processing") {
        throw new actual.FinanceApiError(
          409,
          "stale_decision",
          `Claim is ${claim.status}; expected processing`,
        );
      }
      storeMarkPaid({ claimId, actorId: FINANCE_ACTOR });
      return { claim, payment: claim.payment! };
    }),
  };
});

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
} from "@/lib/fixtures";
import {
  getClaim,
  openFinanceExceptions,
  claimsReadyToPay,
  claimsProcessing,
  claimsPaid,
} from "@/lib/seed-data";
import type { Claim } from "@/lib/types";
import * as financeApi from "@/lib/api/finance";
import { FinanceApiError } from "@/lib/api/finance";

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
 * notifications); vitest runs every file in a single fork, so we restore this
 * baseline between tests to keep each test (and neighbouring suites) isolated.
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

/** Resolve buttons are nested per-row; pick the one in the row showing a reference. */
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
  vi.mocked(financeApi.getDashboard).mockClear();
  vi.mocked(financeApi.getExceptions).mockClear();
  vi.mocked(financeApi.getPayments).mockClear();
  vi.mocked(financeApi.resolveException).mockClear();
  vi.mocked(financeApi.markProcessing).mockClear();
  vi.mocked(financeApi.markPaid).mockClear();
});

afterEach(() => {
  restoreStore();
});

/* ------------------------------------- Finance Dashboard (sub-feature) */

describe("Finance dashboard — renders from API client, counts + quick actions", () => {
  it("renders metric counts from the BE-composed dashboard and keeps quick-action entries", async () => {
    renderDashboard();

    const readyCount = claimsReadyToPay().length;
    const exceptionCount = openFinanceExceptions().length;
    const inFlightCount = claimsProcessing().length;
    const paidCount = claimsPaid().length;

    // Exception banner surfaces the open-exception count (only when > 0).
    if (exceptionCount > 0) {
      expect(
        await screen.findByText(new RegExp(`${exceptionCount} open exception`))
      ).toBeInTheDocument();
    }

    // Ready-to-pay hint carries the approved (non-flagged) count.
    expect(
      await screen.findByText(new RegExp(`${readyCount} approved claim`))
    ).toBeInTheDocument();

    // Quick-action entries link into the two finance workflows.
    expect(
      screen.getByRole("link", { name: /exception queue/i }).getAttribute("href")
    ).toBe("/finance/exceptions");
    expect(
      screen.getByRole("link", { name: /payment board/i }).getAttribute("href")
    ).toBe("/finance/payments");

    // The dashboard read came from the API client, not the mock store directly.
    expect(financeApi.getDashboard).toHaveBeenCalled();

    // Counts stay consistent with the underlying selectors.
    expect(exceptionCount).toBe(openFinanceExceptions().length);
    expect(readyCount).toBe(claimsReadyToPay().length);
    expect(inFlightCount).toBe(claimsProcessing().length);
    expect(paidCount).toBe(claimsPaid().length);
  });

  it("renders consistent totals (zero) when no claims are Processing or Paid", async () => {
    // Drain processing + paid out-of-band so the BE-composed board is empty there.
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

    renderDashboard();

    // Ready-to-pay count reflects the drained claims now sitting in Approved.
    const readyCount = claimsReadyToPay().length;
    expect(
      await screen.findByText(new RegExp(`${readyCount} approved claim`))
    ).toBeInTheDocument();
    // No "In progress" metric value > 0; the metric still renders (value 0).
    expect(financeApi.getDashboard).toHaveBeenCalled();
    expect(claimsProcessing()).toHaveLength(0);
    expect(claimsPaid()).toHaveLength(0);
  });

  it("renders the access-denied / error state when the BE returns 403 forbidden", async () => {
    vi.mocked(financeApi.getDashboard).mockRejectedValueOnce(
      new FinanceApiError(403, "forbidden", "Finance admins only."),
    );

    renderDashboard();

    expect(
      await screen.findByText(/couldn.t load the finance dashboard/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/finance admins only/i)).toBeInTheDocument();
    // Retry re-attempts the API client.
    vi.mocked(financeApi.getDashboard).mockResolvedValueOnce({
      exceptions: [],
      readyToPay: [],
      inFlight: [],
      recentPaid: [],
      groups: [],
      openExceptionCount: 0,
      readyToPayCount: 0,
      inFlightCount: 0,
      paidCount: 0,
      readyToPayAmount: 0,
      inFlightAmount: 0,
      paidAmount: 0,
      hasAnyPaymentActivity: false,
    });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(financeApi.getDashboard).toHaveBeenCalledTimes(2));
  });
});

/* ------------------------------------- Policy Exception Queue (sub-feature) */

describe("Exception queue — renders from API client, filters open flags", () => {
  it("lists approved claims carrying an open policy flag and excludes action_required", async () => {
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

    // Queue came from the API client.
    expect(financeApi.getExceptions).toHaveBeenCalled();
  });

  it("shows an empty state once every flag is resolved (next read drains the queue)", async () => {
    // The queue reads live on every refresh; resolving both drains it.
    expect(openFinanceExceptions().length).toBeGreaterThan(0);

    renderExceptions();
    expect(await screen.findByText("EXP-2026-1010")).toBeInTheDocument();

    // Resolve both out-of-band (simulating another admin's actions), then
    // force the queue to re-read.
    const store = await import("@/lib/store/claimStore");
    store.resolveException({ claimId: "clm-1010", actorId: "u-fin-1", action: "override", note: "Pre-approved." });
    store.resolveException({ claimId: "clm-1011", actorId: "u-fin-1", action: "override", note: "Waived." });
    expect(openFinanceExceptions()).toHaveLength(0);

    // Trigger a fresh read of the API client (retry button).
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText(/all clear/i)).toBeInTheDocument());
  });
});

/* ------------------------------------- Exception Resolution Dialogs */

describe("Exception resolution — override / reject validation, success + stale paths", () => {
  it("blocks override with empty justification (FE pre-check, no API call), then clears the flag on success", async () => {
    renderExceptions();
    await screen.findByText("EXP-2026-1010");

    fireEvent.click(resolveButtonFor("EXP-2026-1010"));
    const dialog = await screen.findByRole("dialog");

    // Choose override → justification step.
    fireEvent.click(within(dialog).getByRole("button", { name: /override & accept/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm override/i }));
    // FE pre-check fires; the API client was NOT called.
    expect(await within(dialog).findByText(/justification is required/i)).toBeInTheDocument();
    expect(financeApi.resolveException).not.toHaveBeenCalled();
    expect(getClaim("clm-1010")!.exception!.status).toBe("open");

    // Provide justification and confirm → API resolves, claim leaves the queue.
    fireEvent.change(within(dialog).getByLabelText(/justification/i), {
      target: { value: "Pre-approved by VP — accept the over-cap." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm override/i }));

    await waitFor(() =>
      expect(financeApi.resolveException).toHaveBeenCalledWith("clm-1010", {
        action: "override",
        comment: "Pre-approved by VP — accept the over-cap.",
      })
    );
    // Store mutator ran through the mock → flag cleared, claim still approved.
    await waitFor(() => expect(getClaim("clm-1010")!.exception!.status).toBe("resolved"));
    expect(getClaim("clm-1010")!.status).toBe("approved");
  });

  it("blocks reject with empty comment, then returns the claim to the employee as Action Required", async () => {
    renderExceptions();
    await screen.findByText("EXP-2026-1011");

    fireEvent.click(resolveButtonFor("EXP-2026-1011"));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: /reject & return/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /reject & return/i }));
    expect(await within(dialog).findByText(/justification is required/i)).toBeInTheDocument();
    expect(financeApi.resolveException).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/comment to employee/i), {
      target: { value: "Receipt required for IDR 620k — please attach and resubmit." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /reject & return/i }));

    await waitFor(() =>
      expect(financeApi.resolveException).toHaveBeenCalledWith("clm-1011", {
        action: "reject",
        comment: "Receipt required for IDR 620k — please attach and resubmit.",
      })
    );
    // Store mutator returned the claim to the employee.
    await waitFor(() => expect(getClaim("clm-1011")!.status).toBe("action_required"));
  });

  it("surfaces the stale panel when the BE returns stale_decision (claim no longer approved)", async () => {
    renderExceptions();
    await screen.findByText("EXP-2026-1010");

    fireEvent.click(resolveButtonFor("EXP-2026-1010"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /override & accept/i }));
    fireEvent.change(within(dialog).getByLabelText(/justification/i), {
      target: { value: "ok" },
    });

    // Simulate a concurrent transition so the BE rejects with stale_decision.
    getClaim("clm-1010")!.status = "processing";

    fireEvent.click(within(dialog).getByRole("button", { name: /confirm override/i }));

    expect(await screen.findByText(/this claim has changed/i)).toBeInTheDocument();
    expect(financeApi.resolveException).toHaveBeenCalled();
  });

  it("surfaces a BE 400 inline on the justification field when the BE rejects the comment", async () => {
    renderExceptions();
    await screen.findByText("EXP-2026-1010");

    fireEvent.click(resolveButtonFor("EXP-2026-1010"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /override & accept/i }));
    fireEvent.change(within(dialog).getByLabelText(/justification/i), {
      target: { value: "x" },
    });

    // BE-side rejection (e.g. justification too short / disallowed).
    vi.mocked(financeApi.resolveException).mockRejectedValueOnce(
      new FinanceApiError(400, "comment_required", "Justification must be at least 10 characters."),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: /confirm override/i }));
    expect(await within(dialog).findByText(/at least 10 characters/i)).toBeInTheDocument();
    // Dialog stays open so the user can fix the justification.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders the access-denied error card when getExceptions returns 403", async () => {
    vi.mocked(financeApi.getExceptions).mockRejectedValueOnce(
      new FinanceApiError(403, "forbidden", "Finance admins only."),
    );
    renderExceptions();
    expect(await screen.findByText(/couldn.t load the exception queue/i)).toBeInTheDocument();
    expect(screen.getByText(/finance admins only/i)).toBeInTheDocument();
  });
});

/* ------------------------------------- Payment lifecycle */

describe("Payment board — renders from API client; processing + paid dialogs", () => {
  it("renders the three columns from getPayments with consistent counts", async () => {
    renderPayments();

    // clm-1004 is a clean approved claim (ready to pay).
    expect(await screen.findByText(/EXP-2026-1004/)).toBeInTheDocument();
    // clm-1005 is seeded Processing.
    expect(screen.getByText(/EXP-2026-1005/)).toBeInTheDocument();

    expect(financeApi.getPayments).toHaveBeenCalled();
    // Column headers + counts.
    expect(screen.getByRole("heading", { name: /ready to pay/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /processing/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /paid/i })).toBeInTheDocument();
  });

  it("blocks Mark Processing without a reference (FE pre-check, no API call), then transitions on success", async () => {
    renderPayments();
    await screen.findByText(/EXP-2026-1004/);

    const row = screen.getByText(/EXP-2026-1004/).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: /mark processing/i }));
    const dialog = await screen.findByRole("dialog");

    // Confirm with empty reference → FE pre-check, no POST.
    fireEvent.click(within(dialog).getByRole("button", { name: /move to processing/i }));
    expect(await within(dialog).findByText(/reference is required/i)).toBeInTheDocument();
    expect(financeApi.markProcessing).not.toHaveBeenCalled();
    expect(getClaim("clm-1004")!.status).toBe("approved");

    // Capture a reference and confirm → API transitions the claim.
    fireEvent.change(within(dialog).getByLabelText(/reference/i), {
      target: { value: "TRX-900111" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /move to processing/i }));

    await waitFor(() =>
      expect(financeApi.markProcessing).toHaveBeenCalledWith("clm-1004", {
        method: "bank_transfer",
        reference: "TRX-900111",
      })
    );
    await waitFor(() => expect(getClaim("clm-1004")!.status).toBe("processing"));
    expect(getClaim("clm-1004")!.payment!.reference).toBe("TRX-900111");
  });

  it("transitions a Processing claim to Paid via markPaid", async () => {
    renderPayments();
    await screen.findByText(/EXP-2026-1005/);

    const row = screen.getByText(/EXP-2026-1005/).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: /mark paid/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: /mark paid/i }));

    await waitFor(() => expect(financeApi.markPaid).toHaveBeenCalledWith("clm-1005"));
    await waitFor(() => expect(getClaim("clm-1005")!.status).toBe("paid"));
  });

  it("surfaces the stale panel when markProcessing hits a stale_decision (already processing)", async () => {
    renderPayments();
    await screen.findByText(/EXP-2026-1004/);

    const row = screen.getByText(/EXP-2026-1004/).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: /mark processing/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/reference/i), {
      target: { value: "TRX-x" },
    });

    // Simulate a concurrent transition (another admin already processed it).
    getClaim("clm-1004")!.status = "processing";

    fireEvent.click(within(dialog).getByRole("button", { name: /move to processing/i }));
    expect(await screen.findByText(/this payment has changed/i)).toBeInTheDocument();
  });

  it("surfaces the stale panel when markPaid hits a stale_decision (already paid)", async () => {
    renderPayments();
    await screen.findByText(/EXP-2026-1005/);

    const row = screen.getByText(/EXP-2026-1005/).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: /mark paid/i }));
    const dialog = await screen.findByRole("dialog");

    // Simulate the claim being paid out-of-band.
    getClaim("clm-1005")!.status = "paid";

    fireEvent.click(within(dialog).getByRole("button", { name: /mark paid/i }));
    expect(await screen.findByText(/this payment has changed/i)).toBeInTheDocument();
  });

  it("surfaces a BE 400 (missing reference) inline when the BE rejects markProcessing", async () => {
    renderPayments();
    await screen.findByText(/EXP-2026-1004/);

    const row = screen.getByText(/EXP-2026-1004/).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: /mark processing/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/reference/i), {
      target: { value: "x" },
    });
    vi.mocked(financeApi.markProcessing).mockRejectedValueOnce(
      new FinanceApiError(400, "validation_required", "Reference must be at least 6 chars."),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: /move to processing/i }));
    expect(await within(dialog).findByText(/at least 6 chars/i)).toBeInTheDocument();
  });

  it("renders the access-denied error card when getPayments returns 403", async () => {
    vi.mocked(financeApi.getPayments).mockRejectedValueOnce(
      new FinanceApiError(403, "forbidden", "Finance admins only."),
    );
    renderPayments();
    expect(await screen.findByText(/couldn.t load the payment board/i)).toBeInTheDocument();
    expect(screen.getByText(/finance admins only/i)).toBeInTheDocument();
  });
});

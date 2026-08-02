import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/employee/claims/new",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navMocks.push,
    replace: navMocks.replace,
    refresh: vi.fn(),
  }),
  usePathname: () => navMocks.pathname,
  useSearchParams: () => new URLSearchParams(),
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
 * #18: the wizard submits through `useSubmitClaim` → `createClaim` +
 * `submitClaim` + `uploadAttachment` in `@/lib/api/claims`. Mock the module so
 * a submit drives a controllable create→(upload)→submit chain without hitting
 * a backend. `createClaim` returns a claim whose line items mirror the draft
 * count (positional matching is how the hook pairs uploads to created lines).
 */
vi.mock("@/lib/api/claims", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/claims")>();
  let seq = 2000;
  const ids = () => ({ id: `clm-${seq + 1}`, lineId: `li-${seq + 1}-1` });
  return {
    ...actual,
    createClaim: vi.fn(async (draft: { lineItems?: unknown[] }) => {
      seq += 1;
      const { id, lineId } = ids();
      const count = draft.lineItems?.length ?? 0;
      return {
        id,
        reference: `EXP-2026-${seq}`,
        title: "Created",
        purpose: "",
        employeeId: "u-emp-1",
        status: "draft",
        currency: "IDR",
        createdAt: new Date().toISOString(),
        submittedAt: undefined,
        decidedAt: undefined,
        tripStart: undefined,
        tripEnd: undefined,
        destination: undefined,
        lineItems: Array.from({ length: count }, (_, i) => ({
          id: `${lineId}-${i + 1}`,
          categoryId: "flight",
          description: "",
          date: "2026-08-01",
          amount: 0,
          currency: "IDR",
          hasReceipt: false,
        })),
        attachments: [],
        approvals: [],
        exception: undefined,
        currentStepIndex: 0,
      };
    }),
    submitClaim: vi.fn(async (id: string) => ({
      id,
      reference: `EXP-2026-${seq}`,
      title: "Submitted",
      purpose: "",
      employeeId: "u-emp-1",
      status: "pending",
      currency: "IDR",
      createdAt: new Date().toISOString(),
      lineItems: [],
      attachments: [],
      approvals: [],
      exception: undefined,
      currentStepIndex: 0,
    })),
    uploadAttachment: vi.fn(async () => "att-1"),
  };
});

import NewClaimPage from "@/app/employee/claims/new/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import * as claimsApi from "@/lib/api/claims";

function seedEmployee() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-emp-1", role: "employee", issuedAt: Date.now() })
  );
}

async function renderWizard() {
  render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["employee"]}>
            <NewClaimPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
  // SessionProvider resolves the session on a microtask (GET /api/me). Wait
  // for the RouteGuard skeleton to clear before the sync queries run.
  await screen.findByLabelText(/claim title/i);
}

function setInput(labelMatch: RegExp, value: string) {
  const el = screen.getByLabelText(labelMatch) as HTMLInputElement;
  fireEvent.change(el, { target: { value } });
}

function attachFile(lineEl: HTMLElement, fileName: string, mimeType: string) {
  const fileInput = lineEl.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], fileName, { type: mimeType });
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  fireEvent.change(fileInput);
}

/** Fill step 0 with valid values and advance to the Expenses step. */
function goToExpenses() {
  setInput(/claim title/i, "Test Trip");
  setInput(/purpose/i, "Client meeting");
  setInput(/destination/i, "Jakarta");
  setInput(/trip start/i, "2026-08-01");
  setInput(/trip end/i, "2026-08-02");
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

/** Fill the default line with valid values on step 1. */
function fillDefaultLine(
  overrides: { amount?: string; description?: string; date?: string } = {}
) {
  setInput(/description/i, overrides.description ?? "Return flight");
  setInput(/date/i, overrides.date ?? "2026-08-01");
  setInput(/amount \(idr\)/i, overrides.amount ?? "300000");
}

function lineContainer(n: number) {
  return screen.getByLabelText(`Expense ${n}`);
}

function selectCategory(lineEl: HTMLElement, name: string) {
  fireEvent.click(within(lineEl).getByRole("button", { name: /category/i }));
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  localStorage.clear();
  seedEmployee();
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  vi.mocked(claimsApi.createClaim).mockClear();
  vi.mocked(claimsApi.submitClaim).mockClear();
  vi.mocked(claimsApi.uploadAttachment).mockClear();
});

describe("Claim wizard — stepper back/forward preserves data", () => {
  it("preserves trip details when navigating back from expenses", async () => {
    await renderWizard();
    setInput(/claim title/i, "My Preserved Trip");
    setInput(/destination/i, "Bali");
    setInput(/purpose/i, "Offsite");
    setInput(/trip start/i, "2026-08-01");
    setInput(/trip end/i, "2026-08-03");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense lines/i);

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    const titleInput = screen.getByLabelText(/claim title/i) as HTMLInputElement;
    expect(titleInput.value).toBe("My Preserved Trip");
    expect((screen.getByLabelText(/destination/i) as HTMLInputElement).value).toBe("Bali");
  });

  it("preserves line item entries when navigating back from review", async () => {
    await renderWizard();
    goToExpenses();
    fillDefaultLine({ description: "Saved Expense", amount: "250000" });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense summary/i);

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    screen.getByText(/expense lines/i);
    expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe(
      "Saved Expense"
    );
  });
});

describe("Line Item Entry — category, mileage, add/remove", () => {
  it("auto-calculates mileage amount from distance × rate (editable)", async () => {
    await renderWizard();
    goToExpenses();
    const line = lineContainer(1);
    selectCategory(line, "Mileage");

    setInput(/distance \(km\)/i, "50");
    // default rate 1200 → 50 * 1200 = 60000
    const amountInput = within(line).getByLabelText(/amount \(computed/i) as HTMLInputElement;
    expect(amountInput.value).toBe("60000");

    fireEvent.change(amountInput, { target: { value: "55000" } });
    expect(amountInput.value).toBe("55000");
  });

  it("can add and remove line items across categories", async () => {
    await renderWizard();
    goToExpenses();
    fireEvent.click(screen.getByRole("button", { name: /add another expense/i }));
    expect(screen.getByLabelText("Expense 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Expense 2")).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByLabelText("Expense 1")).getByRole("button", {
        name: /remove expense 1/i,
      })
    );
    expect(screen.queryByLabelText("Expense 2")).toBeNull();
    expect(screen.getByLabelText("Expense 1")).toBeInTheDocument();
  });

  it("blocks submission with no line items and shows a clear message", async () => {
    await renderWizard();
    goToExpenses();
    fireEvent.click(
      within(screen.getByLabelText("Expense 1")).getByRole("button", {
        name: /remove expense 1/i,
      })
    );
    screen.getByText(/at least one line item is required/i);

    // Continue is blocked — we stay on the Expenses step.
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense lines/i);
    expect(screen.queryByText(/expense summary/i)).toBeNull();
  });
});

describe("Receipt Attachment (manual) — upload, preview, remove, validation", () => {
  it("attaches an image, shows a removable preview, and keeps manual fields on remove", async () => {
    await renderWizard();
    goToExpenses();
    const line = lineContainer(1);
    fillDefaultLine();
    setInput(/merchant/i, "Garuda Indonesia");

    attachFile(line, "receipt.jpg", "image/jpeg");
    expect(within(line).getByText("receipt.jpg")).toBeInTheDocument();

    fireEvent.click(within(line).getByRole("button", { name: /remove receipt\.jpg/i }));
    expect(within(line).queryByText("receipt.jpg")).toBeNull();
    expect((screen.getByLabelText(/merchant/i) as HTMLInputElement).value).toBe(
      "Garuda Indonesia"
    );
  });

  it("rejects an unsupported file type with a clear error and no broken attachment", async () => {
    await renderWizard();
    goToExpenses();
    const line = lineContainer(1);
    attachFile(line, "notes.txt", "text/plain");

    expect(within(line).getByText(/unsupported file type/i)).toBeInTheDocument();
    expect(within(line).queryByText("notes.txt")).toBeNull();
  });
});

describe("Pre-Submit Policy Check — inline warnings", () => {
  it("warns when a receipt-required threshold is exceeded without an attachment", async () => {
    await renderWizard();
    goToExpenses();
    fillDefaultLine({ amount: "800000" });
    expect(screen.getByText(/flagged for review/i)).toBeInTheDocument();
  });

  it("warns when an amount exceeds the category cap", async () => {
    await renderWizard();
    goToExpenses();
    const line = lineContainer(1);
    selectCategory(line, "Meals"); // cap 350000
    fillDefaultLine({ amount: "400000" });
    expect(screen.getByText(/exceeds the meals cap/i)).toBeInTheDocument();
  });

  it("still allows submission with warnings and routes to the new claim", async () => {
    await renderWizard();
    goToExpenses();
    fillDefaultLine({ amount: "800000", description: "Over-threshold flight" });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense summary/i);

    // review surfaces the warnings banner
    screen.getByText(/policy warning/i);

    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));
    await waitFor(() => expect(navMocks.push).toHaveBeenCalledTimes(1));
    expect(claimsApi.createClaim).toHaveBeenCalledTimes(1);
    expect(claimsApi.submitClaim).toHaveBeenCalledTimes(1);
    const path = navMocks.push.mock.calls[0][0] as string;
    expect(path).toMatch(/^\/employee\/claims\/clm-\d+$/);
  });
});

describe("Submission — success, attachments & failure paths", () => {
  it("creates the draft then submits it and routes to its detail page", async () => {
    await renderWizard();
    goToExpenses();
    fillDefaultLine({ amount: "300000" }); // below threshold → clean
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense summary/i);
    expect(screen.queryByText(/policy warning/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));
    await waitFor(() => expect(navMocks.push).toHaveBeenCalledTimes(1));

    const path = navMocks.push.mock.calls[0][0] as string;
    expect(path).toMatch(/^\/employee\/claims\/clm-\d+$/);

    // createClaim received the draft payload; submitClaim received the created id.
    const draft = vi.mocked(claimsApi.createClaim).mock.calls[0][0];
    expect(draft.title).toBe("Test Trip");
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems![0].amount).toBe(300000);
    const submittedId = vi.mocked(claimsApi.submitClaim).mock.calls[0][0];
    expect(submittedId).toBe(path.split("/").pop());
  });

  it("uploads an attached receipt against the created line id before submit", async () => {
    await renderWizard();
    goToExpenses();
    const line = lineContainer(1);
    fillDefaultLine();
    setInput(/merchant/i, "Garuda Indonesia");
    attachFile(line, "receipt.jpg", "image/jpeg");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense summary/i);

    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));
    await waitFor(() => expect(claimsApi.uploadAttachment).toHaveBeenCalledTimes(1));
    // [claimId, lineItemId, file, meta]
    const [claimId, lineItemId, file, meta] = vi.mocked(claimsApi.uploadAttachment).mock
      .calls[0];
    expect(claimId).toMatch(/^clm-\d+$/);
    expect(lineItemId).toMatch(/^li-/);
    expect((file as File).name).toBe("receipt.jpg");
    expect((meta as { merchant?: string }).merchant).toBe("Garuda Indonesia");

    // submit fired after the upload chain completed.
    await waitFor(() => expect(claimsApi.submitClaim).toHaveBeenCalledTimes(1));
  });

  it("surfaces a BE error (e.g. 400 no line items) inline with a retry action", async () => {
    vi.mocked(claimsApi.createClaim).mockImplementationOnce(async () => {
      throw new claimsApi.ClaimApiError(400, "no_line_items", "At least one line item is required.");
    });

    await renderWizard();
    goToExpenses();
    fillDefaultLine({ amount: "300000" });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense summary/i);
    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));

    expect(await screen.findByText(/at least one line item is required/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // data preserved: review summary still lists the entered line description
    expect(screen.getByText("Return flight")).toBeInTheDocument();
    expect(navMocks.push).not.toHaveBeenCalled();
  });

  it("preserves entered data on a simulated network failure and offers retry", async () => {
    vi.mocked(claimsApi.createClaim).mockImplementationOnce(async () => {
      throw new Error("failed to fetch");
    });

    await renderWizard();
    goToExpenses();
    fillDefaultLine({ amount: "300000" });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense summary/i);
    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));

    expect(await screen.findByText(/failed to fetch/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(navMocks.push).not.toHaveBeenCalled();
  });
});

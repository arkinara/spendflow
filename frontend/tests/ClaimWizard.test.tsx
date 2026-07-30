import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// Wrap createClaim so the simulated-failure test can force a throw without
// affecting other tests. Default implementation is the real store mutation.
vi.mock("@/lib/mock/claimStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mock/claimStore")>();
  return { ...actual, createClaim: vi.fn(actual.createClaim) };
});

import NewClaimPage from "@/app/employee/claims/new/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { getClaim, claims, type ExpenseCategoryId } from "@/lib/mock/mock_data";
import { __removeClaim, createClaim } from "@/lib/mock/claimStore";

function seedEmployee() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-emp-1", role: "employee", issuedAt: Date.now() })
  );
}

function renderWizard() {
  return render(
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
  // The <label htmlFor> associates the "Category" label with the trigger
  // button, so the button's accessible name is "Category" (not "Flight").
  fireEvent.click(within(lineEl).getByRole("button", { name: /category/i }));
  fireEvent.click(screen.getByRole("button", { name }));
}

const createdIds: string[] = [];

beforeEach(() => {
  localStorage.clear();
  seedEmployee();
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  vi.mocked(createClaim).mockClear();
});

afterEach(() => {
  createdIds.splice(0).forEach(__removeClaim);
});

describe("Claim wizard — stepper back/forward preserves data", () => {
  it("preserves trip details when navigating back from expenses", () => {
    renderWizard();
    setInput(/claim title/i, "My Preserved Trip");
    setInput(/destination/i, "Bali");
    setInput(/purpose/i, "Offsite");
    setInput(/trip start/i, "2026-08-01");
    setInput(/trip end/i, "2026-08-03");
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense lines/i);

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    // step 0 remounts the trip-details form
    const titleInput = screen.getByLabelText(/claim title/i) as HTMLInputElement;
    expect(titleInput.value).toBe("My Preserved Trip");
    expect((screen.getByLabelText(/destination/i) as HTMLInputElement).value).toBe("Bali");
  });

  it("preserves line item entries when navigating back from review", () => {
    renderWizard();
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
  it("auto-calculates mileage amount from distance × rate (editable)", () => {
    renderWizard();
    goToExpenses();
    const line = lineContainer(1);
    selectCategory(line, "Mileage");

    setInput(/distance \(km\)/i, "50");
    // default rate 1200 → 50 * 1200 = 60000
    const amountInput = within(line).getByLabelText(/amount \(computed/i) as HTMLInputElement;
    expect(amountInput.value).toBe("60000");

    // editable afterward
    fireEvent.change(amountInput, { target: { value: "55000" } });
    expect(amountInput.value).toBe("55000");
  });

  it("can add and remove line items across categories", () => {
    renderWizard();
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

  it("blocks submission with no line items and shows a clear message", () => {
    renderWizard();
    goToExpenses();
    fireEvent.click(
      within(screen.getByLabelText("Expense 1")).getByRole("button", {
        name: /remove expense 1/i,
      })
    );
    screen.getByText(/at least one line item is required/i);

    // Continue is blocked — we stay on the Expenses step
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense lines/i);
    expect(screen.queryByText(/expense summary/i)).toBeNull();
  });
});

describe("Receipt Attachment (manual) — upload, preview, remove, validation", () => {
  it("attaches an image, shows a removable preview, and keeps manual fields on remove", () => {
    renderWizard();
    goToExpenses();
    const line = lineContainer(1);
    fillDefaultLine();
    setInput(/merchant/i, "Garuda Indonesia");

    attachFile(line, "receipt.jpg", "image/jpeg");
    expect(within(line).getByText("receipt.jpg")).toBeInTheDocument();

    // remove the attachment — manual field must remain intact
    fireEvent.click(within(line).getByRole("button", { name: /remove receipt\.jpg/i }));
    expect(within(line).queryByText("receipt.jpg")).toBeNull();
    expect((screen.getByLabelText(/merchant/i) as HTMLInputElement).value).toBe(
      "Garuda Indonesia"
    );
  });

  it("rejects an unsupported file type with a clear error and no broken attachment", () => {
    renderWizard();
    goToExpenses();
    const line = lineContainer(1);
    attachFile(line, "notes.txt", "text/plain");

    expect(within(line).getByText(/unsupported file type/i)).toBeInTheDocument();
    expect(within(line).queryByText("notes.txt")).toBeNull();
  });
});

describe("Pre-Submit Policy Check — inline warnings", () => {
  it("warns when a receipt-required threshold is exceeded without an attachment", () => {
    renderWizard();
    goToExpenses();
    // Flight line, amount above the 500k threshold, no receipt attached
    fillDefaultLine({ amount: "800000" });
    expect(screen.getByText(/flagged for review/i)).toBeInTheDocument();
  });

  it("warns when an amount exceeds the category cap", () => {
    renderWizard();
    goToExpenses();
    const line = lineContainer(1);
    selectCategory(line, "Meals"); // cap 350000
    fillDefaultLine({ amount: "400000" });
    expect(screen.getByText(/exceeds the meals cap/i)).toBeInTheDocument();
  });

  it("still allows submission with warnings and flags the claim for review", () => {
    renderWizard();
    goToExpenses();
    fillDefaultLine({ amount: "800000", description: "Over-threshold flight" });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense summary/i);

    // review surfaces the warnings banner
    screen.getByText(/policy warning/i);

    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));
    return waitFor(() => expect(navMocks.push).toHaveBeenCalledTimes(1)).then(() => {
      const path = navMocks.push.mock.calls[0][0] as string;
      expect(path).toMatch(/^\/employee\/claims\/clm-\d+$/);
      const id = path.split("/").pop()!;
      createdIds.push(id);
      const claim = getClaim(id);
      expect(claim).toBeTruthy();
      expect(claim!.status).toBe("pending");
      expect(claim!.exception).toBeDefined();
      expect(claim!.exception!.type).toBe("missing_receipt");
    });
  });
});

describe("Submission — success & failure paths", () => {
  it("creates the claim in the mock store with no warnings and routes to its detail page", async () => {
    renderWizard();
    goToExpenses();
    fillDefaultLine({ amount: "300000" }); // below threshold → clean
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense summary/i);
    expect(screen.queryByText(/policy warning/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));
    await waitFor(() => expect(navMocks.push).toHaveBeenCalledTimes(1));

    const path = navMocks.push.mock.calls[0][0] as string;
    expect(path).toMatch(/^\/employee\/claims\/clm-\d+$/);
    const id = path.split("/").pop()!;
    createdIds.push(id);

    const claim = getClaim(id);
    expect(claim).toBeTruthy();
    expect(claim!.status).toBe("pending");
    expect(claim!.title).toBe("Test Trip");
    expect(claim!.lineItems).toHaveLength(1);
    expect(claim!.lineItems[0].amount).toBe(300000);
    expect(claim!.exception).toBeUndefined();
    expect(claims[0].id).toBe(id); // inserted at head of the live store
  });

  it("preserves entered data on simulated submit failure", async () => {
    vi.mocked(createClaim).mockImplementationOnce(() => {
      throw new Error("mock save failed");
    });

    renderWizard();
    goToExpenses();
    fillDefaultLine({ amount: "300000" });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    screen.getByText(/expense summary/i);
    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));

    expect(await screen.findByText(/mock save failed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // data preserved: review summary still lists the entered line description
    expect(screen.getByText("Return flight")).toBeInTheDocument();
    expect(navMocks.push).not.toHaveBeenCalled();
  });
});

describe("claim store unit", () => {
  it("createClaim persists into the live store retrievable by getClaim", () => {
    const before = claims.length;
    const claim = createClaim({
      employeeId: "u-emp-1",
      title: "Unit Claim",
      purpose: "x",
      destination: "Bandung",
      tripStart: "2026-08-01",
      tripEnd: "2026-08-02",
      currency: "IDR",
      lines: [
        {
          categoryId: "taxi" as ExpenseCategoryId,
          description: "Cab",
          date: "2026-08-01",
          amount: 88000,
          currency: "IDR",
        },
      ],
    });
    createdIds.push(claim.id);
    expect(claims.length).toBe(before + 1);
    expect(getClaim(claim.id)?.reference).toBe(claim.reference);
  });
});

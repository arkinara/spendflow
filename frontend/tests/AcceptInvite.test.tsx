import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  token: "tok_secret",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navMocks.push, replace: navMocks.replace, refresh: vi.fn() }),
  usePathname: () => "/invite/tok_secret",
  useParams: () => ({ token: navMocks.token }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * The invite flow mocks `@/lib/api/users` so the page's four panels (ready /
 * expired-or-invalid / consumed / error) and the password form are exercised
 * without a real backend.
 */
const inviteMocks = vi.hoisted(() => ({
  getInvite: vi.fn(),
  acceptInvite: vi.fn(),
}));

vi.mock("@/lib/api/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/users")>();
  return {
    ...actual,
    UsersApiError: actual.UsersApiError,
    getInvite: inviteMocks.getInvite,
    acceptInvite: inviteMocks.acceptInvite,
  };
});

import AcceptInvitePage from "@/app/invite/[token]/page";
import { SessionProvider } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { UsersApiError, type InviteDetails } from "@/lib/api/users";

const DETAILS: InviteDetails = {
  email: "citra.lestari@spendflow.example",
  name: "Citra Lestari",
  role: "approver",
  managerId: null,
  department: "Operations",
  jobTitle: null,
  costCenter: null,
};

function renderPage() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <AcceptInvitePage />
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

async function waitForForm() {
  return await screen.findByRole("heading", { name: /activate your account/i });
}

function fillPassword(password: string, confirm = password) {
  const inputs = screen.getAllByLabelText(/password/i);
  fireEvent.change(inputs[0], { target: { value: password } });
  fireEvent.change(inputs[1], { target: { value: confirm } });
}

beforeEach(() => {
  navMocks.token = "tok_secret";
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  inviteMocks.getInvite.mockReset();
  inviteMocks.acceptInvite.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Accept invite — happy path", () => {
  it("shows the invitee name, email, and role read-only with the help text", async () => {
    inviteMocks.getInvite.mockResolvedValue(DETAILS);
    renderPage();

    await waitForForm();

    // Read-only identity block + assigned-role badge + help text.
    expect(screen.getByText("Citra Lestari")).toBeInTheDocument();
    expect(screen.getByText("citra.lestari@spendflow.example")).toBeInTheDocument();
    expect(screen.getAllByText("Approver").length).toBeGreaterThan(0);
    // Help text "You've been invited as Approver. Set a password to activate your
    // account." renders with the role label as a nested <span>; the textContent
    // of the wrapping <p> is the concatenated string. Assert on the <p> directly.
    const helpNode = document.body.querySelector(
      'p:has(> span.font-medium)'
    ) as HTMLElement | null;
    expect(helpNode?.textContent ?? "").toMatch(
      /You've been invited as\s*Approver\.\s*Set a password to activate/i
    );

    // Two password fields + the activation submit.
    expect(screen.getByRole("button", { name: /activate my account/i })).toBeEnabled();
    expect(inviteMocks.getInvite).toHaveBeenCalledWith("tok_secret");
  });

  it("accepts the invite with a valid password and hard-navigates to the role home", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, replace: vi.fn(), href: "" });
    inviteMocks.getInvite.mockResolvedValue(DETAILS);
    inviteMocks.acceptInvite.mockResolvedValue({
      user: {
        id: "u-new-1",
        name: "Citra Lestari",
        email: "citra.lestari@spendflow.example",
        emailVerified: false,
        image: null,
        role: "approver",
        managerId: null,
        department: "Operations",
        costCenter: null,
        status: "active",
        createdAt: "2026-01-05T00:00:00Z",
        updatedAt: "2026-01-05T00:00:00Z",
      },
    });
    renderPage();
    const form = await waitForForm();

    fillPassword("supersecret1");
    fireEvent.click(screen.getByRole("button", { name: /activate my account/i }));

    await waitFor(() =>
      expect(inviteMocks.acceptInvite).toHaveBeenCalledWith("tok_secret", "supersecret1")
    );
    // Assigned role drives the redirect target (approver → /approver).
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/approver"));
  });
});

describe("Accept invite — token panels", () => {
  it("renders the expired panel on a 410 invite_expired", async () => {
    inviteMocks.getInvite.mockRejectedValue(
      new UsersApiError(410, "invite_expired", "This invitation has expired. Please request a new invite.")
    );
    renderPage();

    expect(
      await screen.findByText(/invitation expired or invalid/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ask your finance admin to send a new invitation/i)
    ).toBeInTheDocument();
    // No activation form, no auto-redirect.
    expect(screen.queryByRole("heading", { name: /activate your account/i })).not.toBeInTheDocument();
  });

  it("renders the expired panel on a 404 invite_invalid", async () => {
    inviteMocks.getInvite.mockRejectedValue(
      new UsersApiError(404, "invite_invalid", "Invitation not found. Please request a new invite.")
    );
    renderPage();

    expect(
      await screen.findByText(/invitation expired or invalid/i)
    ).toBeInTheDocument();
  });

  it("renders the 'already accepted' panel on a 410 invite_consumed", async () => {
    inviteMocks.getInvite.mockRejectedValue(
      new UsersApiError(410, "invite_consumed", "This invitation has already been used.")
    );
    renderPage();

    expect(await screen.findByText(/already accepted/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /activate your account/i })
    ).not.toBeInTheDocument();
  });

  it("renders the expired panel when the URL has no token", async () => {
    navMocks.token = "";
    inviteMocks.getInvite.mockResolvedValue(DETAILS);
    renderPage();

    expect(
      await screen.findByText(/invitation expired or invalid/i)
    ).toBeInTheDocument();
    // getInvite must not fire for a missing token.
    expect(inviteMocks.getInvite).not.toHaveBeenCalled();
  });
});

describe("Accept invite — password validation", () => {
  it("blocks a short password client-side without calling the API", async () => {
    inviteMocks.getInvite.mockResolvedValue(DETAILS);
    renderPage();
    const form = await waitForForm();

    fillPassword("short");
    fireEvent.click(screen.getByRole("button", { name: /activate my account/i }));

    // "At least 8 characters" also appears in the helper text — assert the
    // inline error inside the form's role="alert" region instead.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/at least 8 characters/i)
    );
    expect(inviteMocks.acceptInvite).not.toHaveBeenCalled();
  });

  it("blocks a mismatched confirmation client-side", async () => {
    inviteMocks.getInvite.mockResolvedValue(DETAILS);
    renderPage();
    const form = await waitForForm();

    fillPassword("supersecret1", "different1");
    fireEvent.click(screen.getByRole("button", { name: /activate my account/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(inviteMocks.acceptInvite).not.toHaveBeenCalled();
  });

  it("surfaces a BE 400 invalid_password inline and keeps the form open", async () => {
    inviteMocks.getInvite.mockResolvedValue(DETAILS);
    inviteMocks.acceptInvite.mockRejectedValue(
      new UsersApiError(400, "invalid_password", "Password must be at least 8 characters")
    );
    renderPage();
    const form = await waitForForm();

    fillPassword("supersecret1");
    fireEvent.click(screen.getByRole("button", { name: /activate my account/i }));

    expect(
      await screen.findByText(/password must be at least 8 characters/i)
    ).toBeInTheDocument();
    // Form stays open (no panel swap) — Activate is the retry.
    expect(screen.getByRole("heading", { name: /activate your account/i })).toBeInTheDocument();
  });

  it("swaps to the consumed panel when the BE rejects the accept with 410", async () => {
    inviteMocks.getInvite.mockResolvedValue(DETAILS);
    inviteMocks.acceptInvite.mockRejectedValue(
      new UsersApiError(410, "invite_consumed", "This invitation has already been used.")
    );
    renderPage();
    const form = await waitForForm();

    fillPassword("supersecret1");
    fireEvent.click(screen.getByRole("button", { name: /activate my account/i }));

    expect(await screen.findByText(/already accepted/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /activate your account/i })).not.toBeInTheDocument();
  });
});

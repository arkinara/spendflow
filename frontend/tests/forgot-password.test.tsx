import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const authMocks = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
}));

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    AuthApiError: actual.AuthApiError,
    forgotPassword: authMocks.forgotPassword,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/forgot-password",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ForgotPasswordPage from "@/app/forgot-password/page";
import { SessionProvider } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { AuthApiError } from "@/lib/api/auth";

function renderPage() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <ForgotPasswordPage />
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  authMocks.forgotPassword.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Forgot password — happy path", () => {
  it("submits the email and shows the neutral success copy", async () => {
    authMocks.forgotPassword.mockResolvedValue({
      message: "If an account exists for that email, a reset link has been sent.",
    });
    renderPage();

    const email = await screen.findByLabelText(/work email/i);
    fireEvent.change(email, { target: { value: "user@spendflow.example" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() =>
      expect(authMocks.forgotPassword).toHaveBeenCalledWith("user@spendflow.example")
    );
    expect(
      await screen.findByText(
        /if an account exists for user@spendflow\.example, a reset link was sent/i
      )
    ).toBeInTheDocument();
    // The form is replaced by the success panel.
    expect(screen.queryByRole("button", { name: /send reset link/i })).not.toBeInTheDocument();
  });
});

describe("Forgot password — errors", () => {
  it("blocks a malformed email client-side without calling the API", async () => {
    renderPage();

    const email = await screen.findByLabelText(/work email/i);
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(
      await screen.findByText(/enter a valid email address/i)
    ).toBeInTheDocument();
    expect(authMocks.forgotPassword).not.toHaveBeenCalled();
  });

  it("surfaces the 429 rate_limited retry window inline", async () => {
    authMocks.forgotPassword.mockRejectedValue(
      new AuthApiError(429, "rate_limited", "Too many password-reset requests. Please try again later.", 120)
    );
    renderPage();

    const email = await screen.findByLabelText(/work email/i);
    fireEvent.change(email, { target: { value: "user@spendflow.example" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(
      await screen.findByText(/too many requests\. try again in 120s/i)
    ).toBeInTheDocument();
    // Form stays open for a retry once the window resets.
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
  });
});

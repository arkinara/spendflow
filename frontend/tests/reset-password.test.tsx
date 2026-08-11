import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  token: "tok_reset_secret",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navMocks.push, replace: navMocks.replace, refresh: vi.fn() }),
  usePathname: () => "/reset-password/tok_reset_secret",
  useParams: () => ({ token: navMocks.token }),
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

const authMocks = vi.hoisted(() => ({
  resetPassword: vi.fn(),
}));

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    AuthApiError: actual.AuthApiError,
    resetPassword: authMocks.resetPassword,
  };
});

import ResetPasswordPage from "@/app/reset-password/[token]/page";
import { SessionProvider } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import { AuthApiError } from "@/lib/api/auth";

function renderPage() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <ResetPasswordPage />
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

function fillPasswords(password: string, confirm = password) {
  const inputs = screen.getAllByLabelText(/password/i);
  fireEvent.change(inputs[0], { target: { value: password } });
  fireEvent.change(inputs[1], { target: { value: confirm } });
}

beforeEach(() => {
  navMocks.token = "tok_reset_secret";
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
  authMocks.resetPassword.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Reset password — happy path", () => {
  it("resets the password and routes to /login with a success toast", async () => {
    authMocks.resetPassword.mockResolvedValue({ ok: true });
    renderPage();

    const form = await screen.findByRole("heading", { name: /set a new password/i });
    fillPasswords("supersecret1");
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() =>
      expect(authMocks.resetPassword).toHaveBeenCalledWith("tok_reset_secret", "supersecret1")
    );
    await waitFor(() => expect(navMocks.push).toHaveBeenCalledWith("/login"));
    expect(
      await screen.findByText(/password reset\. please sign in with your new password/i)
    ).toBeInTheDocument();
  });
});

describe("Reset password — errors", () => {
  it("swaps to the invalid/expired panel on a 401 invalid_token", async () => {
    authMocks.resetPassword.mockRejectedValue(
      new AuthApiError(401, "invalid_token", "This reset token is invalid or has expired.")
    );
    renderPage();

    await screen.findByRole("heading", { name: /set a new password/i });
    fillPasswords("supersecret1");
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(
      await screen.findByText(/this reset link is invalid or has expired\. request a new one/i)
    ).toBeInTheDocument();
    // No form, no redirect.
    expect(screen.queryByRole("heading", { name: /set a new password/i })).not.toBeInTheDocument();
    expect(navMocks.push).not.toHaveBeenCalled();
  });

  it("swaps to the already-used panel on a 410 already_used", async () => {
    authMocks.resetPassword.mockRejectedValue(
      new AuthApiError(410, "already_used", "This reset token has already been used.")
    );
    renderPage();

    await screen.findByRole("heading", { name: /set a new password/i });
    fillPasswords("supersecret1");
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(
      await screen.findByText(/this reset link has already been used/i)
    ).toBeInTheDocument();
    expect(navMocks.push).not.toHaveBeenCalled();
  });

  it("surfaces a 422 weak_password inline and keeps the form open", async () => {
    authMocks.resetPassword.mockRejectedValue(
      new AuthApiError(422, "weak_password", "Password must be at least 8 characters")
    );
    renderPage();

    await screen.findByRole("heading", { name: /set a new password/i });
    fillPasswords("supersecret1");
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(
      await screen.findByText(/password must be at least 8 characters/i)
    ).toBeInTheDocument();
    // Form stays open — Reset password is the retry.
    expect(screen.getByRole("heading", { name: /set a new password/i })).toBeInTheDocument();
  });
});

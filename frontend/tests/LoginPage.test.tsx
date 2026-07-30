import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import LoginPage from "@/app/login/page";
import { SessionProvider } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";

function renderLogin() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <LoginPage />
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.push.mockClear();
  mocks.replace.mockClear();
});

describe("LoginPage flow", () => {
  it("blocks submission and creates no session when fields are empty", async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = await screen.findByLabelText(/work email/i);
    const password = screen.getByLabelText(/^password/i);
    await user.clear(email);
    await user.clear(password);
    // Native `required` validation blocks the submit handler from firing.
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(localStorage.getItem("spendflow.session")).toBeNull();
  });

  it("shows an inline error for an unknown email", async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = await screen.findByLabelText(/work email/i);
    await user.clear(email);
    await user.type(email, "nobody@spendflow.example");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("issues a session and routes to the Employee home for valid Employee creds", async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = await screen.findByLabelText(/work email/i);
    const password = screen.getByLabelText(/^password/i);
    await user.clear(email);
    await user.type(email, "aulia.pratiwi@spendflow.example");
    await user.clear(password);
    await user.type(password, "demo1234");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.push).toHaveBeenCalledWith("/employee");
    expect(localStorage.getItem("spendflow.session")).not.toBeNull();
  });

  it("issues a session and routes to Finance home for valid Finance creds", async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = await screen.findByLabelText(/work email/i);
    const password = screen.getByLabelText(/^password/i);
    await user.clear(email);
    await user.type(email, "ridwan.saputra@spendflow.example");
    await user.clear(password);
    await user.type(password, "demo1234");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(mocks.push).toHaveBeenCalledWith("/finance");
  });

  it("presists the session in localStorage after a successful sign-in", async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = await screen.findByLabelText(/work email/i);
    const password = screen.getByLabelText(/^password/i);
    await user.clear(email);
    await user.type(email, "dewi.anggraeni@spendflow.example");
    await user.clear(password);
    await user.type(password, "demo1234");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    const raw = localStorage.getItem("spendflow.session");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).role).toBe("approver");
  });
});

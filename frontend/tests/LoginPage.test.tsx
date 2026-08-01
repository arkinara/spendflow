import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

import LoginPage from "@/app/login/page";
import { SessionProvider, ROLE_HOME } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";

let fetchMock: ReturnType<typeof vi.fn>;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const EMPLOYEE = {
  id: "u-emp-1",
  email: "aulia.pratiwi@spendflow.example",
  name: "Aulia Pratiwi",
  role: "employee",
};
const FINANCE = {
  id: "u-fin-1",
  email: "ridwan.saputra@spendflow.example",
  name: "Ridwan Saputra",
  role: "finance",
};

function renderLogin() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <LoginPage />
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    // Initial session check on mount → unauthenticated so the form renders.
    if (url.includes("/api/me") && method === "GET") {
      return jsonRes(401, { error: { message: "Unauthorized" } });
    }
    return jsonRes(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  mocks.push.mockClear();
  mocks.replace.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("LoginPage flow (BE-backed)", () => {
  it("renders the three demo role preset buttons labelled with the seeded personas", async () => {
    renderLogin();
    await screen.findByLabelText(/work email/i);
    expect(screen.getByRole("button", { name: /sign in as employee/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in as approver/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in as finance/i })).toBeInTheDocument();
  });

  it("blocks submission when fields are empty (native required, no fetch, no route)", async () => {
    const user = userEvent.setup();
    renderLogin();
    const email = await screen.findByLabelText(/work email/i);
    const password = screen.getByLabelText(/^password/i);
    await user.clear(email);
    await user.clear(password);
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // Only the mount-time /api/me call happened — no sign-in POST.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/auth/sign-in/email"))).toHaveLength(0);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("signs in against the BE on valid Employee creds and routes to /employee", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) return jsonRes(401, { error: { message: "Unauthorized" } });
      if (url.includes("/api/auth/sign-in/email")) {
        return jsonRes(200, { user: EMPLOYEE, session: { id: "s1" }, token: "t" });
      }
      return jsonRes(200, {});
    });

    renderLogin();
    const email = await screen.findByLabelText(/work email/i);
    const password = screen.getByLabelText(/^password/i);
    await user.clear(email);
    await user.type(email, EMPLOYEE.email);
    await user.clear(password);
    await user.type(password, "demo1234");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u]) => typeof u === "string" && u.includes("/api/auth/sign-in/email"),
      );
      expect(call).toBeTruthy();
    });

    const signInCall = fetchMock.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("/api/auth/sign-in/email"),
    )!;
    expect(signInCall[1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((signInCall[1] as RequestInit).body as string)).toEqual({
      email: EMPLOYEE.email,
      password: "demo1234",
    });
    expect(mocks.push).toHaveBeenCalledWith(ROLE_HOME.employee);
  });

  it("shows the backend error inline and does not route on invalid credentials", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) return jsonRes(401, { error: { message: "Unauthorized" } });
      if (url.includes("/api/auth/sign-in/email")) {
        return jsonRes(401, { error: { message: "Invalid email or password.", code: "INVALID_PASSWORD" } });
      }
      return jsonRes(200, {});
    });

    renderLogin();
    const email = await screen.findByLabelText(/work email/i);
    const password = screen.getByLabelText(/^password/i);
    await user.clear(email);
    await user.type(email, EMPLOYEE.email);
    await user.clear(password);
    await user.type(password, "wrong-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("Invalid email or password.");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("the Finance preset signs in against the BE and routes to /finance", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me")) return jsonRes(401, { error: { message: "Unauthorized" } });
      if (url.includes("/api/auth/sign-in/email")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        if (body.email === FINANCE.email) {
          return jsonRes(200, { user: FINANCE, session: { id: "s2" }, token: "t2" });
        }
        return jsonRes(401, { error: { message: "Invalid email or password." } });
      }
      return jsonRes(200, {});
    });

    renderLogin();
    await screen.findByLabelText(/work email/i);
    fireEvent.click(screen.getByRole("button", { name: /sign in as finance/i }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(ROLE_HOME.finance));
    const signInCall = fetchMock.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("/api/auth/sign-in/email"),
    )!;
    const body = JSON.parse((signInCall[1] as RequestInit).body as string);
    expect(body.email).toBe(FINANCE.email);
  });
});

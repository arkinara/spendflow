import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import * as React from "react";
import {
  SessionProvider,
  useSession,
  ROLE_HOME,
  DEMO_CREDENTIALS,
  SESSION_STORAGE_KEY,
  type SignInResult,
} from "@/lib/auth/session";

/**
 * SessionProvider tests (#17) — the provider is now backed by the Better Auth
 * HTTP client. `fetch` is mocked per-test; nothing hits a real backend.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

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
  department: "Operations",
};

/** Consumer that surfaces the context value and captures the last signIn result. */
function Probe() {
  const ctx = useSession();
  const [last, setLast] = React.useState<SignInResult | null>(null);
  return (
    <div>
      <span data-testid="status">{ctx.status}</span>
      <span data-testid="role">{ctx.session?.role ?? "none"}</span>
      <span data-testid="user">{ctx.user?.name ?? "none"}</span>
      <span data-testid="last">{last ? (last.ok ? `ok:${last.role}` : `err:${last.error}`) : "none"}</span>
      <button
        data-testid="sign-in"
        onClick={async () => setLast(await ctx.signIn(EMPLOYEE.email, "demo1234"))}
      >
        sign-in
      </button>
      <button
        data-testid="sign-in-bad"
        onClick={async () => setLast(await ctx.signIn(EMPLOYEE.email, "wrong"))}
      >
        sign-in-bad
      </button>
      <button data-testid="sign-out" onClick={() => ctx.signOut()}>
        sign-out
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
}

describe("SessionProvider initial load", () => {
  it("starts loading, then becomes unauthenticated when /api/me returns 401", async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { error: { message: "Unauthorized" } }));
    renderProbe();
    expect(screen.getByTestId("status").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(screen.getByTestId("role").textContent).toBe("none");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/me");
  });

  it("becomes authenticated with the correct role + display user when /api/me returns 200", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { user: EMPLOYEE }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("role").textContent).toBe("employee");
    // Display name comes from the mock fixture (enrichment by id), matching the BE user.
    expect(screen.getByTestId("user").textContent).toBe("Aulia Pratiwi");
  });

  it("enters the error state when /api/me throws (network failure)", async () => {
    fetchMock.mockRejectedValue(new TypeError("failed to fetch"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
  });
});

describe("SessionProvider signIn", () => {
  it("happy path: posts to /api/auth/sign-in/email, becomes authenticated, returns ok + role", async () => {
    fetchMock
      // initial /api/me on mount
      .mockResolvedValueOnce(jsonRes(401, { error: { message: "Unauthorized" } }))
      // signIn call
      .mockResolvedValueOnce(jsonRes(200, { user: EMPLOYEE, session: { id: "s1" }, token: "t" }));

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

    fireEvent.click(screen.getByTestId("sign-in"));

    await waitFor(() => expect(screen.getByTestId("last").textContent).toBe("ok:employee"));
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(screen.getByTestId("role").textContent).toBe("employee");

    const signInCall = fetchMock.mock.calls[1];
    expect(signInCall[0]).toContain("/api/auth/sign-in/email");
    expect(signInCall[1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((signInCall[1] as RequestInit).body as string)).toEqual({
      email: EMPLOYEE.email,
      password: "demo1234",
    });
  });

  it("error path: surfaces the backend message and returns to unauthenticated", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes(401, { error: { message: "Unauthorized" } }))
      .mockResolvedValueOnce(
        jsonRes(401, { error: { message: "Invalid email or password.", code: "INVALID_PASSWORD" } }),
      );

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

    fireEvent.click(screen.getByTestId("sign-in-bad"));

    await waitFor(() => expect(screen.getByTestId("last").textContent).toContain("err:"));
    expect(screen.getByTestId("last").textContent).toContain("Invalid email or password.");
    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
  });
});

describe("SessionProvider signOut", () => {
  it("clears the FE session immediately and POSTs to /api/auth/sign-out", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes(200, { user: EMPLOYEE })) // mount
      .mockResolvedValueOnce(jsonRes(200, {})); // sign-out

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));

    fireEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
    expect(screen.getByTestId("role").textContent).toBe("none");
    const signOutCall = fetchMock.mock.calls[1];
    expect(signOutCall[0]).toContain("/api/auth/sign-out");
    expect(signOutCall[1]).toMatchObject({ method: "POST", credentials: "include" });
  });
});

describe("public surface kept stable", () => {
  it("exports the demo credentials, ROLE_HOME, and the localStorage test key", () => {
    expect(DEMO_CREDENTIALS).toHaveLength(3);
    expect(DEMO_CREDENTIALS.map((c) => c.role).sort()).toEqual(["approver", "employee", "finance"]);
    for (const cred of DEMO_CREDENTIALS) {
      expect(cred.password).toBe("demo1234");
      expect(ROLE_HOME[cred.role]).toBeTruthy();
    }
    expect(SESSION_STORAGE_KEY).toBe("spendflow.session");
  });

  it("signIn/signInAs are async (Promise-returning); context shape unchanged", () => {
    fetchMock.mockResolvedValue(jsonRes(401, { error: { message: "Unauthorized" } }));
    let ctx!: ReturnType<typeof useSession>;
    function CtxProbe() {
      ctx = useSession();
      return null;
    }
    render(
      <SessionProvider>
        <CtxProbe />
      </SessionProvider>,
    );
    // Context exposes the same keys the consumers (RouteGuard/AppBar/RoleSwitcher) read.
    expect(ctx).toHaveProperty("status");
    expect(ctx).toHaveProperty("session");
    expect(ctx).toHaveProperty("user");
    expect(ctx).toHaveProperty("signIn");
    expect(ctx).toHaveProperty("signInAs");
    expect(ctx).toHaveProperty("signOut");
    expect(typeof ctx.signIn).toBe("function");
    expect(typeof ctx.signInAs).toBe("function");
    expect(typeof ctx.signOut).toBe("function");
  });
});

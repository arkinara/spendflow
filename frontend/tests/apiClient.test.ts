import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  signIn,
  signOut,
  getCurrentUser,
  AuthError,
  BE_URL,
} from "@/lib/auth/apiClient";

/**
 * Unit tests for the Better Auth HTTP client (#17). The global `fetch` is
 * mocked per-test so nothing hits a real backend.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("signIn", () => {
  it("POSTs credentials to the Better Auth login URL and returns the parsed user", async () => {
    const user = {
      id: "u-emp-1",
      email: "aulia.pratiwi@spendflow.example",
      name: "Aulia Pratiwi",
      role: "employee",
    };
    fetchMock.mockResolvedValue(jsonResponse(200, { user, session: { id: "s1" }, token: "t" }));

    const result = await signIn("aulia.pratiwi@spendflow.example", "demo1234");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/auth/sign-in/email`);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: "aulia.pratiwi@spendflow.example",
      password: "demo1234",
    });
    expect(result).toEqual(user);
  });

  it("sends content-type: application/json", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { user: { id: "u-1", role: "employee", email: "e", name: "n" } }),
    );
    await signIn("e@x.io", "p");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("throws an AuthError carrying the backend's message on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        error: { message: "Invalid email or password.", code: "INVALID_PASSWORD", status: 401 },
      }),
    );

    await expect(signIn("e@x.io", "wrong")).rejects.toMatchObject({
      name: "AuthError",
      status: 401,
      message: "Invalid email or password.",
    });
  });

  it("falls back to a status-derived message when the body has no message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));

    const err = await signIn("e@x.io", "p").catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).status).toBe(500);
    expect((err as AuthError).message).toContain("500");
  });

  it("throws when the success response is missing the user object", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { session: { id: "s" } }));
    await expect(signIn("e@x.io", "p")).rejects.toBeInstanceOf(AuthError);
  });
});

describe("signOut", () => {
  it("POSTs to the sign-out endpoint and resolves", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await signOut();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/auth/sign-out`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
  });

  it("swallows network errors so the caller can still clear FE state", async () => {
    fetchMock.mockRejectedValue(new TypeError("failed to fetch"));
    await expect(signOut()).resolves.toBeUndefined();
  });
});

describe("getCurrentUser", () => {
  it("returns the parsed user from GET /api/me on 200", async () => {
    const user = {
      id: "u-fin-1",
      email: "ridwan.saputra@spendflow.example",
      name: "Ridwan Saputra",
      role: "finance",
    };
    fetchMock.mockResolvedValue(jsonResponse(200, { user }));

    const result = await getCurrentUser();
    expect(result).toEqual(user);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/me`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
  });

  it("returns null on 401 (no active session)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { message: "Unauthorized", code: "UNAUTHORIZED" } }),
    );
    expect(await getCurrentUser()).toBeNull();
  });

  it("throws an AuthError on other non-2xx responses", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: { message: "boom", code: "INTERNAL" } }),
    );
    await expect(getCurrentUser()).rejects.toMatchObject({
      name: "AuthError",
      status: 500,
      message: "boom",
    });
  });
});

describe("apiFetch 401 wrapper", () => {
  it("invokes the registered unauthorized handler on a 401 and resets the session", async () => {
    const { apiFetch, registerUnauthorizedHandler } = await import("@/lib/api/fetch");
    const handler = vi.fn();
    registerUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { message: "expired" } }));

    const res = await apiFetch("/api/claims");
    expect(res.status).toBe(401);
    expect(handler).toHaveBeenCalledTimes(1);

    registerUnauthorizedHandler(null);
  });

  it("does not fire the handler on a 200 and resolves against BE_URL", async () => {
    const { apiFetch, registerUnauthorizedHandler } = await import("@/lib/api/fetch");
    const handler = vi.fn();
    registerUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));

    const res = await apiFetch("/api/dashboard/inbox");
    expect(res.status).toBe(200);
    expect(handler).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/dashboard/inbox`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });

    registerUnauthorizedHandler(null);
  });

  it("passes absolute URLs through untouched", async () => {
    const { apiFetch, registerUnauthorizedHandler } = await import("@/lib/api/fetch");
    registerUnauthorizedHandler(null);
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await apiFetch("https://cdn.example.com/file.pdf");
    expect(fetchMock.mock.calls[0][0]).toBe("https://cdn.example.com/file.pdf");
  });
});

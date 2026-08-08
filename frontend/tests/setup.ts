import "@testing-library/jest-dom/vitest";
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import type { Role } from "@/lib/types";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom does not implement matchMedia; ThemeProvider reads it on mount.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = () =>
    ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }) as unknown as MediaQueryList;
}

/**
 * Baseline fetch mock shared by every test file.
 *
 * SessionProvider (#17) reads the live session from `GET /api/me` instead of
 * localStorage. So that the Phase 1 vertical tests (claims, approvals, finance,
 * … — tickets #18–#24) keep working unchanged, this mock serves `/api/me` from
 * the same `spendflow.session` localStorage key those tests already seed. Auth
 * tests (`apiClient.test.ts`, `session.test.ts`, `LoginPage.test.tsx`) override
 * `fetch` per-test with their own assertions and never rely on this baseline.
 */
const baselineFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  const method = (init?.method ?? "GET").toUpperCase();

  if (url.includes("/api/me") && method === "GET") {
    const raw = localStorage.getItem("spendflow.session");
    if (!raw) {
      return new Response(
        JSON.stringify({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }
    let sess: {
      userId?: string;
      role?: Role;
      roles?: Role[];
      primaryRole?: Role;
    } = {};
    try {
      sess = JSON.parse(raw);
    } catch {
      sess = {};
    }
    // Hydrate the full multi-role AuthUser shape (#45): default missing
    // `roles`/`primaryRole` from the legacy `role` field so existing
    // single-role test seeds keep working unchanged.
    const primaryRole: Role | undefined = sess.primaryRole ?? sess.role;
    const roles: Role[] = sess.roles ?? (primaryRole ? [primaryRole] : []);
    return new Response(
      JSON.stringify({
        user: { id: sess.userId, role: primaryRole, roles, primaryRole },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  // Default: a benign 200 so any incidental fetch during a vertical test
  // (none expected today) doesn't crash the render under test.
  return new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

vi.stubGlobal("fetch", baselineFetch);

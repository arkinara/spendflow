"use client";

import * as React from "react";
import {
  getUser,
  type Role,
  type User,
} from "@/lib/mock/mock_data";
import {
  getCurrentUser as apiGetCurrentUser,
  signIn as apiSignIn,
  signOut as apiSignOut,
  type AuthUser,
} from "@/lib/auth/apiClient";
import { registerUnauthorizedHandler } from "@/lib/api/fetch";

/**
 * Session provider backed by the Better Auth + Drizzle backend (ticket #17).
 *
 * The httpOnly cookie issued by the BE is the single source of truth — there is
 * NO localStorage persistence. On mount we read `/api/me`; `signIn`/`signInAs`
 * POST to the BE auth endpoints; `signOut` invalidates the server-side session.
 *
 * The React context shape is identical to the prior mock provider so existing
 * consumers (RouteGuard, AppBar, RoleSwitcher, login) keep working unchanged.
 *
 * `SESSION_STORAGE_KEY` is still exported purely as a stable constant that the
 * Phase 1 vitest harness keys its fixtures on (the test setup maps it to a
 * mocked `/api/me` response); production code never reads or writes it.
 */

export const SESSION_STORAGE_KEY = "spendflow.session";
export const DEMO_PASSWORD = "demo1234";

export interface DemoCredential {
  email: string;
  password: string;
  role: Role;
}

/**
 * Seeded demo credentials. These match `backend/src/db/seed.ts` exactly (run
 * `npm run seed` in `backend/`), so the dev-mode role preset buttons sign in
 * against the real BE. NOTE: the ticket body mentioned `*@demo.local` emails,
 * but the actual BE seed (and the existing FE mock personas) use the
 * `*@spendflow.example` addresses below — using `@demo.local` would 401.
 */
export const DEMO_CREDENTIALS: DemoCredential[] = [
  { email: "aulia.pratiwi@spendflow.example", password: DEMO_PASSWORD, role: "employee" },
  { email: "dewi.anggraeni@spendflow.example", password: DEMO_PASSWORD, role: "approver" },
  { email: "ridwan.saputra@spendflow.example", password: DEMO_PASSWORD, role: "finance" },
];

export const ROLE_HOME: Record<Role, string> = {
  employee: "/employee",
  approver: "/approver",
  finance: "/finance",
};

export const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee",
  approver: "Approver",
  finance: "Finance Admin",
};

export interface MockSession {
  userId: string;
  role: Role;
  issuedAt: number;
}

export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export type SignInResult = { ok: true; role: Role } | { ok: false; error: string };

function credentialForRole(role: Role): DemoCredential {
  const cred = DEMO_CREDENTIALS.find((c) => c.role === role);
  if (!cred) throw new Error(`No demo credential registered for role "${role}".`);
  return cred;
}

/**
 * Phase 1 bridge: the BE user carries role + identity, but display fields
 * (`jobTitle`, `avatarColor`) still live in the mock fixtures until #24
 * retires the mocks. We enrich by id so the AppBar / RoleSwitcher render the
 * seeded persona data unchanged. The seeded BE user ids (`u-emp-1`, `u-mgr-1`,
 * `u-fin-1`) intentionally match the mock fixture ids.
 */
function toDisplayUser(authUser: AuthUser): User {
  const mock = getUser(authUser.id);
  if (mock) return mock;
  return {
    id: authUser.id,
    name: authUser.name || authUser.email,
    email: authUser.email,
    role: authUser.role,
    jobTitle: authUser.jobTitle || ROLE_LABEL[authUser.role],
    department: authUser.department || "",
    managerId: authUser.managerId || undefined,
    avatarColor: "primary",
  };
}

export interface SessionContextValue {
  status: SessionStatus;
  session: MockSession | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signInAs: (role: Role) => Promise<SignInResult>;
  signOut: () => void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<SessionStatus>("loading");
  const [session, setSession] = React.useState<MockSession | null>(null);
  const [user, setUser] = React.useState<User | null>(null);

  const applyUser = React.useCallback((authUser: AuthUser) => {
    setUser(toDisplayUser(authUser));
    setSession({ userId: authUser.id, role: authUser.role, issuedAt: Date.now() });
    setStatus("authenticated");
  }, []);

  const reset = React.useCallback(() => {
    setUser(null);
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  // Read the live BE session on mount. The httpOnly cookie is sent with
  // `credentials: "include"`; 401 means "no session" (not an error). Any other
  // failure becomes an explicit error state — never an infinite skeleton.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authUser = await apiGetCurrentUser();
        if (cancelled) return;
        if (authUser) applyUser(authUser);
        else reset();
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUser, reset]);

  // Register the global 401 handler: any `apiFetch()` 401 resets the FE session
  // and routes to `/login?next=<current>`. A hard navigation is used so it
  // fires even on routes without a mounted RouteGuard.
  React.useEffect(() => {
    registerUnauthorizedHandler(() => {
      reset();
      if (
        typeof window !== "undefined" &&
        !window.location.pathname.startsWith("/login")
      ) {
        const next = window.location.pathname + window.location.search;
        window.location.assign(`/login?next=${encodeURIComponent(next)}`);
      }
    });
    return () => registerUnauthorizedHandler(null);
  }, [reset]);

  const signIn = React.useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      setStatus("loading");
      try {
        const authUser = await apiSignIn(email, password);
        applyUser(authUser);
        return { ok: true, role: authUser.role };
      } catch (err) {
        reset();
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Sign-in failed. Please try again.";
        return { ok: false, error: message };
      }
    },
    [applyUser, reset]
  );

  const signInAs = React.useCallback(
    async (role: Role): Promise<SignInResult> => {
      const cred = credentialForRole(role);
      // Optimistically flip to "loading" so an immediate route push (the
      // RoleSwitcher / landing cards fire-and-forget) is seen by RouteGuard as
      // "in flight" rather than "unauthenticated" — preventing a flash
      // redirect to /login before the BE call resolves.
      setStatus("loading");
      return signIn(cred.email, cred.password);
    },
    [signIn]
  );

  const signOut = React.useCallback(() => {
    // Clear FE state first so a slow/unreachable BE still drops the session
    // and routes to /login; the server-side invalidation is fire-and-forget.
    reset();
    void apiSignOut();
  }, [reset]);

  const value = React.useMemo<SessionContextValue>(
    () => ({ status, session, user, signIn, signInAs, signOut }),
    [status, session, user, signIn, signInAs, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

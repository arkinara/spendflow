"use client";

import * as React from "react";
import {
  CURRENT_USER_BY_ROLE,
  getUser,
  type Role,
  type User,
} from "@/lib/mock/mock_data";

/**
 * Mock session provider (Phase 1).
 *
 * NO backend, NO Better Auth — this module is the source of truth for the
 * authenticated session in the web prototype. Three demo credentials back the
 * Employee, Manager/Approver, and Finance Admin roles. The session is persisted
 * to localStorage so it survives reloads; a parse/store failure surfaces as an
 * explicit error state instead of an infinite loading skeleton.
 */

export const SESSION_STORAGE_KEY = "spendflow.session";
export const DEMO_PASSWORD = "demo1234";

export interface MockCredential {
  email: string;
  password: string;
  role: Role;
  userId: string;
}

export const MOCK_CREDENTIALS: MockCredential[] = [
  {
    email: "aulia.pratiwi@spendflow.example",
    password: DEMO_PASSWORD,
    role: "employee",
    userId: "u-emp-1",
  },
  {
    email: "dewi.anggraeni@spendflow.example",
    password: DEMO_PASSWORD,
    role: "approver",
    userId: "u-mgr-1",
  },
  {
    email: "ridwan.saputra@spendflow.example",
    password: DEMO_PASSWORD,
    role: "finance",
    userId: "u-fin-1",
  },
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

export function resolveCredential(email: string): MockCredential | undefined {
  const norm = (email ?? "").trim().toLowerCase();
  return MOCK_CREDENTIALS.find((c) => c.email === norm);
}

/** Pure validation used by both the login form and the unit tests. */
export function validateCredentials(email: string, password: string): SignInResult {
  const e = (email ?? "").trim();
  const p = password ?? "";
  if (!e || !p) {
    return { ok: false, error: "Enter your work email and password." };
  }
  const cred = resolveCredential(e);
  if (!cred) {
    return {
      ok: false,
      error: "We don't recognize that email. Try one of the demo accounts below.",
    };
  }
  if (p !== cred.password) {
    return {
      ok: false,
      error: "Incorrect password. The demo password is demo1234.",
    };
  }
  return { ok: true, role: cred.role };
}

interface SessionContextValue {
  status: SessionStatus;
  session: MockSession | null;
  user: User | null;
  signIn: (email: string, password: string) => SignInResult;
  signInAs: (role: Role) => void;
  signOut: () => void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}

function readStoredSession(): MockSession | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<MockSession>;
  if (
    !parsed ||
    typeof parsed !== "object" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.role !== "string" ||
      !(parsed.role in CURRENT_USER_BY_ROLE)
  ) {
    return null;
  }
  return {
    userId: parsed.userId,
    role: parsed.role as Role,
    issuedAt: typeof parsed.issuedAt === "number" ? parsed.issuedAt : Date.now(),
  };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<SessionStatus>("loading");
  const [session, setSession] = React.useState<MockSession | null>(null);

  // Resolve the persisted session on mount. Any storage/parse failure becomes an
  // explicit error state — never an infinite loading skeleton.
  React.useEffect(() => {
    try {
      const stored = readStoredSession();
      if (stored && getUser(stored.userId)) {
        setSession(stored);
        setStatus("authenticated");
      } else {
        if (stored) window.localStorage.removeItem(SESSION_STORAGE_KEY);
        setStatus("unauthenticated");
      }
    } catch {
      setStatus("error");
    }
  }, []);

  const persist = React.useCallback((next: MockSession) => {
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage may be unavailable (private mode); the in-memory session still
      // holds for the lifetime of this tab.
    }
    setSession(next);
    setStatus("authenticated");
  }, []);

  const signIn = React.useCallback(
    (email: string, password: string): SignInResult => {
      const result = validateCredentials(email, password);
      if (result.ok) {
        const cred = resolveCredential(email)!;
        persist({ userId: cred.userId, role: cred.role, issuedAt: Date.now() });
      }
      return result;
    },
    [persist]
  );

  const signInAs = React.useCallback(
    (role: Role) => {
      persist({
        userId: CURRENT_USER_BY_ROLE[role],
        role,
        issuedAt: Date.now(),
      });
    },
    [persist]
  );

  const signOut = React.useCallback(() => {
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore — in-memory state is the source of truth here
    }
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  const user = session ? getUser(session.userId) ?? null : null;

  const value = React.useMemo<SessionContextValue>(
    () => ({ status, session, user, signIn, signInAs, signOut }),
    [status, session, user, signIn, signInAs, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

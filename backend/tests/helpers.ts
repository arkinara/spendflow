import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createAuth } from "../src/auth/index.js";
import { createApp } from "../src/app.js";
import { createDb, type DB } from "../src/db/index.js";
import { loadEnv, type Env } from "../src/config.js";
import { provisionUser } from "../src/services/provision.js";
import type { Auth } from "../src/auth/index.js";
import type { Hono } from "hono";
import type { Role } from "../src/types.js";

/**
 * Test harness: an isolated in-memory SQLite database with the schema applied
 * and the three SpendFlow demo personas provisioned. Each test that calls
 * {@link bootstrap} gets fully fresh state.
 */

export const DEMO = {
  password: "demo1234",
  employee: { id: "u-emp-1", email: "aulia@spendflow.example", role: "employee" as Role, name: "Aulia Pratiwi", department: "Operations" },
  approver: { id: "u-mgr-1", email: "dewi.anggraeni@spendflow.example", role: "approver" as Role, name: "Dewi Anggraeni", department: "Operations" },
  finance: { id: "u-fin-1", email: "ridwan.saputra@spendflow.example", role: "finance" as Role, name: "Ridwan Saputra", department: "Finance" },
};

export interface Harness {
  app: Hono;
  db: DB;
  auth: Auth;
  env: Env;
  cleanup: () => void;
}

export async function bootstrap(opts: { seed?: boolean } = {}): Promise<Harness> {
  const env = loadEnv({
    databaseUrl: ":memory:",
    betterAuthSecret: "test-secret-do-not-use-in-production-32chars-min",
    betterAuthUrl: "http://localhost:8787",
  });
  const handle = createDb(":memory:");
  migrate(handle.db, { migrationsFolder: "./migrations" });

  if (opts.seed !== false) {
    // Approver first so employees can reference it as manager.
    await provisionUser(handle.db, {
      id: DEMO.approver.id,
      name: DEMO.approver.name,
      email: DEMO.approver.email,
      password: DEMO.password,
      role: "approver",
      department: DEMO.approver.department,
    });
    await provisionUser(handle.db, {
      id: DEMO.employee.id,
      name: DEMO.employee.name,
      email: DEMO.employee.email,
      password: DEMO.password,
      role: "employee",
      managerId: DEMO.approver.id,
      department: DEMO.employee.department,
    });
    await provisionUser(handle.db, {
      id: DEMO.finance.id,
      name: DEMO.finance.name,
      email: DEMO.finance.email,
      password: DEMO.password,
      role: "finance",
      department: DEMO.finance.department,
    });
  }

  const auth = createAuth(handle.db, env);
  const app = createApp({ auth, db: handle.db, env });

  return {
    app,
    db: handle.db,
    auth,
    env,
    cleanup: () => handle.close(),
  };
}

export interface LoginResult {
  status: number;
  cookie: string | null;
  body: unknown;
}

/** POST credentials to the Better Auth login endpoint, capturing the cookie. */
export async function login(
  app: Hono,
  email: string,
  password = DEMO.password
): Promise<LoginResult> {
  const res = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:8787",
    },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : null;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, cookie, body };
}

const ORIGIN = "http://localhost:8787";

function withCookie(cookie: string | null, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { origin: ORIGIN, ...extra };
  if (cookie) h.cookie = cookie;
  return h;
}

export async function authedGet(app: Hono, path: string, cookie: string | null) {
  return app.request(path, { headers: withCookie(cookie) });
}

export async function authedPost(
  app: Hono,
  path: string,
  cookie: string | null,
  body: unknown
) {
  return app.request(path, {
    method: "POST",
    headers: withCookie(cookie, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

export async function authedPatch(
  app: Hono,
  path: string,
  cookie: string | null,
  body: unknown
) {
  return app.request(path, {
    method: "PATCH",
    headers: withCookie(cookie, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

export async function logout(app: Hono, cookie: string) {
  return app.request("/api/auth/sign-out", {
    method: "POST",
    headers: withCookie(cookie),
  });
}

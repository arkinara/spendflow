import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth } from "../src/auth/index.js";
import { createApp } from "../src/app.js";
import { createDb, type DB } from "../src/db/index.js";
import {
  approvalRoutesTable,
  approvalStepsTable,
  categoriesTable,
  policiesTable,
} from "../src/db/schema.js";
import { loadEnv, type Env } from "../src/config.js";
import { provisionUser } from "../src/services/provision.js";
import type { Auth } from "../src/auth/index.js";
import type { Hono } from "hono";
import type { Role } from "../src/types.js";

/**
 * Test harness: an isolated in-memory SQLite database with the schema applied,
 * the three SpendFlow demo personas provisioned, and the Phase 1 categories +
 * default approval route seeded. Each test that calls {@link bootstrap} gets
 * fully fresh state.
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

/** Seed the Phase 1 categories + policies + default fallback approval route. */
function seedCatalog(db: DB) {
  const now = new Date();
  const cats: Array<{
    id: string; name: string; code: string;
    requiresReceipt: boolean; receiptThreshold: number;
    perItemCap: number | null; mileageRate: number | null; active: boolean;
  }> = [
    { id: "flight", name: "Flight", code: "FLT", requiresReceipt: true, receiptThreshold: 500_000, perItemCap: null, mileageRate: null, active: true },
    { id: "hotel", name: "Hotel", code: "HTL", requiresReceipt: true, receiptThreshold: 500_000, perItemCap: 1_200_000, mileageRate: null, active: true },
    { id: "meals", name: "Meals", code: "MEL", requiresReceipt: true, receiptThreshold: 250_000, perItemCap: 350_000, mileageRate: null, active: true },
    { id: "taxi", name: "Taxi", code: "TAX", requiresReceipt: false, receiptThreshold: 200_000, perItemCap: null, mileageRate: null, active: true },
    { id: "mileage", name: "Mileage", code: "KIL", requiresReceipt: false, receiptThreshold: 0, perItemCap: null, mileageRate: 1_200, active: true },
    { id: "other", name: "Other", code: "OTH", requiresReceipt: true, receiptThreshold: 250_000, perItemCap: null, mileageRate: null, active: true },
  ];
  for (const c of cats) {
    const exists = db.select({ id: categoriesTable.id }).from(categoriesTable).where(eq(categoriesTable.id, c.id)).get();
    if (exists) continue;
    db.insert(categoriesTable).values({
      id: c.id, name: c.name, code: c.code, requiresReceipt: c.requiresReceipt,
      receiptThreshold: c.receiptThreshold, perItemCap: c.perItemCap, mileageRate: c.mileageRate,
      active: c.active, createdAt: now, updatedAt: now,
    }).run();
  }

  const pols: Array<{
    id: string; name: string; description: string; categoryId: string | null;
    limitAmount: number | null; receiptRequired: boolean;
    receiptRequiredAbove: number; justificationRequiredAbove: number;
  }> = [
    { id: "pol-1", name: "Hotel nightly cap", description: "Hotel cap", categoryId: "hotel", limitAmount: 1_200_000, receiptRequired: true, receiptRequiredAbove: 500_000, justificationRequiredAbove: 1_200_000 },
    { id: "pol-2", name: "Meal daily allowance", description: "Meal cap", categoryId: "meals", limitAmount: 350_000, receiptRequired: true, receiptRequiredAbove: 250_000, justificationRequiredAbove: 350_000 },
    { id: "pol-3", name: "Receipt requirement", description: "Global receipt", categoryId: null, limitAmount: null, receiptRequired: true, receiptRequiredAbove: 500_000, justificationRequiredAbove: 1_000_000 },
  ];
  for (const p of pols) {
    const exists = db.select({ id: policiesTable.id }).from(policiesTable).where(eq(policiesTable.id, p.id)).get();
    if (exists) continue;
    db.insert(policiesTable).values({
      id: p.id, name: p.name, description: p.description, categoryId: p.categoryId,
      limitAmount: p.limitAmount, period: "per_item", currency: "IDR",
      receiptRequired: p.receiptRequired, receiptRequiredAbove: p.receiptRequiredAbove,
      justificationRequiredAbove: p.justificationRequiredAbove,
      effectiveDate: "2026-01-01", active: true, createdAt: now, updatedAt: now,
    }).run();
  }

  // Default fallback approval route: single step routed to the submitter's
  // line manager. Tests that need a multi-step route insert their own.
  const routeExists = db.select({ id: approvalRoutesTable.id }).from(approvalRoutesTable).where(eq(approvalRoutesTable.id, "rt-default")).get();
  if (!routeExists) {
    db.transaction((tx) => {
      tx.insert(approvalRoutesTable).values({
        id: "rt-default", name: "Standard claim (fallback)",
        matchMinAmount: null, matchMaxAmount: null, matchDepartment: null,
        isFallback: true, active: true, createdAt: now, updatedAt: now,
      }).run();
      tx.insert(approvalStepsTable).values({
        id: "rt-default-s1", routeId: "rt-default", orderIndex: 0,
        approverType: "submitter_manager", approverId: null, label: "Line manager",
        createdAt: now, updatedAt: now,
      }).run();
    });
  }
}

export async function bootstrap(opts: { seed?: boolean } = {}): Promise<Harness> {
  // Per-test uploads dir on disk so attachment tests don't collide and don't
  // pollute the repo. Cleaned up on harness teardown.
  const uploads = mkdtempSync(join(tmpdir(), "spendflow-uploads-"));
  const env = loadEnv({
    databaseUrl: ":memory:",
    betterAuthSecret: "test-secret-do-not-use-in-production-32chars-min",
    betterAuthUrl: "http://localhost:8787",
    uploadsDir: uploads,
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
    seedCatalog(handle.db);
  }

  const auth = createAuth(handle.db, env);
  const app = createApp({ auth, db: handle.db, env });

  return {
    app,
    db: handle.db,
    auth,
    env,
    cleanup: () => {
      handle.close();
      rmSync(uploads, { recursive: true, force: true });
    },
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

/** POST a multipart/form-data body (file upload + manual metadata fields). */
export async function authedPostForm(
  app: Hono,
  path: string,
  cookie: string | null,
  fields: Record<string, string | Blob>,
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return app.request(path, {
    method: "POST",
    headers: withCookie(cookie),
    body: form,
  });
}

export async function authedDelete(app: Hono, path: string, cookie: string | null) {
  return app.request(path, { method: "DELETE", headers: withCookie(cookie) });
}

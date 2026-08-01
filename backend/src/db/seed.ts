import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb } from "./index.js";
import {
  approvalRoutesTable,
  approvalStepsTable,
  categoriesTable,
  policiesTable,
  usersTable,
} from "./schema.js";
import { loadEnv } from "../config.js";
import { provisionUser } from "../services/provision.js";
import type { Role } from "../types.js";

/**
 * Seed the dev database with the three SpendFlow demo personas used across the
 * Phase 1 web app (matching the frontend mock credentials). Idempotent: skips
 * users that already exist by email.
 *
 * Run with `npm run db:migrate && npm run seed`.
 */
const SEED_PASSWORD = "demo1234";

const SEED_USERS: Array<{
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId?: string;
  department?: string;
}> = [
  {
    id: "u-mgr-1",
    name: "Dewi Anggraeni",
    email: "dewi.anggraeni@spendflow.example",
    role: "approver",
    department: "Operations",
  },
  {
    id: "u-emp-1",
    name: "Aulia Pratiwi",
    email: "aulia.pratiwi@spendflow.example",
    role: "employee",
    managerId: "u-mgr-1",
    department: "Operations",
  },
  {
    id: "u-fin-1",
    name: "Ridwan Saputra",
    email: "ridwan.saputra@spendflow.example",
    role: "finance",
    department: "Finance",
  },
];

/**
 * Phase 1 expense categories. `mileage_rate` is set only on the mileage
 * category; the claimStore reads it to compute amount = quantity × rate
 * server-side. Values mirror the frontend mock fixtures.
 */
const SEED_CATEGORIES: Array<{
  id: string;
  name: string;
  code: string;
  requiresReceipt: boolean;
  receiptThreshold: number;
  perItemCap: number | null;
  mileageRate: number | null;
  active: boolean;
}> = [
  { id: "flight", name: "Flight", code: "FLT", requiresReceipt: true, receiptThreshold: 500_000, perItemCap: null, mileageRate: null, active: true },
  { id: "hotel", name: "Hotel", code: "HTL", requiresReceipt: true, receiptThreshold: 500_000, perItemCap: 1_200_000, mileageRate: null, active: true },
  { id: "meals", name: "Meals", code: "MEL", requiresReceipt: true, receiptThreshold: 250_000, perItemCap: 350_000, mileageRate: null, active: true },
  { id: "taxi", name: "Taxi / Ride-hailing", code: "TAX", requiresReceipt: false, receiptThreshold: 200_000, perItemCap: null, mileageRate: null, active: true },
  { id: "mileage", name: "Mileage", code: "KIL", requiresReceipt: false, receiptThreshold: 0, perItemCap: null, mileageRate: 1_200, active: true },
  { id: "other", name: "Other", code: "OTH", requiresReceipt: true, receiptThreshold: 250_000, perItemCap: null, mileageRate: null, active: true },
];

/**
 * Phase 1 spend policies. Consumed by the pure policy engine at submission.
 * Mirror the frontend mock fixtures so flagged warnings match the seeded
 * claim scenarios end to end.
 */
const SEED_POLICIES: Array<{
  id: string;
  name: string;
  description: string;
  categoryId: string | null;
  limitAmount: number | null;
  receiptRequired: boolean;
  receiptRequiredAbove: number;
  justificationRequiredAbove: number;
}> = [
  { id: "pol-1", name: "Hotel nightly cap", description: "Maximum reimbursable hotel rate per night for domestic travel.", categoryId: "hotel", limitAmount: 1_200_000, receiptRequired: true, receiptRequiredAbove: 500_000, justificationRequiredAbove: 1_200_000 },
  { id: "pol-2", name: "Meal daily allowance", description: "Combined meals per day while travelling.", categoryId: "meals", limitAmount: 350_000, receiptRequired: true, receiptRequiredAbove: 250_000, justificationRequiredAbove: 350_000 },
  { id: "pol-3", name: "Receipt requirement", description: "Any single expense above IDR 500,000 requires an attached receipt.", categoryId: null, limitAmount: null, receiptRequired: true, receiptRequiredAbove: 500_000, justificationRequiredAbove: 1_000_000 },
  { id: "pol-5", name: "Mileage rate", description: "Personal vehicle mileage reimbursed at a fixed rate.", categoryId: "mileage", limitAmount: 1_200, receiptRequired: false, receiptRequiredAbove: 0, justificationRequiredAbove: 0 },
];

/**
 * Default approval routes. Every claim auto-resolves to a route on submit; the
 * fallback ("Standard claim") catches anything the specific routes miss so a
 * claim is never left unrouted.
 */
const SEED_ROUTES: Array<{
  route: {
    id: string;
    name: string;
    matchMinAmount: number | null;
    matchMaxAmount: number | null;
    matchDepartment: string | null;
    isFallback: boolean;
    active: boolean;
  };
  steps: Array<{
    id: string;
    orderIndex: number;
    approverType: "submitter_manager" | "specific_user" | "finance";
    approverId: string | null;
    label: string;
  }>;
}> = [
  {
    route: {
      id: "rt-default",
      name: "Standard claim (fallback)",
      matchMinAmount: null,
      matchMaxAmount: null,
      matchDepartment: null,
      isFallback: true,
      active: true,
    },
    steps: [
      { id: "rt-default-s1", orderIndex: 0, approverType: "submitter_manager", approverId: null, label: "Line manager" },
    ],
  },
];

async function main() {
  const env = loadEnv();
  const handle = createDb(env.databaseUrl);
  migrate(handle.db, { migrationsFolder: "./migrations" });

  let created = 0;
  for (const u of SEED_USERS) {
    const exists = handle.db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, u.email))
      .get();
    if (exists) {
      console.log(`  · ${u.email} already exists, skipping`);
      continue;
    }
    await provisionUser(handle.db, {
      id: u.id,
      name: u.name,
      email: u.email,
      password: SEED_PASSWORD,
      role: u.role,
      managerId: u.managerId ?? null,
      department: u.department ?? null,
    });
    console.log(`  ✓ seeded ${u.role.padEnd(8)} ${u.email}`);
    created++;
  }

  // Categories (idempotent by id).
  let catsCreated = 0;
  const now = new Date();
  for (const c of SEED_CATEGORIES) {
    const exists = handle.db
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(eq(categoriesTable.id, c.id))
      .get();
    if (exists) continue;
    handle.db
      .insert(categoriesTable)
      .values({
        id: c.id,
        name: c.name,
        code: c.code,
        requiresReceipt: c.requiresReceipt,
        receiptThreshold: c.receiptThreshold,
        perItemCap: c.perItemCap,
        mileageRate: c.mileageRate,
        active: c.active,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    catsCreated++;
  }
  console.log(`  ✓ ${catsCreated} category(ies) seeded`);

  // Policies (idempotent by id).
  let polsCreated = 0;
  for (const p of SEED_POLICIES) {
    const exists = handle.db
      .select({ id: policiesTable.id })
      .from(policiesTable)
      .where(eq(policiesTable.id, p.id))
      .get();
    if (exists) continue;
    handle.db
      .insert(policiesTable)
      .values({
        id: p.id,
        name: p.name,
        description: p.description,
        categoryId: p.categoryId,
        limitAmount: p.limitAmount,
        period: "per_item",
        currency: "IDR",
        receiptRequired: p.receiptRequired,
        receiptRequiredAbove: p.receiptRequiredAbove,
        justificationRequiredAbove: p.justificationRequiredAbove,
        effectiveDate: "2026-01-01",
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    polsCreated++;
  }
  console.log(`  ✓ ${polsCreated} polic(ies) seeded`);

  // Approval routes + steps (idempotent by route id).
  let routesCreated = 0;
  for (const r of SEED_ROUTES) {
    const exists = handle.db
      .select({ id: approvalRoutesTable.id })
      .from(approvalRoutesTable)
      .where(eq(approvalRoutesTable.id, r.route.id))
      .get();
    if (exists) continue;
    handle.db.transaction((tx) => {
      tx.insert(approvalRoutesTable)
        .values({
          id: r.route.id,
          name: r.route.name,
          matchMinAmount: r.route.matchMinAmount,
          matchMaxAmount: r.route.matchMaxAmount,
          matchDepartment: r.route.matchDepartment,
          isFallback: r.route.isFallback,
          active: r.route.active,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const s of r.steps) {
        tx.insert(approvalStepsTable)
          .values({
            id: s.id,
            routeId: r.route.id,
            orderIndex: s.orderIndex,
            approverType: s.approverType,
            approverId: s.approverId,
            label: s.label,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    });
    routesCreated++;
  }
  console.log(`  ✓ ${routesCreated} approval route(s) seeded`);

  console.log(`\nDone. ${created} user(s) seeded. Demo password: ${SEED_PASSWORD}`);
  handle.close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb } from "./index.js";
import { usersTable } from "./schema.js";
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
  console.log(`\nDone. ${created} user(s) seeded. Demo password: ${SEED_PASSWORD}`);
  handle.close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

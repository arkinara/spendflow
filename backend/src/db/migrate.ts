import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, resolveDbPath } from "./index.js";
import { loadEnv } from "../config.js";

/**
 * Apply pending Drizzle migrations to the configured SQLite database. Creates
 * the file (and parent dir) if missing. Run via `npm run db:migrate`.
 */
async function main() {
  const env = loadEnv();
  const dbPath = resolveDbPath(env.databaseUrl);
  const handle = createDb(env.databaseUrl);
  try {
    migrate(handle.db, { migrationsFolder: "./migrations" });
    console.log(`✓ migrations applied → ${dbPath}`);
  } finally {
    handle.close();
  }
}

main().catch((err) => {
  console.error("✗ migration failed:", err);
  process.exit(1);
});

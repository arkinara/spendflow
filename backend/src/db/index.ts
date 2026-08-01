import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { schema } from "./schema.js";
import { loadEnv } from "../config.js";

export type DB = BetterSQLite3Database<typeof schema>;

/**
 * Resolve a SQLite file path from a `DATABASE_URL`-style value. Accepts both a
 * bare path and the `file:` URI form used across the codebase.
 */
export function resolveDbPath(databaseUrl: string): string {
  const raw = databaseUrl.trim();
  const stripped = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  // SQLite special name ":memory:" must be preserved verbatim.
  if (stripped === ":memory:") return stripped;
  return stripped;
}

export interface DbHandle {
  db: DB;
  sqlite: Database.Database;
  close: () => void;
}

/**
 * Create a Drizzle handle over a better-sqlite3 connection. Foreign keys are
 * enabled so the `users.manager_id` self-FK and session/account cascades hold.
 */
export function createDb(databaseUrl: string): DbHandle {
  const dbPath = resolveDbPath(databaseUrl);
  const inMemory = dbPath === ":memory:";
  const sqlite = new Database(dbPath);
  // WAL requires a file; :memory: databases keep everything in RAM.
  if (!inMemory) sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}

export { schema };

/** Default singleton handle, lazily created from the process env. */
let defaultHandle: DbHandle | null = null;

export function getDefaultDb(): DbHandle {
  if (!defaultHandle) {
    const env = loadEnv();
    defaultHandle = createDb(env.databaseUrl);
  }
  return defaultHandle;
}

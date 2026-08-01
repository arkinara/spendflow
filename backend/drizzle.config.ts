import { defineConfig } from "drizzle-kit";
import "dotenv/config";

const url = process.env.DATABASE_URL ?? "file:./dev.db";

// Drizzle expects a bare path/URL for better-sqlite3. Strip the leading
// `file:` prefix so the migrator can open the file directly.
const dbPath = url.startsWith("file:") ? url.slice("file:".length) : url;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
  strict: true,
});

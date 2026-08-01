import { serve } from "@hono/node-server";
import { createAuth } from "./auth/index.js";
import { createApp } from "./app.js";
import { getDefaultDb } from "./db/index.js";
import { loadEnv } from "./config.js";

/**
 * Standalone Hono server entry. Run with `npm run dev` (tsx watch) or
 `npm start` (compiled). Phase 1 web wiring is BE-#11; this process exposes
 * the auth + admin API consumed by every downstream backend domain.
 */
async function main() {
  const env = loadEnv();
  const handle = getDefaultDb();
  const auth = createAuth(handle.db, env);
  const app = createApp({ auth, db: handle.db, env });

  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`SpendFlow backend listening on http://localhost:${info.port}`);
    console.log(`  Better Auth → ${env.betterAuthUrl}/api/auth/*`);
  });
}

main().catch((err) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});

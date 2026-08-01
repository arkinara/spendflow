/**
 * Per-run vitest setup. Backend tests build isolated in-memory databases, so
 * there is no global state to seed here; this file pins deterministic crypto
 * defaults and silences Better Auth's dev-only secret warning.
 */
import { beforeAll } from "vitest";

beforeAll(() => {
  if (!process.env.BETTER_AUTH_SECRET) {
    process.env.BETTER_AUTH_SECRET =
      "test-secret-do-not-use-in-production-32chars-min";
  }
  if (!process.env.BETTER_AUTH_URL) {
    process.env.BETTER_AUTH_URL = "http://localhost:8787";
  }
});

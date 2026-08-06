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
  // Tests must never hit the real Resend API or a dev .env — unset these so
  // the invite service always takes the log-fallback path unless a test
  // explicitly sets them.
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.FE_URL;
});

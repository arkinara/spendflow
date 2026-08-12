import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO, bootstrap, login, type Harness } from "./helpers.js";
import { provisionUser } from "../src/services/provision.js";

/* ============================================================================
 * #70 — destructive admin endpoint rate limits.
 *
 * Three IP-keyed limiter tiers are wired in admin.ts / invites.ts / app.ts:
 *   adminMutationLimiter  60/IP/hour  (create/update/deactivate + user-create)
 *   adminBulkLimiter      30/IP/hour  (bulk approve/reject/pay)
 *   adminDeleteLimiter    10/IP/hour  (hard delete)
 *
 * Each test gets a fresh app via bootstrap() → fresh limiter state, so the
 * buckets start empty every time.
 * ========================================================================== */

let h: Harness;
let cookie: string;

beforeEach(async () => {
  h = await bootstrap();
  cookie = (await login(h.app, DEMO.finance.email)).cookie!;
});
afterEach(() => h.cleanup());

/** POST as the Finance Admin from a specific client IP (X-Forwarded-For). */
async function postFrom(path: string, ip: string, body: unknown) {
  return h.app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookie,
      "x-forwarded-for": ip,
      origin: "http://localhost:8787",
    },
    body: JSON.stringify(body),
  });
}

describe("admin destructive endpoint rate limits (#70)", () => {
  it("POST /api/admin/users: 60 creates from one IP succeed; 61st returns 429", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 60; i++) {
      const res = await postFrom("/api/admin/users", ip, {
        email: `rl-${i}@spendflow.example`,
        name: `RL User ${i}`,
        role: "employee",
      });
      expect(res.status).toBe(201);
    }
    const blocked = await postFrom("/api/admin/users", ip, {
      email: "rl-overflow@spendflow.example",
      name: "RL Overflow",
      role: "employee",
    });
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.retry_after_seconds).toBeGreaterThan(0);
  });

  it("POST /api/admin/users/:id/delete: 10 deletes from one IP succeed; 11th returns 429", async () => {
    const ip = "203.0.113.20";
    // Provision 10 deletable victims (hard-delete rejects active users with
    // 409, so seed them as disabled — same pattern as users.delete.test.ts).
    for (let i = 0; i < 10; i++) {
      await provisionUser(h.db, {
        id: `u-del-${i}`,
        name: `Del ${i}`,
        email: `del-${i}@spendflow.example`,
        password: DEMO.password,
        role: "employee",
        status: "disabled",
      });
    }
    for (let i = 0; i < 10; i++) {
      const res = await postFrom(`/api/admin/users/u-del-${i}/delete`, ip, {
        password: DEMO.password,
      });
      expect(res.status).toBe(204);
    }
    const blocked = await postFrom("/api/admin/users/any-id/delete", ip, {
      password: DEMO.password,
    });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("rate_limited");
  });

  it("POST /api/admin/claims/bulk-pay: 30 requests from one IP pass the limiter; 31st returns 429", async () => {
    const ip = "203.0.113.30";
    // Fire 30 requests with an empty body — the limiter admits each (token
    // consumed), then the handler returns 400 invalid_body. This isolates the
    // limiter behaviour from the bulk-pay business logic (no claim setup
    // needed). The assertion `status !== 429` proves the limiter let it
    // through; the 31th is the only one the limiter blocks.
    for (let i = 0; i < 30; i++) {
      const res = await postFrom("/api/admin/claims/bulk-pay", ip, {});
      expect(res.status).not.toBe(429);
    }
    const blocked = await postFrom("/api/admin/claims/bulk-pay", ip, {});
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("rate_limited");
  });

  it("a 429 response carries X-RateLimit-Limit/Remaining/Reset headers", async () => {
    const ip = "203.0.113.40";
    // Exhaust the delete limiter (10 hits) with empty bodies; the limiter
    // counts the request before the handler rejects it.
    for (let i = 0; i < 10; i++) {
      const res = await postFrom("/api/admin/users/any/delete", ip, {});
      expect(res.status).not.toBe(429);
    }
    const blocked = await postFrom("/api/admin/users/any/delete", ip, {});
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(blocked.headers.get("X-RateLimit-Reset")).not.toBeNull();
  });

  it("a different IP is independent of the limit (multi-tenant case)", async () => {
    const ipA = "203.0.113.50";
    const ipB = "198.51.100.60";
    // Exhaust ipA's delete limiter.
    for (let i = 0; i < 10; i++) {
      await postFrom("/api/admin/users/any/delete", ipA, {});
    }
    const blockedA = await postFrom("/api/admin/users/any/delete", ipA, {});
    expect(blockedA.status).toBe(429);
    // ipB still has its full budget — a real delete succeeds.
    await provisionUser(h.db, {
      id: "u-b-0",
      name: "B 0",
      email: "b-0@spendflow.example",
      password: DEMO.password,
      role: "employee",
      status: "disabled",
    });
    const okB = await postFrom("/api/admin/users/u-b-0/delete", ipB, {
      password: DEMO.password,
    });
    expect(okB.status).toBe(204);
  });
});

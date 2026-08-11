import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "../src/middleware/rate-limit.js";

/* ============================================================================
 * #69 — in-memory rate-limit middleware.
 *
 * Uses an injected mock clock so the fixed window can be advanced
 * deterministically without `vi.useFakeTimers` (which would also affect the
 * periodic GC timer the middleware installs).
 * ========================================================================== */

interface FakeClock {
  now: number;
}

function makeApp(clock: FakeClock, limit = 3, windowMs = 60_000) {
  const { middleware } = rateLimit({
    limit,
    windowMs,
    blockMessage: "Too many requests.",
    now: () => clock.now,
  });
  const app = new Hono();
  app.use("/ping", middleware);
  app.get("/ping", (c) => c.json({ ok: true }));
  return app;
}

async function hit(app: Hono, ip = "203.0.113.1") {
  return app.request("/ping", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("rateLimit middleware (#69)", () => {
  it("admits requests under the limit and sets X-RateLimit-* headers", async () => {
    const clock = { now: 1_000_000 };
    const app = makeApp(clock, 3, 60_000);
    const res = await hit(app);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("2");
    // Reset is the ceiling of (now + window) in seconds.
    expect(res.headers.get("X-RateLimit-Reset")).toBe(
      String(Math.ceil((1_000_000 + 60_000) / 1000)),
    );
  });

  it("decrements Remaining on each subsequent hit within the window", async () => {
    const clock = { now: 1_000_000 };
    const app = makeApp(clock, 3, 60_000);
    const r1 = await hit(app);
    const r2 = await hit(app);
    const r3 = await hit(app);
    expect(r1.headers.get("X-RateLimit-Remaining")).toBe("2");
    expect(r2.headers.get("X-RateLimit-Remaining")).toBe("1");
    expect(r3.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
  });

  it("returns 429 with the documented envelope once the limit is exceeded", async () => {
    const clock = { now: 1_000_000 };
    const app = makeApp(clock, 2, 60_000);
    await hit(app);
    await hit(app);
    const blocked = await hit(app);
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toMatchObject({
      code: "rate_limited",
      message: "Too many requests.",
    });
    expect(body.error.retry_after_seconds).toBeGreaterThan(0);
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("resets the window after windowMs elapses (mock clock)", async () => {
    const clock = { now: 1_000_000 };
    const app = makeApp(clock, 2, 60_000);
    await hit(app);
    await hit(app);
    const blocked = await hit(app);
    expect(blocked.status).toBe(429);
    // Advance past the window: bucket should roll over and admit again.
    clock.now += 60_001;
    const ok = await hit(app);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("X-RateLimit-Remaining")).toBe("1");
  });

  it("isolates buckets per key (different IPs do not starve each other)", async () => {
    const clock = { now: 1_000_000 };
    const app = makeApp(clock, 1, 60_000);
    const a = await hit(app, "203.0.113.1");
    const b = await hit(app, "198.51.100.7");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const aBlocked = await hit(app, "203.0.113.1");
    expect(aBlocked.status).toBe(429);
  });

  it("GC drops expired buckets so the Map does not grow unboundedly", async () => {
    const clock = { now: 1_000_000 };
    const { state, middleware } = rateLimit({
      limit: 1,
      windowMs: 1_000,
      blockMessage: "x",
      now: () => clock.now,
    });
    const app = new Hono();
    app.use("/p", middleware);
    app.get("/p", (c) => c.json({ ok: true }));
    await app.request("/p", { headers: { "x-forwarded-for": "1.1.1.1" } });
    expect(state.buckets.size).toBe(1);
    clock.now += 5_000;
    state.gc();
    expect(state.buckets.size).toBe(0);
  });
});

/* ============================================================================
 * SpendFlow — in-memory rate-limit middleware (#69, #70).
 *
 * Phase 1 primitive: a fixed-window counter keyed by an arbitrary string per
 * bucket (typically `req.ip`). State lives in a process-local Map — that is
 * intentionally NOT shared across instances (honest caveat in the wire doc):
 * it is sufficient for a single-node Phase 1 deployment, and a Redis-backed
 * limiter is the natural production upgrade.
 *
 * The middleware sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
 * `X-RateLimit-Reset` on every response (success or 429). On a miss it calls
 * `next()`; on a hit beyond the limit it short-circuits with the documented
 * 429 envelope so the FE can render `retry_after_seconds` to the user.
 * ========================================================================== */

import type { MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  /** Resolve the bucket id for a request (default: the caller's IP). */
  key?: (c: Parameters<MiddlewareHandler>[0]) => string;
  /** Max hits per window. */
  limit: number;
  /** Window size, in milliseconds. */
  windowMs: number;
  /** Human-readable message returned in the 429 envelope. */
  blockMessage: string;
  /**
   * Optional injected clock — used by tests to drive the window forward
   * deterministically without `vi.useFakeTimers`. Defaults to `Date.now`.
   */
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Periodic GC so abandoned buckets don't leak. Every minute is plenty. */
const GC_INTERVAL_MS = 60_000;

export interface RateLimitState {
  buckets: Map<string, Bucket>;
  limit: number;
  windowMs: number;
  blockMessage: string;
  now: () => number;
  /** Test seam: also exposed so unit tests can inspect/seed the table. */
  gc: () => void;
}

/**
 * Build a self-contained rate-limit state object + Hono middleware pair. The
 * returned middleware closes over its own state, so multiple `rateLimit()`
 * instances in one app do not collide (e.g. `/forgot-password` at 5/hour and
 * a future `/sign-in` at 10/minute each get an isolated Map).
 */
export function rateLimit(opts: RateLimitOptions): {
  middleware: MiddlewareHandler;
  state: RateLimitState;
} {
  const now = opts.now ?? Date.now;
  const state: RateLimitState = {
    buckets: new Map(),
    limit: opts.limit,
    windowMs: opts.windowMs,
    blockMessage: opts.blockMessage,
    now,
    gc: function gc() {
      const t = now();
      for (const [k, b] of state.buckets) {
        if (b.resetAt <= t) state.buckets.delete(k);
      }
    },
  };

  // Periodic cleanup. `setInterval` in a long-lived server is fine; tests
  // skip it by passing their own `now` and never advancing the wall clock.
  const timer = setInterval(() => state.gc(), GC_INTERVAL_MS);
  // Don't keep the event loop alive just for GC (tests/hot-reload).
  if (typeof timer.unref === "function") timer.unref();

  const keyFn = opts.key ?? defaultKey;

  const middleware: MiddlewareHandler = async (c, next) => {
    const bucketId = keyFn(c);
    const t = now();
    let entry = state.buckets.get(bucketId);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + state.windowMs };
      state.buckets.set(bucketId, entry);
    }
    const remaining = Math.max(0, state.limit - entry.count);
    const retryAfterSeconds = Math.ceil((entry.resetAt - t) / 1000);
    // Set headers on every response — both the allow and the block branch
    // want them, so set the base values now and override Remaining below.
    c.header("X-RateLimit-Limit", String(state.limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count >= state.limit) {
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: state.blockMessage,
            retry_after_seconds: Math.max(1, retryAfterSeconds),
          },
        },
        429,
      );
    }

    entry.count += 1;
    // Recompute Remaining post-increment so the header reflects the count
    // actually consumed by this request (matches the standard convention:
    // "Remaining" includes the in-flight request's decrement).
    c.header("X-RateLimit-Remaining", String(Math.max(0, state.limit - entry.count)));
    await next();
  };

  return { middleware, state };
}

/** Default bucket key: best-effort client IP from common proxy headers. */
function defaultKey(c: Parameters<MiddlewareHandler>[0]): string {
  const xff =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip");
  if (xff) return xff;
  // Hono exposes the remote socket address on `c.env` when running on a
  // worker runtime that provides it; fall back to a constant so the limiter
  // is still safe (single shared bucket) when no IP is resolvable.
  const env = c.env as { remote?: { address?: string } } | undefined;
  return env?.remote?.address ?? "anonymous";
}

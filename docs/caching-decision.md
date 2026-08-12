# ADR: application-level cache layer — intentionally NOT in Phase 1 (#81)

Status: **Accepted — NO-OP for Phase 1.** Deliberate non-goal. Parent epic:
*Production-Ready — backlog for next 5 cycles after Phase 1* (the
"Explicit non-goals — fine for Phase 1" tier, item #81).

This is a decision record, not work. Revisit only when one of the triggers
below fires.

## Decision

For Phase 1, SpendFlow ships **no application-level cache**. Every request
traverses the same read path with nothing memoised in between. Concretely:

- **No Redis, no in-process LRU, no response cache, no per-request cache
  key.** Each inbound request resolves the session by calling
  `auth.api.getSession({ headers })` (`backend/src/auth/permissions.ts`),
  which issues a `SELECT` against SQLite via Drizzle, and the route handler
  then issues its own `SELECT`s against the same in-process database.
- **The read path is a single round-trip.** better-sqlite3 runs **in the
  same Node process** as Hono (`backend/package.json` → `better-sqlite3`).
  There is no network hop between API and DB. A session-resolve + typical
  indexed `SELECT` measures in the **~1–5ms** range on SQLite for Phase 1
  row counts.
- **The frontend already does its own caching.** TanStack Query caches and
  invalidates `useQuery` / `useMutation` results on the client. The
  perceptible "the dashboard feels snappy" wins come from FE cache hygiene
  (stale time, query-key invalidation on mutation), not from a BE cache.
  Adding a BE cache introduces a **second consistency model** to reason
  about for no measurable Phase 1 benefit.
- The Phase 1 deploy assumption baked into this decision is **one company =
  one backend process = one SQLite file**. Verify this is still true before
  reopening (Phase 1: single Hono process, no workers, no multi-instance
  deploy — assumption holds).

## Why this is fine for Phase 1

SpendFlow Phase 1 runs as a **single Hono process** against an
**in-process SQLite database** (better-sqlite3). Every read is an in-memory
function call, not a network round-trip. For Phase 1 traffic (single
tenant, up to ~50 RPS, indexed queries), SQLite comfortably serves
**1000+ reads/sec** on commodity hardware — two orders of magnitude above
the expected peak. There is no perf problem to solve.

Adding a cache layer now would introduce: cache-invalidation bugs (stale
data after write), a second consistency model alongside the DB's, and
operational complexity (eviction policy, TTL tuning, Redis cluster if
multi-instance). The first perf problem that would justify a cache is
"dashboard query is slow under load". Solve it when it shows up in a
measurement, not speculatively.

## Triggers to revisit (any one)

Open a new ticket under the productionization epic when **any** of these
becomes true:

1. **p95 latency on a critical path exceeds 200ms** — measured on a real
   request (e.g. `/api/me`, `/api/notifications/unread-count`, or the
   reporting/dashboard endpoints). This requires a metrics/APM hook to
   observe, which is **not built today**; the trigger fires the moment such
   a hook is added *and* reports a p95 over 200ms, **or**
2. **The backend is deployed as ≥ 2 instances** behind a load balancer (an
   in-process SQLite cache would diverge across instances), **or**
3. **Any single endpoint crosses 100 RPS** sustained, **or**
4. **A real production load test shows CPU saturation** under realistic
   traffic (the absence of a load test today is itself a reason *not* to
   pre-build a cache — we'd be caching against an imagined workload).

## What would have to change (rough order)

When the decision is reopened, this is the estimated work shape — an
additive layer, not a rewrite:

1. **Introduce a per-request cache key for the hot path.** Likely
   candidates: `/api/me` (session + permissions bundle) and
   `/api/notifications/unread-count` (polled). Key on `userId` (+CompanyId
   for permissioned reads).
2. **Pick a cache store.** If still single-instance: an in-process LRU
   (e.g. [`lru-cache`]) with a small TTL. If multi-instance (trigger #2):
   **Redis** so all instances share the cache and invalidation fan-out.
3. **Add cache-invalidation hooks to `writeAudit`.** Every mutation in
   `backend/src/services/*` already routes through `writeAudit`
   (`backend/src/services/audit.ts`) — wire invalidation there so **every
   mutation invalidates the matching read key** in one place rather than
   per-route.
4. **Add a metrics middleware** to actually observe **p95 latency** and
   **cache hit rate** per endpoint. Without this, the cache is
   unobservable; the trigger that reopened this decision cannot be re-tested.
5. **Document the cache contract per endpoint** (TTL, invalidation rule,
   key shape) in a `docs/caching-contract.md` so future routes opt in
   deliberately rather than by default.

[`lru-cache`]: https://www.npmjs.com/package/lru-cache

## Explicitly OUT of scope when this decision stands

- No Redis, no in-process LRU, no response cache is added to the BE.
- No BE service / route is changed to memoise reads.
- No metrics or APM middleware is added (trigger #1 explicitly defers it).
- No test file is added or modified — the existing BE test suite exercises
  the no-cache read path; this document **references** that coverage, it
  does not duplicate it.

## References

- Ticket body: `#81 — NO-OP: caching layer is fine for Phase 1` (labels:
  `documentation`, `no-op`, `fine-for-phase-1`).
- Parent epic: *Production-Ready — backlog for next 5 cycles after Phase 1*
  (Tier: "Explicit non-goals — fine for Phase 1").
- Read path: `backend/src/auth/permissions.ts` (`auth.api.getSession`),
  `backend/src/app.ts` (`/api/me`), `backend/src/routes/notifications.ts`
  (`/api/notifications/unread-count`).
- Mutation / invalidation surface: `backend/src/services/audit.ts`
  (`writeAudit`), called from `claims.ts`, `approvals.ts`, `finance.ts`,
  `admin.ts`, `users.ts`, `invites.ts`, `attachments.ts`,
  `auth/password-reset.ts`.
- DB driver: `backend/package.json` → `better-sqlite3` (in-process SQLite).
- FE cache layer already in place: TanStack Query (client-side).

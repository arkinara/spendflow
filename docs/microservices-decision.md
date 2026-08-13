# ADR: microservices split — intentionally NOT in Phase 1 (#79)

Status: **Accepted — NO-OP for Phase 1.** Deliberate non-goal. Parent epic:
*Production-Ready — backlog for next 5 cycles after Phase 1* (the
"Explicit non-goals — fine for Phase 1" tier, item #79).

This is a decision record, not work. Revisit only when one of the triggers
below fires.

## Decision

For Phase 1, SpendFlow ships as a **single Hono backend process** serving
auth, claims, approvals, finance, audit, admin, notifications, and
reporting from one Node.js process. A microservices split is the
documented future target — not an imminent refactor. Concretely:

- **One deployable.** `backend/src/server.ts` boots one Hono app; every
  route is mounted on the same router tree. There is no service boundary
  to cross at runtime.
- **The codebase is already modular inside the monolith.**
  `backend/src/services/` has one file per domain (`claims.ts`,
  `approvals.ts`, `finance.ts`, `users.ts`, `audit.ts`,
  `notifications.ts`, `attachments.ts`, `policy.ts`, `reporting.ts`,
  `invites.ts`, `admin.ts`, …) — module boundaries exist without a
  network boundary paying for them.
- **Hono's typed RPC + zod schemas** (`backend/package.json` → `hono`
  ^4.6.14, `zod` ^4.0.0) give most of the API-contract value people
  usually chase with microservices — end-to-end types, no manual sync —
  without a network hop.
- The deploy assumption baked into this decision is **one team = one
  backend deployable = one Hono process**. Verify this is still true
  before reopening (Phase 1: single team, single cadence — assumption
  holds).

## Why this is fine for Phase 1

A single Hono process handles **~100 RPS** on a single CPU before
saturating — comfortably above Phase 1 peak traffic (one tenant, tens of
RPS). Hono's typed RPC gives end-to-end type safety between FE and BE
that a microservices split would have to re-introduce via codegen or
contract tests. The codebase is already organised into per-domain
`services/*` modules, so the *design* benefit of microservices (bounded
contexts) is already captured; what's deferred is the *deployment*
benefit, and that only matters when modules need to ship on different
cadences.

Splitting today would add: 5–10 separate deploy units, inter-service auth
and rate limits, distributed tracing, network failure modes at every
boundary, and 3–5× infrastructure cost. The 64-ticket Phase 1 improvement
pass touched one or two files per cycle — every one of those cycles would
have become a multi-repo coordinated deploy under microservices. Solve
for scale when a scale problem shows up in a measurement.

## Triggers to revisit (any one)

Open a new ticket under the productionization epic when **any** of these
becomes true:

1. **2+ backend teams need to deploy on independent cadences** — the
   organisational pressure is the real signal, not the request volume,
   **or**
2. **p95 latency on a hot path needs scale-out** (more instances of the
   *same* service behind a load balancer), not scale-up (a bigger
   instance), **or**
3. **Cross-region requirements emerge** — services must run in more than
   one region for latency or data-residency reasons, **or**
4. **The Hono codebase exceeds ~50k LoC** — size itself signals a bounded
   context split is overdue (the monolith is no longer legible to one
   team).

## What would have to change (rough order)

When the decision is reopened, this is the estimated work shape — a
strangler-fig extraction, not a big-bang rewrite:

1. **Pick the first service to extract.** Likely candidate:
   `services/notifications` — self-contained, clear DB-bound workload,
   already a leaf dependency for most routes.
2. **Add a queue for cross-service events.** **BullMQ + Redis** for
   delivery retries and dead-letter handling; replaces the in-process
   function calls that exist today.
3. **Introduce an API gateway** (or split routes by path prefix). Hono's
   `route()` chaining is already the in-process equivalent of a gateway,
   so this is a configuration step, not a re-architecture.
4. **Migrate one service at a time using a strangler-fig pattern** over
   the Hono monolith: the monolith keeps calling the extracted service
   via HTTP until the cutover for that domain is complete, then the
   in-process call site is deleted.
5. **Add per-service observability** — structured logs, metrics, and
   traces (OpenTelemetry) — so the new network boundaries are
   debuggable. Today the single process makes this a `console.log` plus a
   request-ID middleware; that stops being sufficient once a request
   crosses a process boundary.

## Explicitly OUT of scope when this decision stands

- No routes are split across multiple Hono instances today.
- No queue is added (no consumer needs one — all notifications are
  in-process + a Resend API call).
- No Kubernetes / ECS / Nomad is set up (overkill for a single process).
- No inter-service auth is built (services don't talk to each other).

## References

- Ticket body: `#79 — NO-OP: microservices split — explicitly fine for
  Phase 1` (labels: `documentation`, `no-op`, `fine-for-phase-1`).
- Parent epic: *Production-Ready — backlog for next 5 cycles after Phase 1*
  (Tier: "Explicit non-goals — fine for Phase 1").
- Companion reopen-tracker: ticket **#86** (the trigger list above is the
  basis for that tracker).
- Module surface: `backend/src/services/` (the per-domain code that
  already exists — the future service boundaries).
- Router surface: `backend/src/routes/` (the REST routes that would be
  split by gateway prefix if a split happens).
- Server entry: `backend/src/server.ts` (single Hono process).
- Stack: `backend/package.json` → `hono` ^4.6.14, `zod` ^4.0.0,
  `drizzle-orm` ^0.45.2.

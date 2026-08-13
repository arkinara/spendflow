# ADR: GraphQL — intentionally NOT in Phase 1 (#80)

Status: **Accepted — NO-OP for Phase 1.** Deliberate non-goal. Parent epic:
*Production-Ready — backlog for next 5 cycles after Phase 1* (the
"Explicit non-goals — fine for Phase 1" tier, item #80).

This is a decision record, not work. Revisit only when one of the triggers
below fires.

## Decision

For Phase 1, SpendFlow ships **REST + Hono's typed RPC** as the only API
contract surface. GraphQL is the documented future target — not an
imminent addition. Concretely:

- **One FE client** consumes the API: the Next.js 14 web app. There is no
  second client pulling a different slice of the same data.
- **Every route returns a typed JSON envelope.** `backend/src/routes/*`
  (claims, approvals, finance, notifications, reporting, admin,
  attachments, comments, invites, auth) defines its request/response shape
  with zod; Hono's RPC client surfaces those types in the FE
  end-to-end, no codegen step required.
- **The FE client wrapper** lives at `frontend/lib/api/fetch.ts` — typed
  fetch helpers per domain (`claims.ts`, `approvals.ts`, `finance.ts`,
  `notifications.ts`, `reporting.ts`, `admin.ts`, `users.ts`, `auth.ts`,
  `comments.ts`). The "which fields does this client need?" question is
  answered at build time by TypeScript, not at request time by GraphQL.
- The deploy assumption baked into this decision is **one FE client = one
  BE contract**. Verify this is still true before reopening (Phase 1:
  web only, no partner integrations — assumption holds).

## Why this is fine for Phase 1

GraphQL's headline wins are **client-driven query shape** (the client
picks fields) and **one request for many resources** (no over-fetching).
SpendFlow has neither problem in Phase 1:

- FE types are end-to-end typed via Hono RPC + zod — there is no runtime
  surprise about which fields exist, so the field-picking argument
  collapses into "the type system already did that".
- The "claim + its comments + its audit" composite-read case is rare, and
  a small `?include=` flag (or a dedicated `/claims/:id/full` route)
  solves it without a second query language.

GraphQL's costs are real: **N+1 queries out of the box** (every resolver
is a new DB call without a dataloader), a **second query language** for
new devs to learn, **caching gets harder** (no HTTP cache; need persisted
queries), and a **100kb+ client bundle** (`graphql` + `urql`/`apollo`).
The Phase 2 mobile app is Flutter, not React Native — it will need its
own typed client regardless (likely Retrofit + an OpenAPI generator), so
GraphQL on the BE doesn't even buy us mobile-side type safety.

REST + Hono RPC is faster to build, easier to debug, and adequate for
every client SpendFlow has today.

## Triggers to revisit (any one)

Open a new ticket under the productionization epic when **any** of these
becomes true:

1. **3+ FE clients** (web, mobile, BI tool, partner integration) need
   different slices of the same data, and a `?include=` flag per route
   no longer covers the combinatorics, **or**
2. **The Phase 2 mobile app needs over-fetching avoidance** on flaky
   networks (GraphQL is genuinely better than REST for this — the client
   pulls exactly the fields it can render), **or**
3. **A real-time subscription use case emerges** — GraphQL subscriptions
   are first-class; SSE on REST is doable but ugly, and the
   notifications domain is the obvious candidate, **or**
4. **A partner integration needs a public API** and the partner's
   standard is GraphQL (some platforms — Shopify, GitHub — ship GraphQL
   as the primary contract).

## What would have to change (rough order)

When the decision is reopened, this is the estimated work shape — an
additive surface, not a replacement:

1. **Pick a server.** Recommended: **graphql-yoga** — the most modern,
   lightweight GraphQL server for Hono/express, plays well with Hono's
   middleware pipeline.
2. **Build resolvers per domain**, sharing the Drizzle schema already in
   `backend/src/db/schema.ts`. Each `services/*` module becomes a
   resolver root.
3. **Run GraphQL alongside REST.** Do not deprecate REST until the FE
   migrates — the Hono RPC contract is the source of truth for the web
   app until then.
4. **Add a dataloader per resolver** (`dataloader` package) to collapse
   N+1 — without this, every list resolver issues one DB call per row.
5. **Schema-snapshot tests** (`graphql-snapshot-serializer` or similar)
   so a breaking schema change is caught in CI, not at FE build time.
6. **Consider GraphQL Federation only if the backend has been split into
   services** (see ADR #79). Federation without service boundaries is
   pure overhead.

## Explicitly OUT of scope when this decision stands

- No GraphQL endpoint is added alongside REST today.
- No `graphql` query string appears in the codebase.
- No auto-generated GraphQL layer (Hasura, Postgraphile, etc.) is wired
  up.
- No public GraphQL API is published.

## References

- Ticket body: `#80 — NO-OP: GraphQL — explicitly fine for Phase 1`
  (labels: `documentation`, `no-op`, `fine-for-phase-1`).
- Parent epic: *Production-Ready — backlog for next 5 cycles after Phase 1*
  (Tier: "Explicit non-goals — fine for Phase 1").
- Companion reopen-tracker: ticket **#85** (the trigger list above is the
  basis for that tracker).
- REST surface that would be augmented, not replaced: `backend/src/routes/`
  (`claims.ts`, `approvals.ts`, `finance.ts`, `notifications.ts`,
  `reporting.ts`, `admin.ts`, `attachments.ts`, `comments.ts`,
  `invites.ts`, `auth.ts`).
- Hono typed RPC + zod client surface: `frontend/lib/api/fetch.ts` and
  the per-domain helpers in `frontend/lib/api/`.
- Stack: `backend/package.json` → `hono` ^4.6.14, `zod` ^4.0.0,
  `drizzle-orm` ^0.45.2.

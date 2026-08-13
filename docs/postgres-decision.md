# ADR: PostgreSQL migration — intentionally NOT in Phase 1 (#78)

Status: **Accepted — NO-OP for Phase 1.** Deliberate non-goal. Parent epic:
*Production-Ready — backlog for next 5 cycles after Phase 1* (the
"Explicit non-goals — fine for Phase 1" tier, item #78).

This is a decision record, not work. Revisit only when one of the triggers
below fires.

## Decision

For Phase 1, SpendFlow ships on **SQLite via better-sqlite3**, running
**in the same Node process** as Hono. Postgres is the documented future
target — not an imminent migration. Concretely:

- **One backend process owns the database file.** There is no second
  instance contending for writes, so SQLite's single-writer model is not a
  constraint. `backend/package.json` → `better-sqlite3` (^12.4.1) is the
  only DB driver shipped.
- **Drizzle is the schema source of truth.** `backend/src/db/schema.ts`
  uses Drizzle's `sqlite-core` dialect today; most column types are 1:1
  with `pg-core` (integer, text, boolean, timestamp). The handful of
  SQLite-specific calls (`json_extract` in a few queries) is small and
  known.
- **Migrations are Drizzle-journaled.** `backend/migrations/0000_initial.sql`
  through `0007_password_resets.sql` regenerate cleanly from the schema.
  The migration *files* are dialect-specific, but the schema they were
  generated from is ~90% portable.
- The deploy assumption baked into this decision is **one company = one
  backend process = one SQLite file on local disk**. Verify this is still
  true before reopening (Phase 1: single Hono process, no replicas —
  assumption holds).

## Why this is fine for Phase 1

SpendFlow is sold to Indonesian companies of 10–50 employees. At that
scale a single company generates **<100k audit entries and <5k claims per
year** — comfortably inside SQLite's envelope. better-sqlite3 is
synchronous and in-process, so a read is a function call, not a network
round-trip: typical indexed reads land in the **~1–5ms** range, writes in
the **~1–10ms** range, both with WAL mode enabled.

The BE test surface — **36 test files** — runs end-to-end in **under 2
minutes** on SQLite, and the full integration slice (route + service + DB)
resolves in **<60s**. Standing up a Postgres for CI would add container
startup time, version pinning, and a second connection model to maintain,
for no measurable correctness or perf signal. Postgres's actual value
props (cross-instance write coordination, managed backups, PostGIS,
full-text search, LISTEN/NOTIFY) are all unused in Phase 1. Migrate when
one is needed, not speculatively.

## Triggers to revisit (any one)

Open a new ticket under the productionization epic when **any** of these
becomes true:

1. **>500 concurrent active sessions** — SQLite's single-writer lock
   starts showing contention under realistic concurrent write load, **or**
2. **>2 GB database file size** — SQLite's performance cliff, even with
   WAL enabled and a healthy page cache, **or**
3. **Cross-region replication or a read-replica offload** is required for
   latency or DR (SQLite has no native replication story), **or**
4. **A Postgres-only feature becomes a real requirement** — partial
   indexes, JSONB queries, GIN/GIST indexes, full-text search, or
   LISTEN/NOTIFY for push notifications.

## What would have to change (rough order)

When the decision is reopened, this is the estimated work shape — a
migration project, not a rewrite (budget **1–2 weeks** for cutover):

1. **Pick a Postgres host.** Recommended: **Neon** (serverless,
   branch-per-env) or **Supabase** (managed Postgres + extras).
   Self-hosted is fine if the deploy story already runs its own VMs.
2. **Switch the Drizzle dialect.** Flip `backend/src/db/schema.ts` from
   `drizzle-orm/sqlite-core` to `drizzle-orm/pg-core` and regenerate
   migrations with `drizzle-kit generate` (the script already exists in
   `backend/package.json`).
3. **Switch the driver.** Replace better-sqlite3 in `backend/src/db/index.ts`
   with `postgres-js` (or `drizzle-orm/postgres-js/serverless` for Neon's
   pooler).
4. **Write a one-shot data migration script** (SQLite → Postgres). Test it
   against a copy of the seed data first; the `json_extract` call sites
   need translating to `->>` / `#>>` operators.
5. **Re-run the full 36-file BE test suite** against a docker-compose
   Postgres, plus a CI workflow that pins the Postgres version so the
   migration cannot silently drift.
6. **Deploy a canary.** Run SQLite and Postgres side-by-side, mirror
   writes to both, and flip the connection string only after a full
   business cycle (one month-end close) reconciles row-for-row.

## Explicitly OUT of scope when this decision stands

- No Postgres is run locally for dev (SQLite is the dev DB).
- No Postgres-specific feature is added to the schema (no JSONB columns,
  no partial indexes).
- No replication, read-replica, or managed-backup story is built.
- No "just in case" cloud spend on a managed Postgres instance.

## References

- Ticket body: `#78 — NO-OP: real DB / Postgres migration — explicitly
  fine for Phase 1` (labels: `documentation`, `no-op`,
  `fine-for-phase-1`).
- Parent epic: *Production-Ready — backlog for next 5 cycles after Phase 1*
  (Tier: "Explicit non-goals — fine for Phase 1").
- Companion reopen-tracker: ticket **#87** (the trigger list above is the
  basis for that tracker).
- Schema: `backend/src/db/schema.ts` (Drizzle, `sqlite-core` dialect;
  ~90% of column types portable to `pg-core`).
- Migration journal: `backend/migrations/0000_initial.sql` ..
  `0007_password_resets.sql` (Drizzle migration files, dialect-specific
  but regenerable from the schema).
- DB driver: `backend/package.json` → `better-sqlite3` ^12.4.1,
  `drizzle-orm` ^0.45.2, `drizzle-kit` ^0.31.4.

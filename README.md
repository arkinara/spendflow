# SpendFlow

Spend management, reimbursement, and approval platform.

- **Phase 1 (this repo, active):** web app — employee claims, approver decisioning, finance exception/payment lifecycle, policy/category/routing admin, notifications, reporting.
- **Phase 2 (future, not scheduled):** Flutter mobile app with OCR receipt capture.

## PRD

Full product spec: [SpendFlow — Spend Management, Reimbursement & Approvals](https://app.notion.com/p/SpendFlow-Spend-Management-Reimbursement-Approvals-3ab8f6b0a7a5815b9a41faf007b659c3) (Notion).

## Source of truth

The [GitHub Project board](../../projects) (`SpendFlow Board`) is the development source of truth for ticket status. Issues track Phase 1 FE and BE work; board lanes are `Todo` → `In Progress` → `In QA` → `Done`.

## Phase scope decisions

Non-goal decisions captured as ADRs so they're easy to find and easy to
revisit:

- **i18n / multi-currency UI (#82)** — intentionally English-only UI for
  Phase 1; the BE already supports multi-currency at the data layer. Triggers
  to revisit + the work shape if it reopens: [`docs/i18n-decision.md`](docs/i18n-decision.md).
- **Caching layer (#81)** — intentionally no application-level cache for
  Phase 1; every request hits the in-process SQLite via a single read path.
  Triggers to revisit + the work shape if it reopens: [`docs/caching-decision.md`](docs/caching-decision.md).
- **PostgreSQL migration (#78)** — intentionally SQLite-only for Phase 1;
  one backend process, in-process better-sqlite3, no cross-instance
  coordination. Triggers to revisit + the work shape if it reopens:
  [`docs/postgres-decision.md`](docs/postgres-decision.md).
- **Microservices split (#79)** — intentionally a single Hono process for
  Phase 1; per-domain `services/*` modules capture bounded contexts without
  a deployment cost. Triggers to revisit + the work shape if it reopens:
  [`docs/microservices-decision.md`](docs/microservices-decision.md).
- **GraphQL (#80)** — intentionally REST + Hono typed RPC only for Phase 1;
  one FE client, end-to-end zod types, no over-fetching problem to solve.
  Triggers to revisit + the work shape if it reopens:
  [`docs/graphql-decision.md`](docs/graphql-decision.md).

## Verification

Run the full correctness gate (typecheck + tests + build) across both workspaces from the repo root:

```sh
npm run verify
```

Assumes `node_modules` is installed in `backend/` and `frontend/` (`npm install` once on first checkout). The script fails fast on the first non-zero exit and enforces a hard 15-minute timeout. It does **not** run prettier/linting, git operations, or a fresh `npm install`.

The 6 gates run in order (next build runs before FE typecheck so generated `.next/types` exist):

1. `BE typecheck` — `tsc --noEmit`
2. `BE test` — `vitest run`
3. `BE build` — `tsc`
4. `FE build` — `next build` (generates `.next/types`)
5. `FE typecheck` — `tsc --noEmit`
6. `FE test` — `vitest run`

> CI badge placeholder: add a GitHub Actions workflow (a follow-up ticket) and embed the badge here once CI is wired up.

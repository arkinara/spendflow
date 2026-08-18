# SpendFlow Backend (BE-auth — ticket #10)

Phase 1 backend: **authentication, session management, and the
organisation/role data model** that every other backend domain
(BE-claims, BE-approvals, BE-finance, BE-admin, BE-notifications,
BE-reporting) depends on for identity and authorization.

- **Stack:** Hono (HTTP) + Better Auth (auth/sessions) + Drizzle ORM +
  SQLite (better-sqlite3) + Zod (validation) + Vitest (tests).
- **Architecture choice:** a **separate `backend/` TypeScript workspace**
  (its own `package.json`, `tsconfig`, Drizzle config, Vitest config) so the
  DB/auth tooling stays isolated from the Next.js build in `frontend/`.
  The Next.js frontend is fully wired to this backend — every vertical talks
  HTTP to it (see `../frontend/README.md`).

## Quick start

```bash
cd backend
cp .env.example .env            # adjust secrets for production
npm install
npm run db:migrate              # apply migrations → ./dev.db
npm run seed                    # seed the 3 demo personas (password: demo1234)
npm run dev                     # start Hono on http://localhost:8787
```

### Two-server dev workflow (with the frontend)

The Next.js frontend (`../frontend`) talks to this backend over HTTP. The FE
has no mock mode — it needs this server running **and** the DB migrated +
seeded, otherwise there is nothing to log in against. Run both in dev:

```bash
# terminal A — backend (this repo)
cd backend && npm run db:migrate && npm run seed && npm run dev
#                                                          http://localhost:8787

# terminal B — frontend
cd frontend && npm run dev        # http://localhost:3000
```

The frontend targets this server via `NEXT_PUBLIC_BE_URL`
(default `http://localhost:8787`); this server must allow the FE origin via
`FRONTEND_ORIGIN` (default `http://localhost:3000`) so the browser can send the
httpOnly session cookie cross-origin. If the browser shows a CORS preflight
error, check `FRONTEND_ORIGIN` in `backend/.env` matches the exact origin the
FE is served from. See `../frontend/README.md` for the full flow and the demo
credentials.

Verify everything passes:

```bash
npm test                        # integration tests (in-memory DBs)
npm run typecheck               # tsc --noEmit, exit 0
npm run build                   # compile to dist/, exit 0
```

## Scripts

| Script            | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `npm run dev`     | Run the Hono server with tsx watch.                |
| `npm run build`   | Compile TypeScript to `dist/`.                     |
| `npm start`       | Run the compiled server.                           |
| `npm test`        | Run the Vitest suite (one-shot).                   |
| `npm run test:watch` | Vitest in watch mode.                           |
| `npm run typecheck`| `tsc --noEmit`.                                   |
| `npm run db:generate` | Regenerate Drizzle migrations from the schema. |
| `npm run db:migrate` | Apply pending migrations to the configured DB.   |
| `npm run seed`    | Seed demo users (idempotent on email).             |

## Project layout

```
backend/
  src/
    config.ts              env loading + defaults
    app.ts                 Hono app factory: auth handler + admin routes + onError
    server.ts              @hono/node-server entrypoint
    db/
      index.ts             better-sqlite3 + drizzle handle factory (PRAGMA FK on)
      schema.ts            Drizzle schema (users, sessions, accounts, verifications, audit_logs)
      migrate.ts           migration runner (`npm run db:migrate`)
      seed.ts              demo-persona seeder (`npm run seed`)
    auth/
      index.ts             createAuth(): Better Auth instance (Drizzle adapter, email/password)
      permissions.ts       requireUser / requireRole / getCurrentUser / dataScopeFor
    services/
      provision.ts         provisionUser(): user + credential account (+ password_hash mirror)
      users.ts             listUsers / changeRole / setManager (+ cycle detection)
      audit.ts             writeAudit / auditForEntity
    types.ts               Role / UserStatus / PublicUser / AuditEntry
  migrations/
    0000_initial.sql       initial migration (creates all tables)
    meta/                  drizzle-kit journal
  tests/
    setup.ts               vitest setup (pins test secret)
    helpers.ts             bootstrap() in-memory harness + login/authed* helpers
    auth.session.test.ts   login/logout/session/expiry/invalid-token
    users.admin.test.ts    role/manager/audit/circular-rejection
    permissions.test.ts    allow/deny matrix + query-layer scoping
```

## API surface

Better Auth owns all credential/session endpoints under `/api/auth/*`:

| Method & path                       | Purpose                                   |
| ----------------------------------- | ----------------------------------------- |
| `POST /api/auth/sign-in/email`      | Login — issues the session cookie.        |
| `POST /api/auth/sign-out`           | Logout — deletes the session server-side. |
| `GET  /api/auth/get-session`        | Current session / auth check.             |
| `POST /api/auth/sign-up/email`      | Create a credential user.                 |

App endpoints (all require a valid session):

| Method & path                       | Role      | Purpose                       |
| ----------------------------------- | --------- | ----------------------------- |
| `GET  /api/me`                      | any       | Current authenticated user.   |
| `GET  /api/dashboard/inbox`         | any       | Role-scoped data demo (proves query-layer filtering). |
| `GET  /api/admin/users`             | finance   | List all users.               |
| `PATCH /api/admin/users/:id/role`   | finance   | Change a user's role.         |
| `PATCH /api/admin/users/:id/manager`| finance   | Set/clear a user's manager.   |
| `GET  /api/admin/users/:id/audit`   | finance   | Audit trail for a user.       |

## Authorization model

Three roles: `employee`, `approver`, `finance`. Enforcement is **server-side**
and shared, never client-side hiding:

- `requireUser(headers)` — any authenticated caller.
- `requireRole(headers, role | role[])` — throws `AuthError` (401 if no
  session, 403 if the role is wrong).
- `dataScopeFor(user)` — returns a WHERE-clause filter
  (`ownOnly` for employees, `managerId`-scoped for approvers, `allData` for
  finance) that dashboard/inbox queries apply at the query layer.

Every role-restricted route handler calls one of these **before** touching data,
and a denied action returns only an `{ error: { code, message } }` envelope —
never partial data.

## Multi-role users (#44)

A user may hold more than one role. The data model is:

- **`users.roles`** — a JSON-encoded `text` array, e.g. `["employee","approver"]`.
  Always non-empty for a real user (the empty default exists only so a fresh
  insert never violates `NOT NULL`).
- **`users.primary_role`** — the derived single role, written on every role
  mutation. Precedence is **`finance` > `approver` > `employee`**. Legacy
  single-role call sites (and the `role` field on `/api/me`) read this.

`GET /api/me` returns both `roles` (the full set) and `primaryRole` (the
derived role). Authorisation guards (`requireRole` / `requireAnyRole`) admit
on any overlap between the caller's `roles[]` and the allowed list, so a user
holding `["employee","approver"]` passes both the employee and approver
guards.

**Segregation-of-duties (SoD) guard (#46).** At submission time the resolved
approval route is walked: if any step would land at the submitter's own desk
(self-approval), or a `submitter_manager` step can't resolve because the
submitter has no manager, the claim is written as `blocked_sod` (not
`pending`) with `blocked_reason` set and an audit entry
`claim.blocked_sod` whose `after.code` is `self_approval` or `no_manager`.
`blocked_sod` claims surface in the Finance exception queue. A multi-role
approver who is also an employee can therefore submit their own claim — it
flows normally as long as someone else sits at every step.

**Creating a multi-role user.** Multi-role sets are provisioned through the
`provisionUser({ roles, ... })` service helper (used by the seeder and tests).
The HTTP admin endpoints (`POST /api/admin/users`, `PATCH
/api/admin/users/:id/role`) currently accept a single `role` and replace the
set, so a true multi-role set is a seed/service-time configuration as of #44.
The `roles[]` column is forward-compatible with a future multi-role admin UI.

## Schema notes (important)

The `users` table carries the full PRD column set:
`id, name, email (unique), password_hash, role, manager_id (self-FK),
department, cost_center, status, created_at, updated_at`
(plus Better Auth's `email_verified`, `image`).

**About `password_hash`:** Better Auth normalises credentials into a separate
`accounts` table (column `accounts.password`, providerId `credential`) — this is
its multi-provider security model (same pattern as Auth.js/Clerk) and is what
the email/password verifier actually checks. To honour the PRD schema literally,
`users.password_hash` is kept as a **mirror** of the credential hash: the
provisioning helper derives a single hash (Better Auth's `hashPassword`) and
writes it to **both** columns atomically, so the two stores can never drift.
`users.password_hash` is never returned by any endpoint (`returned: false`).

Reporting-line integrity: `manager_id` is a self-referencing foreign key
(`PRAGMA foreign_keys = ON`), and the admin API rejects self-management
(`self_manager`) and any assignment that would close a cycle (`cycle`) before
writing. Every role/manager change appends an immutable `audit_logs` row
capturing the actor and before/after state.

## Web ↔ Mobile data-shape audit (#101)

The mobile app (`mobile/`) submits receipts as a flat `OcrDraft` and reads the
same backend the web app uses. This audit walks every field of the canonical
`Claim` + `LineItem` shape and records where each side produces it, so a claim
submitted from the phone is **byte-identical** to one submitted from the web
wizard for the same category/amount/date. The single mapper is
`ocrDraftToLineItem` in `backend/src/services/mobile-claims.ts`.

| Canonical field | Web produces it via | Mobile produces it via | Match |
| --------------- | ------------------- | ---------------------- | ----- |
| claim.title | wizard title field → `createClaim` | `OcrDraft.merchant` → mapper → `createClaim` | ✅ merchant maps to the claim title (NOT folded into the line description — the ticket's original "prefix" guess would break byte-identity) |
| claim.purpose | wizard purpose → `createClaim` | `OcrDraft.description` → mapper | ✅ |
| claim.currency | wizard currency → `createClaim` | `OcrDraft.currency` (claim level + per-line) | ✅ line.currency and claim.currency both get the draft currency |
| line.categoryId | wizard picks the category **row id** (`"meals"`) | `OcrDraft.category` label `"Meals"` → `resolveCategoryByName` → row id | ✅ VERIFIED: the web sends the row id, not the display code (`"MEL"`); the mapper resolves label → id case-insensitively |
| line.description | wizard description | `OcrDraft.description` | ✅ |
| line.amount | wizard int minor units (391830) | `OcrDraft.amount` `"391.830"` → `parseIndonesianAmount` → int | ✅ (converted by the mapper) |
| line.date | wizard ISO `"2026-07-15"` | `OcrDraft.date` `"15/07/2026"` → `toIsoDate` | ✅ (converted by the mapper) |
| line.tax | **no tax field on `ClaimLine`** — tax is folded into the confirmed amount | `OcrDraft.tax` parsed for validation symmetry only; stays inside the confirmed total | ✅ both sides have no per-line tax column |
| line.note | attachment rows (see `attachments` table) | `OcrDraft.receiptUrl` → `line.note` | ⚠️ documented: real attachment wiring (receiptUrl → attachment rows) is ticket #103 |
| line.currency | wizard currency per line | `OcrDraft.currency` per line | ✅ |
| line.quantity / unitRate / mileage | mileage lines compute server-side | non-mileage drafts never set these | ✅ |

**InboxItem shape (approver side).** The mobile decodes a **different** wire
shape from the web (`GET /api/approver/inbox` → `{ items }` with
`employeeName`/`totalAmount`/`stepLabel`/`sla` object). The mobile consumer
(`rest_claim_repository.dart`) calls `GET /api/inbox/:approverId` and expects
`{ inbox }` with `submitter`/`initials`/`sub`/`amount`/`sla` (string)/
`slaTone`/`flagText`. Additive fix: `mobileApproverInbox` in
`backend/src/services/approvals.ts` serves the same claim set in the mobile
vocabulary; the web endpoint is untouched. `sla` mirrors the web SlaBadge
label; `slaTone` maps the badge tone onto the mobile's info/ok/error enum.

## Demo credentials (after `npm run seed`)

| Role     | Email                              |
| -------- | ---------------------------------- |
| employee | `aulia.pratiwi@spendflow.example`  |
| approver | `dewi.anggraeni@spendflow.example` |
| finance  | `ridwan.saputra@spendflow.example` |

Password for all three: `demo1234`.

## Environment

See `.env.example`. Required for production: a strong `BETTER_AUTH_SECRET`
(`openssl rand -base64 32`) and the real `BETTER_AUTH_URL` / `FRONTEND_ORIGIN`
(CORS). Tests run against in-memory SQLite databases, so no `.env` is needed
for `npm test`.

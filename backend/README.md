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

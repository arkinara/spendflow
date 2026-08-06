# SpendFlow — Frontend (Phase 1 Web Prototype)

Responsive spend-management, reimbursement, and approval app for travel expenses.
Built with **Next.js (App Router) + TypeScript + Tailwind CSS + Material Design 3**.

> **Phase 1.** All verticals — auth + sessions, claims, approvals, finance,
> admin, notifications, reporting — are HTTP-backed against the real Better
> Auth + Drizzle backend (`../backend`). There is **no mock mode**: if the
> backend is unreachable, screens render an error state rather than falling
> back to fixtures. Receipt upload is manual (file metadata only). OCR is
> Phase 2.

## Requirements

- Node.js 18.18+ (tested on Node 22)
- npm 9+
- The SpendFlow backend running locally (see
  [`../backend/README.md`](../backend/README.md)) — auth + sessions come from it.

## Install & run (two-server dev workflow)

The frontend and backend are two separate dev servers that talk over HTTP. The
browser needs both: the Next.js app on `:3000` and the Hono/Better Auth API on
`:8787`.

```bash
# 1. Backend (terminal A)
cd backend
cp .env.example .env            # set FRONTEND_ORIGIN=http://localhost:3000
npm install
npm run db:migrate
npm run seed                   # creates the 3 demo users (password: demo1234)
npm run dev                    # → http://localhost:8787

# 2. Frontend (terminal B)
cd frontend
cp .env.example .env.local     # NEXT_PUBLIC_BE_URL=http://localhost:8787
npm install
npm run dev                    # → http://localhost:3000
```

Open http://localhost:3000 and sign in with a demo account (below). The session
is an httpOnly cookie set by Better Auth and is sent automatically
(`credentials: "include"`) on every fetch — it survives reloads and is
invalidated server-side on sign-out.

### Expected ports

| Server  | Default URL                 | Env var                |
|---------|-----------------------------|------------------------|
| Frontend| http://localhost:3000       | —                      |
| Backend | http://localhost:8787       | `NEXT_PUBLIC_BE_URL` (FE) / `PORT` (BE) |
| CORS    | FE origin allowed by BE     | `FRONTEND_ORIGIN` (BE) |

If the browser console shows a CORS preflight error, ensure `FRONTEND_ORIGIN`
in `backend/.env` matches the exact origin the FE is served from
(`http://localhost:3000`).

### Demo credentials (after `npm run seed` in `backend/`)

| Role     | Email                              | Password  | Home        |
|----------|------------------------------------|-----------|-------------|
| Employee | `aulia.pratiwi@spendflow.example`  | `demo1234`| `/employee` |
| Approver | `dewi.anggraeni@spendflow.example` | `demo1234`| `/approver` |
| Finance  | `ridwan.saputra@spendflow.example` | `demo1234`| `/finance`  |

The login page's three preset buttons sign in as these personas against the
real backend (not a mock).

Other scripts:

```bash
npm run build        # production build
npm run start        # serve the production build
npm run typecheck    # tsc --noEmit (0 errors expected)
npm run lint         # next lint
```

## Three roles, one demo build

SpendFlow ships with all three personas in the same build so you can walk the full
workflow without logging in and out.

| Role | Person | Home |
|------|--------|------|
| **Employee** | Aulia Pratiwi · Operations | `/employee` |
| **Manager / Approver** | Dewi Anggraeni · Operations | `/approver` |
| **Finance Admin** | Ridwan Saputra · Finance | `/finance` |

### Switching roles

There are three ways to change the active role:

1. **Landing page (`/`)** — pick a role card (signs in against the BE).
2. **Login page (`/login`)** — use the "Sign in as Employee / Approver / Finance" presets.
3. **Role switcher in the top app bar** — the *"Viewing as …"* dropdown (dev-only). It
   re-signs-in as the chosen role against the BE and routes you to that role's
   dashboard. The left navigation rail updates to match the role.

The **theme toggle** (sun/moon icon in the app bar) switches light/dark; the choice is
remembered in `localStorage` (`spendflow.theme`).

## Navigation map

```
/                         Landing + role picker
/login                    Login with role presets
/employee                 Employee dashboard
/employee/claims          Claim history (search + status filters)
/employee/claims/new      Multi-step claim wizard (Trip → Expenses → Receipts)
/employee/claims/[id]     Claim detail + status timeline
/approver                 Approver dashboard + inbox
/approver/claims/[id]     Claim review + Approve / Return / Reject dialogs
/finance                  Finance dashboard
/finance/exceptions       Exception queue + resolve dialog
/finance/payments         Payment lifecycle board (queued → paid / failed)
/finance/policies         Policy / Category / Routing admin (CRUD)
/reports                  Reports, filters, totals, CSV export
/notifications            Notification center (per-role)
/claims/[id]/comments     Comments thread
/claims/[id]/audit        Audit trail viewer
```

## Design system

Material Design 3 is the authoritative reference, with density patterns borrowed from
Fluent 2 / Atlassian for the admin tables and finance queues.

- **Color** — semantic M3 tokens only (no raw hex). Defined as HSL CSS variables in
  `app/globals.css`, mapped to Tailwind utilities in `tailwind.config.ts`. Light + dark.
- **Elevation** — tonal surface levels (`surface-container-low` cards, `-high` nav/app bar,
  `-highest` dialogs); `shadow-sm` on cards only.
- **Shape** — `rounded-2xl` cards, `rounded-xl` inputs, `rounded-full` chips/buttons.
- **Typography** — Inter, M3 Display → Headline → Title → Body → Label scale.
- **States** — every interactive element has default/hover/focus/pressed/disabled;
  skeletons for loading, empty states with a CTA, snackbars confirm actions.
- **Status chips** — colour + text + icon (never colour or emoji alone).
- **Icons** — Lucide React, `strokeWidth={1.75}`.

## Project structure

```
frontend/
├─ app/                     # routes (App Router)
├─ components/
│  ├─ ui/                   # design-system primitives (Button, Card, DataTable, …)
│  └─ shell/                # AppShell, AppBar wiring, RoleSwitcher
├─ lib/
│  ├─ utils.ts              # cn() class merger
│  ├─ format.ts             # currency / date / relative-time helpers
│  ├─ auth/                 # apiClient (Better Auth HTTP) + SessionProvider + routeAccess
│  ├─ api/                  # apiFetch() wrapper + typed HTTP clients (all BE calls)
│  ├─ hooks/                # useFinanceDashboard, useAdminStore, … (BE-backed)
│  ├─ store/                # fallback stores (claimStore, adminStore, notifyStore)
│  ├─ fixtures.ts           # seeded fixture data (tests, stores)
│  └─ seed-data.ts          # shared seed data
├─ tailwind.config.ts       # M3 tokens, radius, spacing, motion
└─ app/globals.css          # CSS variables (light + dark)
```

## Sample data

The flagship claim is **"Q2 Client Visit – Jakarta"** (Flight IDR 2,450,000, Hotel
IDR 1,800,000 / 2 nights, Meals IDR 320,000, Taxi IDR 145,000, Mileage 60 km @
IDR 1,200/km). Claims exist in every state — Draft, Pending Approval, Action Required,
Approved, Processing, Paid, Rejected — plus a missing-receipt exception for the finance
queue. IDR is the primary currency; USD is supported as secondary.

## Shareable prototype

A self-contained, dependency-free HTML prototype of every key screen lives at
`/tmp/ux-prototype.html` (Tailwind via CDN, same M3 tokens). Open it directly in a
browser to click through or print — no build step required.

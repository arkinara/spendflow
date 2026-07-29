# SpendFlow — Frontend (Phase 1 Web Prototype)

Responsive spend-management, reimbursement, and approval app for travel expenses.
Built with **Next.js (App Router) + TypeScript + Tailwind CSS + Material Design 3**.

> **Prototype only.** No backend, no database, no API, no OCR. Every screen renders
> from mock fixtures in `lib/mock/mock_data.ts`. Receipt upload is manual (file
> metadata only). "Auth" is a role preset, not real authentication.

## Requirements

- Node.js 18.18+ (tested on Node 22)
- npm 9+

## Install & run

```bash
cd frontend
npm install          # install dependencies
npm run dev          # start the dev server → http://localhost:3000
```

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

1. **Landing page (`/`)** — pick a role card.
2. **Login page (`/login`)** — use the "Sign in as Employee / Approver / Finance" presets.
3. **Role switcher in the top app bar** — the *"Viewing as …"* dropdown (dev-only). It
   swaps the mock user, persists the choice in `localStorage` (`spendflow.role`), and
   routes you to that role's dashboard. The left navigation rail updates to match the role.

The **theme toggle** (sun/moon icon in the app bar) switches light/dark; the choice is
remembered in `localStorage` (`spendflow.theme`).

## Navigation map

```
/                         Landing + role picker
/login                    Mock login with role presets
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
│  └─ mock/mock_data.ts     # ALL fixtures (users, claims, payments, policies, …)
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

A self-contained, dependency-free HTML mock of every key screen lives at
`/tmp/ux-prototype.html` (Tailwind via CDN, same M3 tokens). Open it directly in a
browser to click through or print — no build step required.

# ADR: i18n / multi-currency UI — intentionally NOT in Phase 1 (#82)

Status: **Accepted — NO-OP for Phase 1.** Deliberate non-goal. Parent epic:
*Production-Ready — backlog for next 5 cycles after Phase 1* (the
"Explicit non-goals — fine for Phase 1" tier, item #82).

This is a decision record, not work. Revisit only when one of the triggers
below fires.

## Decision

For Phase 1, SpendFlow ships **English-only UI** and treats **currency as a
company-level concern, not a per-claim user choice**. Concretely:

- **i18n (locale switching) is out of scope.** All UI strings are hardcoded
  English. There is no locale picker, no `t("…")` layer, no per-user
  timezone rendering (dates render in UTC).
- **The backend already supports multi-currency at the data layer.** This is
  exercised by the BE test suite today and does not need to be re-built when
  i18n is revisited:
  - `backend/src/db/schema.ts` — `claims`, claim lines, policies, and
    payments each carry a `currency` `text` column with a `DEFAULT 'IDR'`.
  - `backend/src/services/claims.ts` / `policy.ts` / `reporting.ts` accept a
    per-line `currency` and produce **per-currency totals** (including
    mixed-currency claim aggregation).
  - `backend/tests/policy.test.ts` evaluates lines in both `IDR` and `USD`
    against the same policy; `backend/tests/reporting.test.ts` asserts
    per-currency totals across mixed-currency claims.
  - The frontend has a matching `CurrencyCode = "IDR" | "USD"` union in
    `frontend/lib/format.ts`, with `Intl.NumberFormat` rendering keyed on
    that code.
- The SE-Asian-market assumption baked into the data model is
  **one company = one currency**: the UI never converts between currencies,
  it only renders the single currency the company operates in. Verify this
  is still true before reopening this decision (Phase 1: 1 of 1 customers,
  all IDR — assumption holds).

## Why this is fine for Phase 1

SpendFlow is built for Indonesian companies. UI is English (international),
default currency IDR, address format Indonesian. Seed data and demo accounts
are IDR. International expansion is a Phase 2+ concern. Adding i18n
speculatively is a 2–4 week refactor for a small app with no current
non-IDR / non-English customer to pull it.

## Triggers to revisit (any one)

Open a new ticket under the productionization epic when **any** of these
becomes true:

1. The first **paying customer outside Indonesia** signs up, **or**
2. The first company needs **more than one active locale** (e.g. an
   Indonesia-based team whose finance back-office works in English but whose
   field reps need Bahasa Indonesia), **or**
3. The first **reimbursement must be paid in a non-IDR currency** and the
   user needs to *choose* that currency on the claim (as opposed to it being
   fixed at the company level).

## What would have to change (rough order)

When the decision is reopened, this is the estimated work shape — a
refactor, not a rewrite:

1. **Extract hardcoded English strings into `t("…")` calls** across the FE
   (App Router pages, components, design-system labels, error/empty states,
   snackbars). BE error envelopes (`{ error: { code, message } }`) should
   switch to surfacing `code` and let the FE translate.
2. **Pick a locale strategy.** Recommended: **[`next-intl`]** for Next.js 14
   App Router (server + client component support, ICU MessageFormat, route
   prefix or cookie mode). Alternatives: `next-i18next` (older, Pages-first)
   or rolling a thin `ReactIntl` wrapper.
3. **Add a locale cookie or `[locale]` path prefix.** Path prefix
   (`/en/…`, `/id/…`) is friendlier to SEO + sharing; cookie is lower
   friction for an internal tool. Decide per customer.
4. **Multi-currency UI** (only if trigger #3 fires): add a currency selector
   to the **claim wizard** (`/employee/claims/new`) and the **payment board**
   (`/finance/payments`). The BE needs no change — it already accepts and
   aggregates per-line currency. The FE `CurrencyCode` union in
   `frontend/lib/format.ts` grows to the new ISO 4217 codes; the
   `Intl.NumberFormat` rendering generalises by dropping the
   `IDR | USD` special-case.
5. **Re-validate the one-company-one-currency assumption** against the
   reopened customer before building converters. If it still holds, the
   selector from step 4 is a *display* selector (render an IDR amount as
   USD for a US-based approver), not a *data* selector, and no FX feed is
   needed.

[`next-intl`]: https://next-intl-docs.vercel.app/

## Explicitly OUT of scope when this decision stands

- No locale switcher is added to the FE.
- The BE `currency` columns / defaults are not changed.
- No translation keys are introduced.
- No test file is added or modified — the BE test suite already exercises
  multi-currency at the data layer; this document **references** that
  coverage, it does not duplicate it.

## References

- Ticket body: `#82 — NO-OP: i18n / multi-currency UI` (labels:
  `documentation`, `no-op`, `fine-for-phase-1`).
- Parent epic: *Production-Ready — backlog for next 5 cycles after Phase 1*
  (Tier: "Explicit non-goals — fine for Phase 1").
- Data layer: `backend/src/db/schema.ts` (currency columns),
  `backend/src/services/{claims,policy,reporting}.ts`.
- Test coverage cited above: `backend/tests/policy.test.ts`,
  `backend/tests/reporting.test.ts`.
- FE rendering: `frontend/lib/format.ts` (`CurrencyCode` union,
  `Intl.NumberFormat`).

# SpendFlow Phase 1 — End-to-end Verification Test Suite

> **Source**: derived from every shipped ticket (#1-#82) on 2026-08-12.
> **How to use**: run on a laptop with `cd backend && npm run dev` and `cd frontend && npm run dev` both up. Pick any subset that matches what you want to verify before signing off a release.
> **Demo credentials** (after `npm run db:seed`):
> - employee@... / demo1234 → employee dashboard
> - approver@... / demo1234 → approver inbox
> - finance@... / demo1234 → finance admin
> All passwords are 'demo1234' unless noted.

---

## Test matrix overview

| Section | Tickets covered | Test count |
|---|---|---|
| 1. Authentication & Sessions | tickets #1, #2, #64, #69, #10 | 12 |
| 2. Multi-Role & SoD | tickets #44-#47, #51, #64 | 7 |
| 3. Claim Lifecycle | tickets #4-#9, #13, #21, #22, #28, #34, #36, #38, #39, #40, #46 | 12 |
| 4. Payments | tickets #2, #16, #28, #44 | 4 |
| 5. Audit Log + PII Redaction | tickets #34, #71, #72, #77 | 7 |
| 6. User Management | tickets #14, #15, #30, #32, #33, #36, #41, #42, #43, #53 | 8 |
| 7. Categories, Policies, Routes | tickets #18, #19, #20, #22, #23, #24 | 5 |
| 8. Webhooks + Notifications + Email | tickets #65, #75 | 4 |
| 9. SLA Tracking | tickets #74 | 2 |
| 10. Rate Limits | tickets #69, #70 | 3 |
| 11. Accessibility & UX | cross-cutting | 5 |
| 12. Performance smoke checks | one per app surface | 2 |
| **Total** | | **71** |

---

## 1. Authentication & Sessions (tickets #1, #2, #64, #69, #10)

### Test 1.1: Login as Employee with valid creds
**Ticket**: #1
- 1. Go to /login
- 2. Enter demo employee email + password 'demo1234'
- 3. Click Sign in
- Expected: redirected to /employee dashboard within 2s.

### Test 1.2: Login with wrong password
**Ticket**: #1
- 1. /login with demo employee + wrong password
- 2. Click Sign in
- Expected: error message 'Invalid email or password' inline, no redirect, password field cleared.

### Test 1.3: Login as Approver lands on /approver
**Ticket**: #1, #45
- 1. /login with demo approver
- Expected: redirected to /approver (inbox), not /employee.

### Test 1.4: Login as Finance Admin lands on /finance
**Ticket**: #1, #45
- 1. /login with demo finance
- Expected: redirected to /finance dashboard.

### Test 1.5: Multi-role user lands on primaryRole's home
**Ticket**: #45
- 1. /login with multi-role user (a user with roles [employee, approver], primaryRole 'approver')
- Expected: redirected to /approver.

### Test 1.6: Logout invalidates the session
**Ticket**: #2
- 1. Sign in, then click the user menu → Sign out
- Expected: redirected to /login. Hitting any protected route (e.g. /employee) directly redirects to /login with the next= query param.

### Test 1.7: Session cookie is httpOnly + SameSite
**Ticket**: #2
- 1. Open DevTools → Application → Cookies → http://localhost:3000
- 2. Find the session cookie (name is implementation-specific)
- Expected: HttpOnly ✓, SameSite=Lax (or Strict), Secure if prod.

### Test 1.8: Password re-auth on destructive admin action
**Ticket**: #64, #42
- 1. Sign in as Finance
- 2. Go to /finance/users
- 3. Click Delete on a pending user
- Expected: confirmation dialog asks for your password. Wrong password = inline error + dialog stays open. Correct password = deletion succeeds.

### Test 1.9: Forgot password sends reset email (dev: logs to file)
**Ticket**: #69, #57b
- 1. Click 'Forgot password?' on /login
- 2. Enter demo employee email
- 3. Check backend/logs/invites.log OR the toast (which carries the devHint URL)
- Expected: a reset URL ending in /reset-password/<token> is generated. The token is a 122-bit randomUUID.

### Test 1.10: Reset password with a valid token
**Ticket**: #69
- 1. From the forgot-password email, copy the URL
- 2. Open it in a browser
- 3. Set a new password (≥ 8 chars)
- 4. Confirm
- Expected: redirected to /login with a toast 'Password reset. Please sign in with your new password.' Signing in with the new password works.

### Test 1.11: Reset password invalidates all existing sessions
**Ticket**: #69
- 1. Sign in as a user, get a session cookie
- 2. Trigger a password reset
- 3. Try to use the old session cookie (hit /api/me)
- Expected: the old session is rejected (401). The new password works.

### Test 1.12: Rate limit on /api/auth/forgot-password
**Ticket**: #69, #70
- 1. POST /api/auth/forgot-password 6 times from the same IP within 1 hour
- Expected: first 5 return 200, 6th returns 429 with code 'rate_limited' and Retry-After header.

---

## 2. Multi-Role & SoD (tickets #44-#47, #51, #64)

### Test 2.1: User can hold multiple roles (e.g. employee + approver)
**Ticket**: #44
- 1. As Finance, /finance/users → pick bob
- 2. Change role → toggle 'Employee' + 'Approver' chips
- 3. Save
- Expected: bob's role pill shows both; bob's nav contains items for both roles; bob's primaryRole is the higher-privilege one (e.g. approver > employee).

### Test 2.2: primaryRole precedence: finance > approver > employee
**Ticket**: #44, #45
- 1. Create a user with roles [employee, approver, finance]
- Expected: primaryRole = finance. Logged-in user lands on /finance.

### Test 2.3: SoD: claim blocked when employee is the only Finance Admin (self-approval)
**Ticket**: #46
- 1. As the sole finance admin, submit your own claim
- Expected: claim is created with status 'blocked_sod' and an audit entry, NOT 'pending'. Visible in /finance/exceptions with the blocked_sod chip.

### Test 2.4: SoD: blocked_sod claim has routeSteps[] shown in the exception row
**Ticket**: #46, #64
- 1. View a blocked_sod claim in /finance/exceptions
- Expected: clicking the row (or hover) shows the reason 'Claim is at step "X" — not at a Finance step' (or 'Sole Finance admin' etc.)

### Test 2.5: Unblock blocked_sod claim by assigning a manager
**Ticket**: #51, #64
- 1. As Finance, open a blocked_sod claim → 'Resolve SoD'
- 2. Choose action 'Assign a manager' → pick a different approver
- 3. Submit your password for re-auth
- Expected: claim moves from blocked_sod → pending; an audit entry is written; the employee is notified.

### Test 2.6: Unblock via reassign_step
**Ticket**: #51
- 1. Same dialog, choose 'Reassign this step to a different user' → pick an approver
- 2. Submit with valid password
- Expected: claim routes to the new approver; audit entry written.

### Test 2.7: Hard-delete a pending user (re-auth required)
**Ticket**: #42, #41, #64
- 1. As Finance, /finance/users → find a pending user
- 2. Click Delete → confirm → enter your password
- Expected: user disappears from the list; audit entry 'user.deleted' written; toast.

---

## 3. Claim Lifecycle (tickets #4-#9, #13, #21, #22, #28, #34, #36, #38, #39, #40, #46)

### Test 3.1: Employee submits a new claim with line items + receipt
**Ticket**: #4, #5, #6, #7, #8, #9
- 1. As Employee, /employee/claims/new
- 2. Fill in title, pick a category, add a line item with amount + date + receipt
- 3. Submit
- Expected: redirected to the new claim's detail page; status='pending'; visible in the approver's inbox.

### Test 3.2: Approver approves a claim → routes to Finance
**Ticket**: #13, #21, #22
- 1. As Approver, open inbox → claim → Approve
- 2. Add a comment (optional), submit
- Expected: status advances to the next step; the next approver (or finance) sees the claim in their queue.

### Test 3.3: Approver returns a claim for changes (action_required)
**Ticket**: #22
- 1. As Approver, open claim → 'Return to employee' with a comment ≥ 10 chars
- Expected: status='action_required'; employee is notified; employee can edit + resubmit.

### Test 3.4: Mileage line item auto-calculates amount from distance × rate
**Ticket**: #7
- 1. Pick a category with mileage tracking; enter distance_km=10; rate auto-fills from policy
- Expected: amount = 10 * rate. Editable after auto-fill.

### Test 3.5: Pre-submit policy warnings are non-blocking
**Ticket**: #7, #28
- 1. Submit a claim that exceeds a policy cap (e.g. amount > category cap)
- Expected: a warning appears, but Submit is still enabled. After submit, the claim still routes normally.

### Test 3.6: Receipt-required warning blocks submit until a receipt is attached (if the policy is strict)
**Ticket**: #7, #28
- 1. Pick a policy where receipt_required_strict=true; submit with amount over the threshold but no receipt
- Expected: submit is blocked with a clear message; the dialog stays open.

### Test 3.7: Bulk approve 5 claims at once (with re-auth)
**Ticket**: #73, #64
- 1. As Finance, /finance/exceptions → check 5 rows → 'Approve 5'
- 2. Enter your password
- Expected: dialog closes; 5 rows disappear; success toast '5 claims approved'. Audit: 5 'claim.approved.final' rows.

### Test 3.8: Bulk reject with shared comment
**Ticket**: #73
- 1. Same as above but 'Reject 5' with comment 'Receipts missing'
- Expected: 5 claims return to action_required; employees notified with the shared comment.

### Test 3.9: Bulk pay with single method + reference
**Ticket**: #73
- 1. /finance/exceptions → 5 claims with status='approved' → check all → 'Pay 5'
- 2. Method: bank_transfer; reference: 'BATCH-001'
- Expected: 5 payments rows written; 5 claims → paid; nav badge decrements.

### Test 3.10: Claim SLA badge shows on every claim row
**Ticket**: #74
- 1. /employee/claims → any claim; /approver inbox; /finance/exceptions; /finance/payments
- Expected: a colored badge per row: 'Just submitted' / 'Xd open' / 'Aging: Xd' / 'Stale: Xd' / 'Overdue: Xd'

### Test 3.11: Override an exception (resolve flagged policy)
**Ticket**: #13
- 1. /finance/exceptions → open a flagged claim → 'Override' → enter justification
- Expected: claim moves to 'approved' (or whatever the policy action is); audit entry written; employee notified.

### Test 3.12: Reject an exception
**Ticket**: #13
- 1. /finance/exceptions → 'Reject' → enter comment
- Expected: claim → action_required; employee notified.

---

## 4. Payments (tickets #2, #16, #28, #44)

### Test 4.1: Finance sees the payments board
**Ticket**: #16
- 1. /finance/payments
- Expected: 3 sections: Approved (ready for processing), Processing, Paid. Each section shows claim reference + amount + employee.

### Test 4.2: Mark an approved claim as Processing
**Ticket**: #16
- 1. /finance/payments → click 'Mark processing' on an Approved claim
- 2. Enter method (bank_transfer / payroll / check / cash) + reference number
- Expected: claim moves to Processing section; payments row written with status='processing'.

### Test 4.3: Mark a Processing claim as Paid
**Ticket**: #16
- 1. Continue from above; click 'Mark paid'
- Expected: claim moves to Paid section; payments row updated to status='paid' + processed_by/at; employee notified.

### Test 4.4: Hard-delete a hard-delete-friendly user
**Ticket**: #41, #42
- 1. /finance/users → pending or disabled user → Delete → enter password
- Expected: user row removed; not in any list. Audit entry written.

---

## 5. Audit Log + PII Redaction (tickets #34, #71, #72, #77)

### Test 5.1: Audit log viewer at /finance/audit
**Ticket**: #34, #71
- 1. /finance/audit (Finance only)
- Expected: every action (role.change, claim.approved, user.delete, etc.) listed newest first with actor name, target name, before/after JSON toggle, timestamp.

### Test 5.2: Filter audit log by action
**Ticket**: #71
- 1. /finance/audit → Action filter → 'Role change'
- Expected: only role.change entries shown; URL updates to ?action=role.change

### Test 5.3: Filter by date range
**Ticket**: #71
- 1. /finance/audit → set From / To dates
- Expected: entries in that range only.

### Test 5.4: Audit log pagination Next/Prev
**Ticket**: #71
- 1. Seed ≥ 30 entries; click Next, Prev
- Expected: URL ?page=N; rows shift; buttons disable at boundaries.

### Test 5.5: Export audit log as CSV
**Ticket**: #72
- 1. /finance/audit → 'Export CSV' button (top right)
- 2. Browser downloads 'audit-YYYY-MM-DD-HH-mm.csv'
- Expected: file has a header row + one row per entry. Open in Excel — UTF-8 BOM means no garbled text. Commas/quotes/newlines in before/after are quoted per RFC-4180.

### Test 5.6: PII redacted in audit snapshots
**Ticket**: #77
- 1. /finance/audit → find a user.create or role.change entry; click 'Show changes'
- Expected: the before/after JSON has 'passwordHash': '[REDACTED]', 'totpSecret': '[REDACTED]', etc. Email and name are visible.

### Test 5.7: PII redacted on read for legacy rows
**Ticket**: #77
- 1. (Manually insert a row with a legacy unredacted snapshot via SQL)
- 2. /finance/audit
- Expected: that row's before/after is also redacted on the way out (defense-in-depth).

---

## 6. User Management (tickets #14, #15, #30, #32, #33, #36, #41, #42, #43, #53)

### Test 6.1: Add user (creates pending invite)
**Ticket**: #36, #57b, #40
- 1. /finance/users → 'Add User' → name + email + role(s) + Send invite
- Expected: new row appears with status='pending'. In dev mode, the success toast carries the invite URL (devHint). The invite is also written to backend/logs/invites.log.

### Test 6.2: Add user with multiple roles
**Ticket**: #53, #44
- 1. Add User → toggle both 'Employee' and 'Approver'
- Expected: chips show both; primaryRole auto-derives to the higher-privilege one; backend stores roles[] correctly.

### Test 6.3: Change role dialog
**Ticket**: #32, #53
- 1. /finance/users → click role chip on a row → 'Change role'
- Expected: chips pre-filled from current roles; can toggle; on save, audit entry + role pill updates without a refetch.

### Test 6.4: Set manager dialog only shows role:approver candidates
**Ticket**: #43
- 1. /finance/users → click 'Set manager' on an employee row
- Expected: candidate list filtered to active approvers only (no employees, no finance admins). If no candidates, dialog shows empty state.

### Test 6.5: 'Set manager' button hidden on non-employee rows
**Ticket**: #43
- 1. /finance/users → look at an approver or finance admin row
- Expected: no 'Set manager' button. (The button is hidden, not just disabled.)

### Test 6.6: Bulk role change
**Ticket**: #32
- 1. Check ≥ 2 rows → 'Bulk role change' → pick a new role → submit
- Expected: all selected rows update; audit entries; selection cleared.

### Test 6.7: Search + role filter compose with AND
**Ticket**: #14
- 1. /finance/users → type 'rid' in search → click 'Finance' role chip
- Expected: only Finance users with 'rid' in name or email. URL mirrors filters.

### Test 6.8: Deactivate + reactivate user
**Ticket**: #33
- 1. /finance/users → 'Deactivate' on a row → confirm
- 2. The same row now shows 'Reactivate'
- Expected: status='disabled'; user can't sign in; audit entries; Reactivate restores them.

---

## 7. Categories, Policies, Routes (tickets #18, #19, #20, #22, #23, #24)

### Test 7.1: Add a category
**Ticket**: #18
- 1. /finance/policies → Categories tab → 'Add category' → name + code + requires_receipt
- Expected: appears in list; available in the claim wizard's category picker.

### Test 7.2: Edit / deactivate a category
**Ticket**: #18
- 1. Same → 'Edit' or 'Deactivate'
- Expected: updates persist; deactivate marks status='inactive' (no hard delete).

### Test 7.3: Add a policy with thresholds
**Ticket**: #19
- 1. /finance/policies → Policies tab → 'Add policy' → category, max_amount, require_receipt_above
- Expected: appears in list; the policy fires on the next claim in that category that exceeds the threshold.

### Test 7.4: Add an approval route with steps
**Ticket**: #20
- 1. /finance/policies → Routes tab → 'Add route' → name, add 2-3 steps (manager, finance, etc.)
- Expected: route appears; claims matching the policy use this route; route order preserved.

### Test 7.5: Reorder route steps
**Ticket**: #20
- 1. /finance/policies → Routes → 'Reorder' on a route
- 2. Drag-and-drop or move buttons
- Expected: step order persists; affected claims re-resolve on next status change.

---

## 8. Webhooks + Notifications + Email (tickets #65, #75)

### Test 8.1: Set Slack webhook URL
**Ticket**: #75
- 1. In backend/.env, set SPENDFLOW_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
- 2. Restart BE
- 3. Trigger a claim event (submit, approve, pay)
- Expected: the Slack channel receives a MessageCard-shaped payload.

### Test 8.2: Set Teams webhook URL
**Ticket**: #75
- 1. Same env, SPENDFLOW_TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
- 2. Restart + trigger event
- Expected: Teams channel receives the message.

### Test 8.3: Recent webhook events dev panel
**Ticket**: #75
- 1. Set NEXT_PUBLIC_SPENDFLOW_DEV_MODE=true in frontend/.env.local; restart
- 2. /finance/exceptions (as Finance)
- Expected: a 'Recent webhook events' panel shows the last 5 dispatches with delivered/failed badges, claim id, attempt count, last error.

### Test 8.4: Failed webhook does NOT roll back the claim mutation
**Ticket**: #75
- 1. Set SPENDFLOW_SLACK_WEBHOOK_URL=https://invalid.url.example/webhook
- 2. Trigger a claim event
- Expected: claim still mutates successfully (200); webhook event is logged with delivered=false + the network error.

---

## 9. SLA Tracking (tickets #74)

### Test 9.1: Fresh claim → 'Just submitted' badge
**Ticket**: #74
- 1. Submit a claim; check its row in /employee/claims, /approver, /finance/exceptions, /finance/payments
- Expected: every row shows the SLA badge. A claim just submitted shows 'Just submitted' (neutral tone).

### Test 9.2: Old claim → 'Overdue: 12d' badge
**Ticket**: #74
- 1. (Manually backdate a claim's submittedAt to 12 days ago, or wait)
- Expected: badge text 'Overdue: 12d', red error tone.

---

## 10. Rate Limits (tickets #69, #70)

### Test 10.1: Forgot-password: 6th request from one IP is 429
**Ticket**: #69
- 1. POST /api/auth/forgot-password 6 times within 1 hour from the same IP
- Expected: first 5 = 200, 6th = 429 with code 'rate_limited' and Retry-After header.

### Test 10.2: Hard-delete: 11th attempt from one IP is 429
**Ticket**: #70
- 1. Attempt 11 hard-deletes from the same IP (use a script with rotating victim user IDs)
- Expected: 11th = 429.

### Test 10.3: Bulk pay: 31st attempt from one IP is 429
**Ticket**: #70
- 1. 31 bulk-pay requests from the same IP
- Expected: 31st = 429.

---

## 11. Accessibility & UX (cross-cutting)

### Test 11.1: All interactive elements are keyboard-accessible
**Ticket**: M3 baseline
- 1. Tab through /login → /employee → /approver → /finance
- Expected: focus ring visible on every interactive element; Esc closes dialogs; Enter submits forms.

### Test 11.2: Color is M3 tonal (no box-shadows for elevation)
**Ticket**: M3 baseline
- 1. Inspect any card / sheet / dialog
- Expected: elevation is conveyed via surface-container / surface-container-high background colors, NOT box-shadow.

### Test 11.3: Dark mode toggle works
**Ticket**: M3 baseline
- 1. Click the theme toggle (top right)
- Expected: site-wide colors flip to dark; preference persists across reload.

### Test 11.4: SLA badge has hover tooltip with threshold days
**Ticket**: #74
- 1. Hover an SLA badge for a few seconds
- Expected: tooltip 'Threshold is X days'.

### Test 11.5: Defensive skip when SLA missing on a row
**Ticket**: #74
- 1. (Manually remove the sla field from a row's API response in DevTools)
- Expected: the row still renders, no crash, no badge.

---

## 12. Performance smoke checks (one per app surface)

### Test 12.1: Login responds in < 500ms (local)
**Ticket**: non-functional
- 1. /login → enter creds → submit
- Expected: login → dashboard in < 500ms on a local laptop.

### Test 12.2: List endpoints handle 100 records in < 200ms
**Ticket**: non-functional
- 1. Seed the DB with 100+ claims; /finance/exceptions + /finance/payments + /finance/audit
- Expected: first paint < 200ms; pagination smooth.

---

## Appendix A: environment setup

```bash
# Backend
cd backend
cp .env.example .env       # add RESEND_API_KEY, FE_URL, SPENDFLOW_SLACK_WEBHOOK_URL if you want webhooks
npm install
npm run db:migrate
npm run db:seed
npm run dev               # starts on http://localhost:8787

# Frontend (separate terminal)
cd frontend
cp .env.example .env.local
# add: NEXT_PUBLIC_BE_URL=http://localhost:8787
# add: NEXT_PUBLIC_SPENDFLOW_DEV_MODE=true (to see dev panels)
npm install
npm run dev               # starts on http://localhost:3000
```

---

## Appendix B: seed data summary

After `npm run db:seed` you have:
- 5 demo users (one per role: employee, approver, finance, plus 2 with multi-role)
- ~12 claims across every status (draft, pending, approved, processing, paid, rejected, blocked_sod, action_required)
- 3 categories (taxi, meals, hotel) + 2 policies + 2 routes (manager-step + finance-only)
- An audit log seeded with ~10 representative entries

---

## Appendix C: passing criteria for a release

- All 'Authentication & Sessions' tests pass
- All 'Multi-Role & SoD' tests pass (the multi-role epic is the most-tested surface)
- All 'Claim Lifecycle' happy paths pass
- All 'Audit Log + PII Redaction' tests pass (PII redaction is a hard requirement)
- All 'Rate Limits' tests pass (security)
- Slack/Teams webhook tests pass (if you have webhook URLs configured)
- Performance smoke checks: login < 500ms, list endpoints < 200ms with 100 records

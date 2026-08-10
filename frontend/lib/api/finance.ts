/* ============================================================================
 * SpendFlow — Finance exception + payment lifecycle HTTP client (ticket #20).
 *
 * Thin typed wrapper over `/api/finance/*` (BE #13). Every call goes through
 * `apiFetch` (#17), which sends `credentials: "include"` (httpOnly session
 * cookie), resolves against `NEXT_PUBLIC_BE_URL`, and fires the global 401
 * handler. Non-2xx responses are thrown as `FinanceApiError` carrying the
 * backend's `code` + `message` so the UI can surface them inline:
 *   - `comment_required`     (400) — override / reject without a justification
 *   - `validation_required`  (400) — mark-processing missing method/reference
 *   - `invalid_body`         (400) — request body failed zod parse
 *   - `stale_decision`       (409) — claim no longer in the expected status
 *   - `forbidden`            (403) — caller is not a Finance Admin
 *   - `not_found`            (404) — unknown claim / line item id
 *
 * The BE ships no dedicated `/api/finance/dashboard` endpoint, so
 * `getDashboard()` composes the dashboard payload from `getExceptions()` +
 * `getPayments()` (two parallel GETs) and shapes it into the
 * `FinanceDashboardData` contract the dashboard page already renders.
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";
import { toFEClaim, type BackendClaim } from "@/lib/api/claims";
import { UsersApiError } from "@/lib/api/users";
import type {
  Claim,
  ClaimPayment,
  ClaimStatus,
} from "@/lib/types";
import type { CurrencyCode } from "@/lib/format";

/** Typed error carrying the backend's status + code + message. */
export class FinanceApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "FinanceApiError";
    this.status = status;
    this.code = code;
  }
}

/* --------------------------------------------------------------- backend types */

/**
 * One step of the route a `blocked_sod` claim was submitted against (#48).
 * Surfaced on exception items so the unblock dialog's `reassign_step` action
 * can offer the step picker without a second round trip.
 */
export interface FinanceRouteStep {
  id: string;
  label: string;
  approverType: "submitter_manager" | "specific_user" | "finance";
  approverId: string | null;
}

/**
 * JSON shape returned by the BE's `ExceptionQueueItem` serialiser. A full
 * `ClaimRow` (claim + lineItems) enriched with the employee's display name and
 * the count of open line-item policy flags. See `services/finance.ts`.
 */
export interface BackendExceptionItem extends BackendClaim {
  employeeName: string;
  openFlagCount: number;
  /** Present only on `blocked_sod` items — powers the unblock dialog (#48). */
  routeSteps?: FinanceRouteStep[];
}

/** `PaymentRow` from `services/finance.ts` (ISO date strings over the wire). */
export interface BackendPaymentRow {
  id: string;
  claimId: string;
  method: "bank_transfer" | "payroll";
  referenceNumber: string;
  amount: number;
  currency: string;
  status: "processing" | "paid";
  processedBy: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `PaymentQueueItem` from `services/finance.ts` — a flat per-claim summary used
 * to render the payment board columns without shipping every line item. The
 * optional `payment` row is present once the claim has entered Processing.
 */
export interface BackendPaymentQueueItem {
  id: string;
  reference: string;
  title: string;
  employeeId: string;
  employeeName: string;
  currency: string;
  totalAmount: number;
  status: ClaimStatus;
  payment: BackendPaymentRow | null;
}

/* ------------------------------------------------------------------ FE shapes */

/**
 * FE-facing exception row: a full `Claim` (line items are rendered in the
 * resolve dialog's flagged-lines panel) plus the BE-provided employee name and
 * open-flag count so the queue table doesn't depend on the mock user store.
 */
export interface FinanceExceptionItem extends Claim {
  employeeName: string;
  openFlagCount: number;
  /** Present only on `blocked_sod` rows — powers the unblock dialog (#48). */
  routeSteps?: FinanceRouteStep[];
}

/**
 * FE-facing payment board row. Flat (no line items) because the payment board
 * only renders claim-level totals + payment metadata. `totalAmount` is the
 * BE-computed sum so the board doesn't recompute it client-side.
 */
export interface FinancePaymentItem {
  id: string;
  reference: string;
  title: string;
  employeeId: string;
  employeeName: string;
  currency: CurrencyCode;
  status: ClaimStatus;
  totalAmount: number;
  /** Adapted FE payment metadata; present once the claim enters Processing. */
  payment?: ClaimPayment;
}

export interface FinanceGroup {
  status: "approved" | "processing" | "paid";
  label: string;
  claims: FinancePaymentItem[];
  count: number;
  amount: number;
}

/**
 * Dashboard payload composed client-side from the exceptions + payments
 * endpoints. Structurally identical to the `FinanceDashboardData` consumed by
 * `lib/hooks/useFinanceDashboard.ts` so the dashboard page's `DashboardBody`
 * keeps its render contract — only the array element types widen to carry the
 * BE-provided `employeeName` / `totalAmount`.
 */
export interface FinanceDashboardData {
  exceptions: FinanceExceptionItem[];
  readyToPay: FinancePaymentItem[];
  inFlight: FinancePaymentItem[];
  recentPaid: FinancePaymentItem[];
  groups: FinanceGroup[];
  openExceptionCount: number;
  readyToPayCount: number;
  inFlightCount: number;
  paidCount: number;
  readyToPayAmount: number;
  inFlightAmount: number;
  paidAmount: number;
  /** True when at least one claim is in any payment-lifecycle status. */
  hasAnyPaymentActivity: boolean;
}

/* ---------------------------------------------------------------- write inputs */

export type ExceptionAction = "override" | "reject";

export interface ResolveExceptionInput {
  action: ExceptionAction;
  lineItemId?: string;
  /** Required justification / comment — BE enforces non-empty. */
  comment: string;
}

export interface MarkProcessingInput {
  method: "bank_transfer" | "payroll";
  reference: string;
}

/**
 * Body for `PATCH /api/admin/claims/:id/unblock` (#48). A Finance Admin
 * re-routes a `blocked_sod` claim by either assigning a manager to the
 * submitter (`assign_manager` → `managerId`) or repointing one route step's
 * approver (`reassign_step` → `stepId` + `newApproverId`). `resolution` is the
 * required free-text justification recorded on the audit entry.
 */
export interface UnblockClaimInput {
  resolution: string;
  action: "assign_manager" | "reassign_step";
  managerId?: string;
  stepId?: string;
  newApproverId?: string;
}

export interface ResolveExceptionResult {
  claim: Claim;
  action: ExceptionAction;
}

export interface PaymentTransitionResult {
  claim: Claim;
  payment: ClaimPayment;
}

/* --------------------------------------------------------------- error helper */

/** Constructor shape shared by the typed API errors (status + code + message). */
type ApiErrorCtor = new (
  status: number,
  code: string,
  message: string
) => { status: number; code: string; message: string };

async function readError(
  res: Response,
  ErrorCtor: ApiErrorCtor = FinanceApiError
): Promise<never> {
  let code = "internal";
  let message = `Request failed (${res.status}).`;
  try {
    const body = await res.json();
    const err = body?.error;
    if (err && typeof err === "object") {
      if (typeof err.code === "string") code = err.code;
      if (typeof err.message === "string" && err.message.trim()) message = err.message;
    } else if (typeof err === "string" && err.trim()) {
      message = err;
    } else if (typeof body?.message === "string" && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // non-JSON body — keep the status-derived fallback
  }
  throw new ErrorCtor(res.status, code, message);
}

/** Read + parse a JSON envelope, throwing the typed API error on non-2xx. */
async function parseJson<T>(
  res: Response,
  ErrorCtor: ApiErrorCtor = FinanceApiError
): Promise<T> {
  if (!res.ok) await readError(res, ErrorCtor);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ErrorCtor(res.status, "internal", "Invalid JSON response from backend.");
  }
}

/* ------------------------------------------------------------------ adapters */

/**
 * Adapt the BE's `PaymentRow` into the FE `ClaimPayment` shape that the
 * payment board + dashboard already render. The BE stamps `processedAt`/
 * `processedBy` at Processing time and OVERWRITES them at Paid time (there is
 * no separate `paidAt` column), so a paid row's `processedAt` IS the paid-at —
 * mapped onto `paidAt`/`paidBy` when `status === "paid"` so the board's
 * "paid {date}" copy reads correctly.
 */
export function toFEPayment(p: BackendPaymentRow): ClaimPayment {
  const paid = p.status === "paid";
  const stampedAt = p.processedAt ?? undefined;
  const stampedBy = p.processedBy ?? undefined;
  return {
    method: p.method,
    reference: p.referenceNumber,
    processedBy: paid ? undefined : stampedBy,
    processedAt: paid ? undefined : stampedAt,
    paidBy: paid ? stampedBy : undefined,
    paidAt: paid ? stampedAt : undefined,
  };
}

/** Adapt a BE `PaymentQueueItem` into the flat FE payment-board row. */
export function toFinancePaymentItem(
  item: BackendPaymentQueueItem,
): FinancePaymentItem {
  return {
    id: item.id,
    reference: item.reference,
    title: item.title,
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    currency: (item.currency as CurrencyCode) ?? "IDR",
    status: item.status,
    totalAmount: item.totalAmount,
    payment: item.payment ? toFEPayment(item.payment) : undefined,
  };
}

/** Adapt a BE `ExceptionQueueItem` into the FE exception row (full claim). */
export function toFinanceExceptionItem(
  item: BackendExceptionItem,
): FinanceExceptionItem {
  return {
    ...toFEClaim(item),
    employeeName: item.employeeName,
    openFlagCount: item.openFlagCount,
    routeSteps: item.routeSteps,
  };
}

/* --------------------------------------------------------------- composition */

function buildGroup(
  status: FinanceGroup["status"],
  claims: FinancePaymentItem[],
): FinanceGroup {
  const label =
    status === "approved"
      ? "Ready to pay"
      : status === "processing"
        ? "Processing"
        : "Paid";
  return {
    status,
    label,
    claims,
    count: claims.length,
    amount: claims.reduce((s, c) => s + c.totalAmount, 0),
  };
}

/**
 * Compose the dashboard payload from the two BE reads. The exceptions call
 * yields the open-flag count (and the underlying claims); the payments call
 * yields the three payment-lifecycle columns. Totals are derived from the
 * BE-computed `totalAmount` so they stay consistent with the board even when
 * no claims are Processing or Paid.
 */
function composeDashboard(
  exceptions: FinanceExceptionItem[],
  payments: {
    approved: FinancePaymentItem[];
    processing: FinancePaymentItem[];
    paid: FinancePaymentItem[];
  },
): FinanceDashboardData {
  const readyToPay = payments.approved;
  const inFlight = payments.processing;
  const recentPaid = payments.paid;
  const groups: FinanceGroup[] = [
    buildGroup("approved", readyToPay),
    buildGroup("processing", inFlight),
    buildGroup("paid", recentPaid),
  ];
  const byStatus = (s: FinanceGroup["status"]) =>
    groups.find((g) => g.status === s)!;
  return {
    exceptions,
    readyToPay,
    inFlight,
    recentPaid,
    groups,
    openExceptionCount: exceptions.length,
    readyToPayCount: byStatus("approved").count,
    inFlightCount: byStatus("processing").count,
    paidCount: byStatus("paid").count,
    readyToPayAmount: byStatus("approved").amount,
    inFlightAmount: byStatus("processing").amount,
    paidAmount: byStatus("paid").amount,
    hasAnyPaymentActivity:
      byStatus("approved").count +
        byStatus("processing").count +
        byStatus("paid").count >
      0,
  };
}

/* ----------------------------------------------------------------- methods */

/**
 * `GET /api/finance/exceptions` + `GET /api/finance/payments` composed into
 * the dashboard payload. Both calls run in parallel; either failing throws a
 * `FinanceApiError` (a 403 on non-Finance-Admin access surfaces as the
 * dashboard's access-denied state via the hook).
 */
export async function getDashboard(): Promise<FinanceDashboardData> {
  const [exceptions, payments] = await Promise.all([
    getExceptions(),
    getPayments(),
  ]);
  return composeDashboard(exceptions, payments);
}

/**
 * `GET /api/finance/exceptions` — fully approved claims with at least one open
 * line-item policy flag, plus the employee name + open flag count.
 */
export async function getExceptions(): Promise<FinanceExceptionItem[]> {
  const body = await parseJson<{ items: BackendExceptionItem[] }>(
    await apiFetch(`/api/finance/exceptions`, { method: "GET" }),
  );
  return body.items.map(toFinanceExceptionItem);
}

/**
 * `POST /api/finance/exceptions/:claimId/resolve` — override (clear the flag,
 * claim stays Approved) or reject (return to employee as Action Required).
 * Both actions require a non-empty justification/comment; the BE returns 400
 * `comment_required` otherwise. A claim no longer Approved returns 409
 * `stale_decision` so the FE can surface the existing stale panel.
 */
export async function resolveException(
  claimId: string,
  input: ResolveExceptionInput,
): Promise<ResolveExceptionResult> {
  const body = await parseJson<{ claim: BackendClaim; action: ExceptionAction }>(
    await apiFetch(
      `/api/finance/exceptions/${encodeURIComponent(claimId)}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    ),
  );
  return { claim: toFEClaim(body.claim), action: body.action };
}

/**
 * `GET /api/finance/payments` — claims grouped by reimbursement stage
 * (Approved / Processing / Paid). Flagged approved claims are excluded by the
 * BE (they sit in the exception queue until resolved).
 */
export async function getPayments(): Promise<{
  approved: FinancePaymentItem[];
  processing: FinancePaymentItem[];
  paid: FinancePaymentItem[];
}> {
  const body = await parseJson<{
    approved: BackendPaymentQueueItem[];
    processing: BackendPaymentQueueItem[];
    paid: BackendPaymentQueueItem[];
  }>(await apiFetch(`/api/finance/payments`, { method: "GET" }));
  return {
    approved: body.approved.map(toFinancePaymentItem),
    processing: body.processing.map(toFinancePaymentItem),
    paid: body.paid.map(toFinancePaymentItem),
  };
}

/**
 * `POST /api/finance/payments/:claimId/processing` — capture method +
 * reference and transition an Approved claim to Processing. The BE requires a
 * non-empty reference (400 `validation_required` otherwise) and that the claim
 * is currently Approved (409 `stale_decision` otherwise).
 */
export async function markProcessing(
  claimId: string,
  input: MarkProcessingInput,
): Promise<PaymentTransitionResult> {
  const body = await parseJson<{ claim: BackendClaim; payment: BackendPaymentRow }>(
    await apiFetch(
      `/api/finance/payments/${encodeURIComponent(claimId)}/processing`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    ),
  );
  return { claim: toFEClaim(body.claim), payment: toFEPayment(body.payment) };
}

/**
 * `POST /api/finance/payments/:claimId/paid` — confirm disbursement of a
 * Processing claim. The BE stamps processed-by/processed-at (overwriting the
 * processing-start values) and transitions the claim to Paid. A claim not
 * currently Processing (or with no payments row) returns 409 `stale_decision`.
 */
export async function markPaid(claimId: string): Promise<PaymentTransitionResult> {
  const body = await parseJson<{ claim: BackendClaim; payment: BackendPaymentRow }>(
    await apiFetch(
      `/api/finance/payments/${encodeURIComponent(claimId)}/paid`,
      {
        method: "POST",
      },
    ),
  );
  return { claim: toFEClaim(body.claim), payment: toFEPayment(body.payment) };
}

/**
 * `PATCH /api/admin/claims/:id/unblock` (#48) — Finance Admin re-routes a
 * `blocked_sod` claim so it returns to `pending`. Two actions, mirroring the
 * BE service (`services/claims.ts:unblockClaim`):
 *   - `assign_manager`: stamp a manager on the submitter (`managerId`)
 *   - `reassign_step`: repoint one route step's approver (`stepId` +
 *     `newApproverId`)
 * `resolution` is a required audit justification. Errors are thrown as
 * `UsersApiError` (the endpoint lives in the admin vertical): 400
 * `invalid_body`, 401 `invalid_password`/`missing_password` (actor re-auth,
 * #64), 404 `not_found` / `invalid_manager` / `invalid_step` /
 * `invalid_approver`, 403 `forbidden`, 409 `not_blocked`, and 409
 * `still_blocked` — the last one carries the BE's SoD message verbatim so the
 * unblock dialog can surface "That reassignment would still violate SoD".
 *
 * `password` (#64) is the actor's own password, verified server-side via
 * `requirePasswordReauth` before the claim is mutated. The dialog passes it
 * and refuses to submit until it is non-empty.
 */
export async function unblockClaim(
  claimId: string,
  input: UnblockClaimInput,
  password?: string,
): Promise<{ claim: BackendClaim }> {
  const body = await parseJson<{ claim: BackendClaim }>(
    await apiFetch(
      `/api/admin/claims/${encodeURIComponent(claimId)}/unblock`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...input,
          ...(password ? { password } : {}),
        }),
      },
    ),
    UsersApiError,
  );
  return { claim: body.claim };
}

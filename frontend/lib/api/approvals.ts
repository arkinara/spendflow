/* ============================================================================
 * SpendFlow — Approver inbox + decisioning HTTP client (ticket #19, FE wiring).
 *
 * Thin typed wrapper over `/api/approver/*` (BE #12). Every call goes through
 * `apiFetch` (#17), which sends `credentials: "include"` (httpOnly session
 * cookie), resolves against `NEXT_PUBLIC_BE_URL`, and fires the global 401
 * handler. Non-2xx responses are thrown as `ApprovalApiError` carrying the
 * backend's `code` + `message` so the UI can surface them inline:
 *   - `comment_required` (400) — Reject / Request-Changes without a comment
 *   - `stale_decision`  (409) — claim no longer at this approver's step
 *   - `forbidden`       (403) — cross-approver access denied
 *   - `not_found`       (404) — unknown claim id
 *   - `no_route`        (503) — claim's route config disappeared
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";
import { toFEClaim, type BackendClaim } from "@/lib/api/claims";
import type { Claim, SlaSummary } from "@/lib/types";

/** Typed error carrying the backend's status + code + message. */
export class ApprovalApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApprovalApiError";
    this.status = status;
    this.code = code;
  }
}

/* --------------------------------------------------------------- backend types */

/** JSON shape returned by the inbox query (`InboxItem` in `services/approvals.ts`). */
export interface BackendInboxItem {
  id: string;
  reference: string;
  title: string;
  employeeId: string;
  employeeName: string;
  status: string;
  currency: string;
  totalAmount: number;
  /** ISO string (or null for unsubmitted). */
  submittedAt: string | null;
  currentStepIndex: number;
  stepLabel: string;
  /** SLA summary stamped by the BE on inbox rows (#74); absent on some rows. */
  sla?: SlaSummary;
}

/** One routing step on the claim's resolved approval route. */
export interface BackendRoutingStep {
  id: string;
  approverType: "submitter_manager" | "specific_user" | "finance";
  approverId?: string;
  label: string;
}

/** `ApproverClaimDetail` from `services/approvals.ts` (a ClaimRow + extras). */
export interface BackendApproverClaimDetail extends BackendClaim {
  employeeName: string;
  steps: BackendRoutingStep[];
  currentStep: BackendRoutingStep | null;
}

export type DecisionAction = "approve" | "reject" | "request_changes";

export interface DecisionInput {
  action: DecisionAction;
  comment?: string;
}

export interface DecisionResult {
  claim: Claim;
  action: DecisionAction;
  advanced: boolean;
  finalised: boolean;
}

/* --------------------------------------------------------------- error helper */

async function readError(res: Response): Promise<never> {
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
  throw new ApprovalApiError(res.status, code, message);
}

/** Read + parse a JSON envelope, throwing `ApprovalApiError` on non-2xx. */
async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) await readError(res);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApprovalApiError(res.status, "internal", "Invalid JSON response from backend.");
  }
}

/* ----------------------------------------------------------------- methods */

/**
 * `GET /api/approver/inbox` — claims currently sitting at the caller's step.
 * `sortBy` / `sortDir` are forwarded as `sort_by` / `sort_dir` query params;
 * the BE defaults to `submitted_at` + `desc` when omitted. The caller's
 * identity is inferred from the session.
 */
export async function listInbox(
  opts: { sortBy?: "submitted_at" | "amount"; sortDir?: "asc" | "desc" } = {},
): Promise<BackendInboxItem[]> {
  const qs = new URLSearchParams();
  if (opts.sortBy) qs.set("sort_by", opts.sortBy);
  if (opts.sortDir) qs.set("sort_dir", opts.sortDir);
  const tail = qs.toString() ? `?${qs.toString()}` : "";
  const body = await parseJson<{ items: BackendInboxItem[] }>(
    await apiFetch(`/api/approver/inbox${tail}`, { method: "GET" }),
  );
  return body.items;
}

/**
 * `GET /api/approver/claims/:id` — claim detail enriched for review. The BE
 * rejects with 403 `forbidden` when the claim is not at the caller's step
 * (cross-approver access or already-decided claim). Returns the adapted FE
 * `Claim` plus the approver-only metadata (`employeeName`, `steps`,
 * `currentStep`).
 */
export async function getClaimForReview(
  id: string,
): Promise<{
  claim: Claim;
  employeeName: string;
  steps: BackendRoutingStep[];
  currentStep: BackendRoutingStep | null;
}> {
  const body = await parseJson<{ claim: BackendApproverClaimDetail }>(
    await apiFetch(`/api/approver/claims/${encodeURIComponent(id)}`, { method: "GET" }),
  );
  const detail = body.claim;
  return {
    claim: toFEClaim(detail),
    employeeName: detail.employeeName,
    steps: detail.steps,
    currentStep: detail.currentStep,
  };
}

/**
 * `POST /api/approver/claims/:id/decisions` — record approve / reject /
 * request_changes. Reject and request_changes require a non-empty comment; the
 * BE returns 400 `comment_required` otherwise. A concurrent or prior decision
 * on the same claim/step returns 409 `stale_decision`. Resolves to the BE's
 * result envelope with the updated claim adapted to the FE shape.
 */
export async function decide(id: string, input: DecisionInput): Promise<DecisionResult> {
  const body = await parseJson<{
    claim: BackendClaim;
    action: DecisionAction;
    advanced: boolean;
    finalised: boolean;
  }>(
    await apiFetch(`/api/approver/claims/${encodeURIComponent(id)}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return {
    claim: toFEClaim(body.claim),
    action: body.action,
    advanced: body.advanced,
    finalised: body.finalised,
  };
}

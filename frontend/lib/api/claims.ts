/* ============================================================================
 * SpendFlow — Claim HTTP client (ticket #18, FE wiring).
 *
 * Thin typed wrapper over `/api/claims/*` for the Employee vertical. Every
 * call goes through `apiFetch` (#17), which sends `credentials: "include"`
 * (httpOnly session cookie), resolves against `NEXT_PUBLIC_BE_URL`, and fires
 * the global 401 handler. Non-2xx responses are thrown as `ClaimApiError`
 * carrying the backend's `code` + `message` so the UI can surface them inline
 * (stale-decision conflicts, validation 400s, cross-employee 403s, …).
 *
 * The backend ships NO combined create+submit endpoint, so the wizard calls
 * `createClaim` (draft) → `uploadAttachment` per receipt → `submitClaim`. The
 * backend also ships no list-attachments endpoint, so a fully-reloaded detail
 * view can only show the per-line `hasReceipt` flag for attachments (see
 * `useClaimDetail` + the detail page); in-session uploads remain visible via
 * the wizard→detail handoff. That gap is flagged for a future BE ticket.
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";
import { BE_URL } from "@/lib/auth/apiClient";
import type {
  Attachment,
  Claim,
  ClaimException,
  ClaimStatus,
  ExpenseCategoryId,
  LineItem,
} from "@/lib/mock/mock_data";
import type { CurrencyCode } from "@/lib/format";

/** Typed error carrying the backend's status + code + message. */
export class ClaimApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ClaimApiError";
    this.status = status;
    this.code = code;
  }
}

/* --------------------------------------------------------------- backend types */

/**
 * JSON shape returned by the backend's `ClaimRow` serialiser
 * (`backend/src/services/claims.ts:toClaimRow`). Dates arrive as ISO strings.
 * `lineItems.policyFlag` is a serialised `PolicyWarning[]`. Top-level
 * `policyException` is a `ClaimPolicySummary`.
 */
export interface BackendLineItem {
  id: string;
  claimId: string;
  categoryId: string;
  description: string;
  date: string;
  amount: number;
  currency: string;
  quantity: number | null;
  unitLabel: string | null;
  unitRate: number | null;
  hasReceipt: boolean;
  note: string | null;
  policyFlag: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface BackendPolicySummary {
  type: "missing_receipt" | "over_policy" | "currency_mismatch";
  severity: "high" | "medium";
  message: string;
  count: number;
}

export interface BackendClaim {
  id: string;
  reference: string;
  title: string;
  purpose: string;
  employeeId: string;
  status: ClaimStatus;
  currency: string;
  tripStart: string | null;
  tripEnd: string | null;
  destination: string | null;
  approvalRouteId: string | null;
  currentStepIndex: number;
  policyException: BackendPolicySummary | null;
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: BackendLineItem[];
}

export interface BackendAuditEntry {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface BackendSubmitResult {
  claim: BackendClaim;
  warnings: unknown[];
  summary: BackendPolicySummary | null;
}

/* --------------------------------------------------------------- write inputs */

export interface ClaimDraftLine {
  categoryId: string;
  description?: string;
  date: string;
  amount?: number;
  currency?: string;
  quantity?: number;
  unitLabel?: string;
  note?: string;
}

export interface ClaimDraft {
  title: string;
  purpose?: string;
  currency?: string;
  tripStart?: string;
  tripEnd?: string;
  destination?: string;
  lineItems?: ClaimDraftLine[];
}

export interface ClaimPatch {
  title?: string;
  purpose?: string;
  currency?: string;
  tripStart?: string | null;
  tripEnd?: string | null;
  destination?: string | null;
}

export interface ClaimListFilters {
  /** Statuses to filter on; comma-joined into `?status=`. */
  status?: ClaimStatus[];
}

export interface AttachmentMeta {
  merchant?: string;
  amount?: number;
  currency?: string;
  transactionDate?: string;
}

/* ------------------------------------------------------------------ adapters */

function toIso(d: string | null | undefined): string | undefined {
  return d ?? undefined;
}

/**
 * Adapt the backend's serialised `ClaimRow` into the FE `Claim` shape that
 * page components already consume. Fields the backend does not surface
 * (`attachments`, `approvals`) default to empty arrays — the detail timeline
 * reads from the audit endpoint, and attachments render from the per-line
 * `hasReceipt` flag plus any in-session uploads the wizard carries over.
 */
export function toFEClaim(b: BackendClaim): Claim {
  const lineItems: LineItem[] = b.lineItems.map((l) => ({
    id: l.id,
    categoryId: l.categoryId as ExpenseCategoryId,
    description: l.description,
    date: l.date,
    amount: l.amount,
    currency: (l.currency as CurrencyCode) ?? (b.currency as CurrencyCode),
    quantity: l.quantity ?? undefined,
    unitLabel: l.unitLabel ?? undefined,
    unitRate: l.unitRate ?? undefined,
    hasReceipt: l.hasReceipt,
    note: l.note ?? undefined,
  }));

  const exception: ClaimException | undefined = b.policyException
    ? {
        id: `${b.id}-exc`,
        type: b.policyException.type === "currency_mismatch"
          ? "over_policy"
          : b.policyException.type,
        severity: b.policyException.severity,
        message: b.policyException.message,
        flaggedAt: b.submittedAt ?? b.createdAt,
        status: "open",
      }
    : undefined;

  return {
    id: b.id,
    reference: b.reference,
    title: b.title,
    purpose: b.purpose,
    employeeId: b.employeeId,
    status: b.status,
    currency: (b.currency as CurrencyCode) ?? "IDR",
    createdAt: b.createdAt,
    submittedAt: toIso(b.submittedAt),
    decidedAt: toIso(b.decidedAt),
    tripStart: toIso(b.tripStart),
    tripEnd: toIso(b.tripEnd),
    destination: toIso(b.destination),
    lineItems,
    attachments: [] as Attachment[],
    approvals: [],
    exception,
    currentStepIndex: b.currentStepIndex,
  };
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
  throw new ClaimApiError(res.status, code, message);
}

/** Read + parse a JSON envelope, throwing `ClaimApiError` on non-2xx. */
async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) await readError(res);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ClaimApiError(res.status, "internal", "Invalid JSON response from backend.");
  }
}

/* ----------------------------------------------------------------- methods */

/** `GET /api/claims?status=…` — caller's own claims (BE infers identity). */
export async function listClaims(filters?: ClaimListFilters): Promise<Claim[]> {
  const qs = new URLSearchParams();
  if (filters?.status?.length) qs.set("status", filters.status.join(","));
  const tail = qs.toString() ? `?${qs.toString()}` : "";
  const body = await parseJson<{ claims: BackendClaim[] }>(
    await apiFetch(`/api/claims${tail}`, { method: "GET" }),
  );
  return body.claims.map(toFEClaim);
}

/** `GET /api/claims/:id` — single claim. Throws 403 (`forbidden`) on cross-employee access. */
export async function getClaim(id: string): Promise<Claim> {
  const body = await parseJson<{ claim: BackendClaim }>(
    await apiFetch(`/api/claims/${encodeURIComponent(id)}`, { method: "GET" }),
  );
  return toFEClaim(body.claim);
}

/**
 * `GET /api/claims/:id/audit` — chronological audit timeline (oldest first).
 * The BE rejects non-participants with 403; that surfaces as `ClaimApiError`.
 */
export async function getClaimAudit(id: string): Promise<BackendAuditEntry[]> {
  const body = await parseJson<{ entries: BackendAuditEntry[] }>(
    await apiFetch(`/api/claims/${encodeURIComponent(id)}/audit`, { method: "GET" }),
  );
  return body.entries;
}

/** `POST /api/claims` — create a Draft claim, optionally with initial line items. */
export async function createClaim(draft: ClaimDraft): Promise<Claim> {
  const body = await parseJson<{ claim: BackendClaim }>(
    await apiFetch(`/api/claims`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    }),
  );
  return toFEClaim(body.claim);
}

/** `PATCH /api/claims/:id` — edit top-level fields (Draft / Action Required only). */
export async function updateClaim(id: string, patch: ClaimPatch): Promise<Claim> {
  const body = await parseJson<{ claim: BackendClaim }>(
    await apiFetch(`/api/claims/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
  return toFEClaim(body.claim);
}

/** `POST /api/claims/:id/submit` — submit a Draft claim for approval. */
export async function submitClaim(id: string): Promise<Claim> {
  const body = await parseJson<BackendSubmitResult>(
    await apiFetch(`/api/claims/${encodeURIComponent(id)}/submit`, {
      method: "POST",
    }),
  );
  return toFEClaim(body.claim);
}

/**
 * `POST /api/claims/:id/withdraw` — pull a Pending claim back to Action
 * Required. Optional comment recorded on the timeline.
 */
export async function withdrawClaim(id: string, comment?: string): Promise<Claim> {
  const body = await parseJson<{ claim: BackendClaim }>(
    await apiFetch(`/api/claims/${encodeURIComponent(id)}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: comment ?? null }),
    }),
  );
  return toFEClaim(body.claim);
}

/** `POST /api/claims/:id/resubmit` — push an Action-Required claim back into review. */
export async function resubmitClaim(id: string): Promise<Claim> {
  const body = await parseJson<BackendSubmitResult>(
    await apiFetch(`/api/claims/${encodeURIComponent(id)}/resubmit`, {
      method: "POST",
    }),
  );
  return toFEClaim(body.claim);
}

/**
 * `POST /api/claims/:claimId/line-items/:lineId/attachments` — multipart
 * upload of a receipt (image/PDF) plus manual metadata. Reports progress via
 * the optional `onProgress` callback (XMLHttpRequest-path; `fetch` has no
 * upload progress event). Resolves to the stored attachment's id.
 *
 * NOTE: the ticket body lists `uploadAttachment(lineItemId, file, meta)`, but
 * the backend route is parameterised by both claim id and line id, so the
 * claim id is taken as the first argument. This is documented here rather
 * than silently dropped.
 */
export function uploadAttachment(
  claimId: string,
  lineItemId: string,
  file: File,
  meta: AttachmentMeta = {},
  onProgress?: (ratio: number) => void,
): Promise<string> {
  // `apiFetch` is `fetch`-based and has no upload-progress hook, so for the
  // progress-capable path we use XHR against the same BE URL with the same
  // credentials mode. A plain `fetch` fallback would lose progress reporting.
  return new Promise((resolve, reject) => {
    const url = `/api/claims/${encodeURIComponent(claimId)}/line-items/${encodeURIComponent(
      lineItemId,
    )}/attachments`;
    const form = new FormData();
    form.append("file", file);
    if (meta.merchant) form.append("merchant", meta.merchant);
    if (meta.amount != null) form.append("amount", String(meta.amount));
    if (meta.currency) form.append("currency", meta.currency);
    if (meta.transactionDate) form.append("transactionDate", meta.transactionDate);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", resolveBeUrl(url));
    xhr.withCredentials = true;
    xhr.responseType = "json";

    if (onProgress && xhr.upload) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    }

    xhr.addEventListener("load", () => {
      const status = xhr.status;
      const body =
        typeof xhr.response === "string" ? safeJson(xhr.response) : xhr.response;
      if (status >= 200 && status < 300) {
        const id = body?.attachment?.id;
        if (typeof id === "string") resolve(id);
        else reject(new ClaimApiError(status, "internal", "Upload response missing attachment id."));
      } else {
        const code = body?.error?.code ?? "internal";
        const message =
          body?.error?.message ?? `Upload failed (${status}).`;
        reject(new ClaimApiError(status, code, message));
      }
    });
    xhr.addEventListener("error", () => {
      reject(new ClaimApiError(0, "network", "Attachment upload failed (network error)."));
    });
    xhr.addEventListener("abort", () => {
      reject(new ClaimApiError(0, "aborted", "Attachment upload aborted."));
    });

    xhr.send(form);
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Resolve a relative BE path against `BE_URL` for the XHR path. */
function resolveBeUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${BE_URL}${path}`;
}

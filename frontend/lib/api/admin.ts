/* ============================================================================
 * SpendFlow — Policy, Category & Approval Routing Administration HTTP client
 * (ticket #21, FE wiring).
 *
 * Thin typed wrapper over `/api/admin/*` (BE #14). Every call goes through
 * `apiFetch` (#17), which sends `credentials: "include"` (httpOnly session
 * cookie), resolves against `NEXT_PUBLIC_BE_URL`, and fires the global 401
 * handler. Non-2xx responses are thrown as `AdminApiError` carrying the
 * backend's `code` + `message` so the admin console can surface them inline:
 *   - `invalid_body`    (400) — request body failed zod parse
 *   - `validation`      (400) — cross-field guard (min>=max, threshold>limit, …)
 *   - `invalid_steps`   (400) — zero steps / bad approver_type / reorder mismatch
 *   - `duplicate_code`  (409) — category code already in use
 *   - `not_found`       (404) — unknown category/policy/route id
 *   - `forbidden`       (403) — caller is not a Finance Admin
 *
 * The BE's `CategoryRow` has no `icon`/`requiresMileage` columns (Phase 1
 * schema stores a numeric `mileageRate` instead) — {@link toFECategory} derives
 * `requiresMileage` from `mileageRate != null` and picks a display icon from a
 * small code lookup, purely cosmetic. `DEFAULT_MILEAGE_RATE_IDR` is the rate
 * persisted when the dialog's mileage switch is enabled (the ticket's field
 * list is just name/code/requires_mileage/receipt threshold — it does not add
 * a rate input — so a fixed Phase-1 default stands in for a per-category rate
 * until a future ticket exposes one).
 * ========================================================================== */

import { apiFetch } from "@/lib/api/fetch";
import type { CurrencyCode } from "@/lib/format";

/** Typed error carrying the backend's status + code + message. */
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
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
  throw new AdminApiError(res.status, code, message);
}

/** Read + parse a JSON envelope, throwing `AdminApiError` on non-2xx. */
async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) await readError(res);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdminApiError(res.status, "internal", "Invalid JSON response from backend.");
  }
}

/* ========================================================================= */
/* Categories                                                                 */
/* ========================================================================= */

/** `CategoryRow` from `services/admin.ts` (ISO date strings over the wire). */
export interface BackendCategory {
  id: string;
  name: string;
  code: string;
  requiresReceipt: boolean;
  receiptThreshold: number;
  perItemCap: number | null;
  mileageRate: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** FE-facing category row — mirrors the legacy mock `ExpenseCategory` shape. */
export interface AdminCategory {
  id: string;
  name: string;
  code: string;
  icon: string;
  requiresReceipt: boolean;
  receiptThreshold: number;
  perItemCap?: number;
  requiresMileage: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryInput {
  name: string;
  code: string;
  requiresMileage: boolean;
  requiresReceipt: boolean;
  receiptThreshold: number;
  perItemCap?: number;
}

export type CategoryEditInput = Partial<CategoryInput>;

export const DEFAULT_MILEAGE_RATE_IDR = 3000;

const CATEGORY_ICONS: Record<string, string> = {
  FLT: "Plane",
  HTL: "BedDouble",
  MEL: "Utensils",
  TAX: "Car",
  KIL: "Route",
};

function iconForCategory(code: string): string {
  return CATEGORY_ICONS[code.toUpperCase()] ?? "Receipt";
}

export function toFECategory(row: BackendCategory): AdminCategory {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    icon: iconForCategory(row.code),
    requiresReceipt: row.requiresReceipt,
    receiptThreshold: row.receiptThreshold,
    perItemCap: row.perItemCap ?? undefined,
    requiresMileage: row.mileageRate != null,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function categoryBody(input: CategoryInput | CategoryEditInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.requiresReceipt !== undefined ? { requiresReceipt: input.requiresReceipt } : {}),
    ...(input.receiptThreshold !== undefined ? { receiptThreshold: input.receiptThreshold } : {}),
    ...(input.perItemCap !== undefined ? { perItemCap: input.perItemCap ?? null } : {}),
    ...(input.requiresMileage !== undefined
      ? { mileageRate: input.requiresMileage ? DEFAULT_MILEAGE_RATE_IDR : null }
      : {}),
  };
}

/** `GET /api/admin/categories` — every category (active + inactive). */
export async function listCategories(): Promise<AdminCategory[]> {
  const body = await parseJson<{ categories: BackendCategory[] }>(
    await apiFetch(`/api/admin/categories`, { method: "GET" }),
  );
  return body.categories.map(toFECategory);
}

/** `POST /api/admin/categories`. 400 `invalid_body`/`validation`, 409 `duplicate_code`. */
export async function addCategory(input: CategoryInput): Promise<AdminCategory> {
  const body = await parseJson<{ category: BackendCategory }>(
    await apiFetch(`/api/admin/categories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(categoryBody(input)),
    }),
  );
  return toFECategory(body.category);
}

/** `PATCH /api/admin/categories/:id`. */
export async function editCategory(
  id: string,
  patch: CategoryEditInput,
): Promise<AdminCategory> {
  const body = await parseJson<{ category: BackendCategory }>(
    await apiFetch(`/api/admin/categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(categoryBody(patch)),
    }),
  );
  return toFECategory(body.category);
}

/** `DELETE /api/admin/categories/:id` — soft delete (sets `active = false`). */
export async function deactivateCategory(id: string): Promise<AdminCategory> {
  const body = await parseJson<{ category: BackendCategory }>(
    await apiFetch(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
  return toFECategory(body.category);
}

/* ========================================================================= */
/* Policies                                                                   */
/* ========================================================================= */

/** `PolicyRow` from `services/admin.ts`. */
export interface BackendPolicy {
  id: string;
  name: string;
  description: string;
  categoryId: string | null;
  limitAmount: number | null;
  period: "per_item" | "per_day" | "per_trip" | "per_month";
  currency: string;
  receiptRequired: boolean;
  receiptRequiredAbove: number;
  justificationRequiredAbove: number;
  effectiveDate: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** FE-facing policy row — mirrors the legacy mock `Policy` shape. */
export interface AdminPolicy {
  id: string;
  name: string;
  description: string;
  categoryId?: string;
  limit: number;
  period: "per_item" | "per_day" | "per_trip" | "per_month";
  currency: CurrencyCode;
  receiptRequired: boolean;
  receiptRequiredAbove: number;
  justificationRequiredAbove: number;
  effectiveDate: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyInput {
  name: string;
  description?: string;
  categoryId?: string;
  limit: number;
  period?: "per_item" | "per_day" | "per_trip" | "per_month";
  currency: CurrencyCode;
  receiptRequired?: boolean;
  receiptRequiredAbove?: number;
  justificationRequiredAbove?: number;
  effectiveDate: string;
}

export type PolicyEditInput = Partial<PolicyInput>;

export function toFEPolicy(row: BackendPolicy): AdminPolicy {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId ?? undefined,
    limit: row.limitAmount ?? 0,
    period: row.period,
    currency: (row.currency as CurrencyCode) ?? "IDR",
    receiptRequired: row.receiptRequired,
    receiptRequiredAbove: row.receiptRequiredAbove,
    justificationRequiredAbove: row.justificationRequiredAbove,
    effectiveDate: row.effectiveDate,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function policyBody(input: PolicyInput | PolicyEditInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.limit !== undefined ? { limitAmount: input.limit } : {}),
    ...(input.period !== undefined ? { period: input.period } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.receiptRequired !== undefined ? { receiptRequired: input.receiptRequired } : {}),
    ...(input.receiptRequiredAbove !== undefined
      ? { receiptRequiredAbove: input.receiptRequiredAbove }
      : {}),
    ...(input.justificationRequiredAbove !== undefined
      ? { justificationRequiredAbove: input.justificationRequiredAbove }
      : {}),
    ...(input.effectiveDate !== undefined ? { effectiveDate: input.effectiveDate } : {}),
  };
}

/** `GET /api/admin/policies` — every policy (active + inactive). */
export async function listPolicies(): Promise<AdminPolicy[]> {
  const body = await parseJson<{ policies: BackendPolicy[] }>(
    await apiFetch(`/api/admin/policies`, { method: "GET" }),
  );
  return body.policies.map(toFEPolicy);
}

/** `POST /api/admin/policies`. 400 `validation` covers min>=max thresholds and
 *  an unsupported currency (BE allowlist: IDR, USD). */
export async function addPolicy(input: PolicyInput): Promise<AdminPolicy> {
  const body = await parseJson<{ policy: BackendPolicy }>(
    await apiFetch(`/api/admin/policies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(policyBody(input)),
    }),
  );
  return toFEPolicy(body.policy);
}

/** `PATCH /api/admin/policies/:id`. */
export async function editPolicy(id: string, patch: PolicyEditInput): Promise<AdminPolicy> {
  const body = await parseJson<{ policy: BackendPolicy }>(
    await apiFetch(`/api/admin/policies/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(policyBody(patch)),
    }),
  );
  return toFEPolicy(body.policy);
}

/** `DELETE /api/admin/policies/:id` — soft delete (sets `active = false`). */
export async function deactivatePolicy(id: string): Promise<AdminPolicy> {
  const body = await parseJson<{ policy: BackendPolicy }>(
    await apiFetch(`/api/admin/policies/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
  return toFEPolicy(body.policy);
}

/* ========================================================================= */
/* Approval routes + steps                                                   */
/* ========================================================================= */

export type ApproverType = "submitter_manager" | "specific_user" | "finance";

/** `RouteStepRow` from `services/admin.ts`. */
export interface BackendRouteStep {
  id: string;
  orderIndex: number;
  approverType: ApproverType;
  approverId: string | null;
  label: string;
}

/** `RouteRow` from `services/admin.ts`. */
export interface BackendRoute {
  id: string;
  name: string;
  matchMinAmount: number | null;
  matchMaxAmount: number | null;
  matchCategoryId: string | null;
  matchDepartment: string | null;
  isFallback: boolean;
  active: boolean;
  steps: BackendRouteStep[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminRouteStep {
  id: string;
  approverType: ApproverType;
  approverId?: string;
  label: string;
}

/** Structured match criteria — a claim matches when every populated
 *  criterion is satisfied; an unset criterion is treated as "any". */
export interface AdminRouteMatch {
  minAmount?: number;
  maxAmount?: number;
  categoryId?: string;
  department?: string;
}

/** FE-facing route row — mirrors the legacy mock `RoutingRule` shape. */
export interface AdminRoute {
  id: string;
  name: string;
  match: AdminRouteMatch;
  steps: AdminRouteStep[];
  isFallback: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RouteStepInput {
  approverType: ApproverType;
  approverId?: string;
  label: string;
}

export interface RouteInput {
  name: string;
  match?: AdminRouteMatch;
  steps: RouteStepInput[];
  isFallback?: boolean;
}

export type RouteEditInput = Partial<Omit<RouteInput, "steps">> & { steps?: RouteStepInput[] };

export function toFERoute(row: BackendRoute): AdminRoute {
  return {
    id: row.id,
    name: row.name,
    match: {
      minAmount: row.matchMinAmount ?? undefined,
      maxAmount: row.matchMaxAmount ?? undefined,
      categoryId: row.matchCategoryId ?? undefined,
      department: row.matchDepartment ?? undefined,
    },
    steps: [...row.steps]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((s) => ({
        id: s.id,
        approverType: s.approverType,
        approverId: s.approverId ?? undefined,
        label: s.label,
      })),
    isFallback: row.isFallback,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function routeBody(input: RouteInput | RouteEditInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.match !== undefined
      ? {
          matchMinAmount: input.match.minAmount ?? null,
          matchMaxAmount: input.match.maxAmount ?? null,
          matchCategoryId: input.match.categoryId ?? null,
          matchDepartment: input.match.department ?? null,
        }
      : {}),
    ...(input.isFallback !== undefined ? { isFallback: input.isFallback } : {}),
    ...(input.steps !== undefined
      ? {
          steps: input.steps.map((s) => ({
            approverType: s.approverType,
            approverId: s.approverId ?? null,
            label: s.label,
          })),
        }
      : {}),
  };
}

/** `GET /api/admin/routes` — every route (active + inactive) with ordered steps. */
export async function listRoutes(): Promise<AdminRoute[]> {
  const body = await parseJson<{ routes: BackendRoute[] }>(
    await apiFetch(`/api/admin/routes`, { method: "GET" }),
  );
  return body.routes.map(toFERoute);
}

/** `POST /api/admin/routes`. 400 `invalid_steps` covers zero steps and a
 *  `specific_user` step with no `approver_id`. */
export async function addRoute(input: RouteInput): Promise<AdminRoute> {
  const body = await parseJson<{ route: BackendRoute }>(
    await apiFetch(`/api/admin/routes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routeBody(input)),
    }),
  );
  return toFERoute(body.route);
}

/** `PATCH /api/admin/routes/:id`. */
export async function editRoute(id: string, patch: RouteEditInput): Promise<AdminRoute> {
  const body = await parseJson<{ route: BackendRoute }>(
    await apiFetch(`/api/admin/routes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routeBody(patch)),
    }),
  );
  return toFERoute(body.route);
}

/** `POST /api/admin/routes/:id/reorder` — `orderedStepIds` must be exactly the
 *  route's current step ids, in the new order. */
export async function reorderRouteSteps(
  id: string,
  orderedStepIds: string[],
): Promise<AdminRoute> {
  const body = await parseJson<{ route: BackendRoute }>(
    await apiFetch(`/api/admin/routes/${encodeURIComponent(id)}/reorder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stepIds: orderedStepIds }),
    }),
  );
  return toFERoute(body.route);
}

/** `DELETE /api/admin/routes/:id` — soft delete (sets `active = false`). */
export async function deactivateRoute(id: string): Promise<AdminRoute> {
  const body = await parseJson<{ route: BackendRoute }>(
    await apiFetch(`/api/admin/routes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
  return toFERoute(body.route);
}

/* ========================================================================= */
/* Dev invite log (#66/#57b)                                                  */
/* ========================================================================= */

/** One parsed `backend/logs/invites.log` line, newest first. */
export interface DevInviteEntry {
  email: string;
  inviteUrl: string;
  sentAt: string;
}

/** `GET /api/admin/dev/recent-invites` (Finance role only) — the last 5
 *  invite-log entries so devs can copy a sandbox invite URL without opening
 *  the log file. Returns `{ entries: [...] }`; 404 `not_found` when the log
 *  file doesn't exist yet. */
export async function getRecentDevInvites(): Promise<DevInviteEntry[]> {
  const body = await parseJson<{ entries: DevInviteEntry[] }>(
    await apiFetch(`/api/admin/dev/recent-invites`, { method: "GET" }),
  );
  return body.entries ?? [];
}

/** One webhook dispatch attempt persisted to `webhook-history.log` (#75). */
export interface WebhookEvent {
  id: string;
  kind: string;
  claimId: string;
  delivered: boolean;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** `GET /api/admin/dev/webhook-recent?limit=N` (Finance role only) — the last
 *  N webhook dispatch attempts so devs can see whether Slack/Teams deliveries
 *  failed without opening the log file. Returns `{ entries: [...] }`;
 *  404 `not_found` when the history log doesn't exist yet. */
export async function getRecentWebhookEvents(limit: number = 20): Promise<WebhookEvent[]> {
  const body = await parseJson<{ entries: WebhookEvent[] }>(
    await apiFetch(`/api/admin/dev/webhook-recent?limit=${encodeURIComponent(String(limit))}`, {
      method: "GET",
    }),
  );
  return body.entries ?? [];
}

/* ----------------------------------------------------------------- helpers */

/** Build a human label for a route's match criteria (used when no free-text
 *  condition is stored — the BE keeps no such column, unlike the mock). */
export function summarizeMatch(match: AdminRouteMatch, categoryName?: string): string {
  const parts: string[] = [];
  if (match.minAmount != null && match.maxAmount != null) {
    parts.push(
      `IDR ${match.minAmount.toLocaleString("id-ID")}–${match.maxAmount.toLocaleString("id-ID")}`,
    );
  } else if (match.minAmount != null) {
    parts.push(`Total ≥ IDR ${match.minAmount.toLocaleString("id-ID")}`);
  } else if (match.maxAmount != null) {
    parts.push(`Total ≤ IDR ${match.maxAmount.toLocaleString("id-ID")}`);
  }
  if (match.categoryId != null) parts.push(`Category: ${categoryName ?? match.categoryId}`);
  if (match.department != null) parts.push(`Dept: ${match.department}`);
  return parts.length ? parts.join(" · ") : "Any claim";
}

/** Human label for an approver type (used in the route builder dropdown). */
export function approverTypeLabel(type: ApproverType): string {
  switch (type) {
    case "submitter_manager":
      return "Submitter's manager";
    case "finance":
      return "Finance Admin";
    case "specific_user":
      return "Named approver";
  }
}

/* ============================================================================
 * SpendFlow — Claim audit-trail HTTP client (ticket #22, FE wiring).
 *
 * `GET /api/claims/:id/audit` is already fetched by `lib/api/claims.ts`
 * (`getClaimAudit`, added in #18 for the claim-detail activity tab) — this
 * module re-exports that same client under the audit-vertical's naming so
 * `useClaimAudit` / the dedicated `/claims/[id]/audit` viewer don't duplicate
 * the fetch + error-mapping logic. `AuditApiError` is `ClaimApiError` itself
 * (same class reference), so `instanceof AuditApiError` still matches errors
 * thrown by the shared implementation.
 * ========================================================================== */

import { getClaimAudit, ClaimApiError, type BackendAuditEntry } from "@/lib/api/claims";

export { type BackendAuditEntry };
export const AuditApiError = ClaimApiError;

/** `GET /api/claims/:id/audit` — full chronological timeline (oldest first). */
export async function getAudit(claimId: string): Promise<BackendAuditEntry[]> {
  return getClaimAudit(claimId);
}

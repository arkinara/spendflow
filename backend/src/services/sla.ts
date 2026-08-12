/* ============================================================================
 * SpendFlow — SLA tracking on claims (ticket #74).
 *
 * Centralises the age-into-bucket mapping used by every claims listing so the
 * employee dashboard, approver inbox, finance exception queue, and finance
 * payment board all surface the same "fresh / on_track / aging / stale /
 * breached" signal. Pure functions over a {@link ClaimRowLike} view so the
 * helper is testable without a DB and reusable from any service that already
 * has a claim row in hand.
 *
 * Thresholds are status-keyed (see {@link thresholdFor}): `action_required`
 * claims use the employee-decision SLA (employee must resubmit); `pending` /
 * `approved` / `processing` claims use the appropriate decision-maker SLA;
 * `blocked_sod` claims use the longer action SLA (finance must unblock).
 * Terminal statuses (`paid`, `rejected`, `draft`) compute an age but always
 * fall back to the `fresh` bucket so the FE never renders a stale badge on a
 * closed claim.
 * ========================================================================== */

/**
 * Per-status SLA thresholds in calendar days. Values reflect the wire spec
 * (#74): a claim should not sit in a decision state past these limits. Kept in
 * one place so future tuning (per-category SLA, configurable per tenant) has
 * a single seam.
 */
export const SLA_THRESHOLDS = {
  /** `action_required` — claim is back with the employee awaiting resubmit. */
  pending_employee_decision_days: 3,
  /** `approved` / `processing` — claim is awaiting a finance decision. */
  pending_finance_decision_days: 5,
  /** `blocked_sod` — claim is held for finance to manually unblock. */
  action_required_days: 7,
} as const;

/** Ordered (worst-case-last) SLA bucket a claim's age falls into. */
export type SlaLevel = "fresh" | "on_track" | "aging" | "stale" | "breached";

/** Display tone for an SLA badge — matches the FE StatusChip palette. */
export type SlaTone = "neutral" | "warning" | "error";

/** Serializable SLA summary stamped onto every claim-shaped row over the wire. */
export interface SlaSummary {
  level: SlaLevel;
  ageDays: number;
  thresholdDays: number;
}

/**
 * Minimal claim view {@link computeClaimSla} needs. Accepts `Date | string`
 * for both timestamps so it works against raw DB rows (Date) and over-the-wire
 * payloads (ISO strings) without forcing callers to coerce.
 */
export interface ClaimRowLike {
  status: string;
  createdAt: Date | string;
  updatedAt?: Date | string;
  submittedAt?: Date | string | null;
}

const DAY_MS = 86_400_000;

/** Terminal / non-decision statuses — computed age is informational only. */
const TERMINAL_STATUSES = new Set(["draft", "paid", "rejected"]);

/**
 * Resolve the SLA threshold (in days) for a claim based on its status. The
 * mapping is intentionally explicit so a status change never silently shifts
 * a claim's SLA bucket. Unknown statuses fall back to the action SLA.
 */
export function thresholdFor(status: string): number {
  switch (status) {
    case "action_required":
      return SLA_THRESHOLDS.pending_employee_decision_days;
    case "pending":
      // Approver is on the hook — same window as the employee decision SLA.
      return SLA_THRESHOLDS.pending_employee_decision_days;
    case "approved":
    case "processing":
      return SLA_THRESHOLDS.pending_finance_decision_days;
    case "blocked_sod":
      return SLA_THRESHOLDS.action_required_days;
    default:
      return SLA_THRESHOLDS.action_required_days;
  }
}

function toMs(value: Date | string | null | undefined): number {
  if (value == null) return Date.now();
  const ms = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isNaN(ms) ? Date.now() : ms;
}

/**
 * Compute the SLA bucket + age for a claim. Age is measured from
 * `submittedAt` (when the claim entered its current decision cycle), falling
 * back to `createdAt` (drafts / unsubmitted claims) so the helper never
 * divides by NaN.
 *
 * Bucket boundaries (ageDays vs threshold):
 *  - `< threshold * 0.4` → `fresh`
 *  - `< threshold * 0.75` → `on_track`
 *  - `< threshold` → `aging`
 *  - `< threshold * 1.5` → `stale`
 *  - `>= threshold * 1.5` → `breached`
 *
 * Terminal statuses always return `fresh` regardless of age — the FE should
 * not badge a closed claim as stale.
 */
export function computeClaimSla(
  claim: ClaimRowLike,
  now: Date = new Date(),
): SlaSummary {
  const threshold = thresholdFor(claim.status);
  const anchor = claim.submittedAt ?? claim.createdAt;
  const ageDays = Math.floor((now.getTime() - toMs(anchor)) / DAY_MS);

  if (TERMINAL_STATUSES.has(claim.status)) {
    return { level: "fresh", ageDays, thresholdDays: threshold };
  }

  let level: SlaLevel;
  if (ageDays < threshold * 0.4) level = "fresh";
  else if (ageDays < threshold * 0.75) level = "on_track";
  else if (ageDays < threshold) level = "aging";
  else if (ageDays < threshold * 1.5) level = "stale";
  else level = "breached";

  return { level, ageDays, thresholdDays: threshold };
}

/**
 * Resolve the human-readable label + display tone + sort priority for an SLA
 * bucket. Lower `priority` sorts first in a "worst first" board (breached at
 * the top), which matches how finance / approver boards already rank risk.
 */
export function claimSlaBadge(
  level: SlaLevel,
  ageDays: number,
): { label: string; tone: SlaTone; priority: number } {
  switch (level) {
    case "fresh":
      return { label: "Just submitted", tone: "neutral", priority: 4 };
    case "on_track":
      return { label: `${ageDays} days open`, tone: "neutral", priority: 3 };
    case "aging":
      return { label: `Aging: ${ageDays} days`, tone: "warning", priority: 2 };
    case "stale":
      return { label: `Stale: ${ageDays} days`, tone: "warning", priority: 1 };
    case "breached":
      return { label: `Overdue: ${ageDays} days`, tone: "error", priority: 0 };
  }
}

/**
 * Stamp a `sla` summary onto any claim-shaped row. Returns a new object so the
 * input is not mutated; the spread keeps any extra fields (employee name, step
 * label, payment metadata) intact for service-level composition.
 *
 * Used by every claims listing (employee, approver inbox, finance exceptions,
 * finance payments) so the FE always finds the same `sla` key on every row.
 */
export function decorateClaimWithSla<T extends ClaimRowLike>(
  claim: T,
  now?: Date,
): T & { sla: SlaSummary } {
  return { ...claim, sla: computeClaimSla(claim, now) };
}

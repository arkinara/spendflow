/* ============================================================================
   SpendFlow — Finance Dashboard data shaping (Phase 1, mock data).
   Pure selectors that turn the live mock `claims` array into the shape the
   Finance dashboard renders. Kept separate from the page so the page can
   simulate async loading + failure around a single seam and so the totals are
   trivially unit-testable (the PRD requires dashboard counts to stay
   consistent with the underlying claim set even when no claims are Processing
   or Paid).

   FALLBACK ONLY (ticket #20): the Finance dashboard + exception + payment
   verticals now read from the BE via `lib/api/finance.ts`. This mock shaping
   module is retained so the legacy mock-data test fixtures and any out-of-
   vertical consumer (e.g. seeded demo data) still compile. It is NOT used by
   the wired `/finance/*` pages. Removal is tracked by #24.
   ========================================================================== */

import {
  claimsReadyToPay,
  claimsProcessing,
  claimsPaid,
  openFinanceExceptions,
  computeClaimTotal,
  type Claim,
} from "@/lib/mock/mock_data";

export interface FinanceGroup {
  status: "approved" | "processing" | "paid";
  label: string;
  claims: Claim[];
  count: number;
  amount: number;
}

export interface FinanceDashboardData {
  exceptions: Claim[];
  readyToPay: Claim[];
  inFlight: Claim[];
  recentPaid: Claim[];
  groups: FinanceGroup[];
  openExceptionCount: number;
  readyToPayCount: number;
  inFlightCount: number;
  paidCount: number;
  readyToPayAmount: number;
  inFlightAmount: number;
  paidAmount: number;
  /** True when there is at least one claim in any payment-lifecycle status. */
  hasAnyPaymentActivity: boolean;
}

function buildGroup(
  status: FinanceGroup["status"],
  list: Claim[]
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
    claims: list,
    count: list.length,
    amount: list.reduce((s, c) => s + computeClaimTotal(c), 0),
  };
}

/**
 * Build the Finance dashboard payload from the live claim store. Reads the
 * shared selectors directly so a freshly-resolved exception or a newly-marked
 * payment is reflected immediately on the next read (no stale cache).
 */
export function loadFinanceDashboard(): FinanceDashboardData {
  const exceptions = openFinanceExceptions();
  const readyToPay = claimsReadyToPay();
  const inFlight = claimsProcessing();
  const recentPaid = claimsPaid();

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

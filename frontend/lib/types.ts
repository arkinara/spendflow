import type { CurrencyCode } from "@/lib/format";

export type Role = "employee" | "approver" | "finance";

/**
 * Soft-activation flag (#33). `"active"` users can sign in; `"disabled"` users
 * are soft-deactivated by a Finance Admin (their claims + approvals are
 * preserved). The BE does not persist this field yet — the FE sends it in PATCH
 * bodies as a forward-compatible placeholder and the row's status is treated as
 * client-side state until a real endpoint lands.
 */
export type UserStatus = "active" | "disabled";

export type ClaimStatus =
  | "draft"
  | "pending"
  | "action_required"
  | "approved"
  | "processing"
  | "paid"
  | "rejected";

export type PaymentStatus =
  | "queued"
  | "scheduled"
  | "processing"
  | "paid"
  | "failed";

export type ExpenseCategoryId =
  | "flight"
  | "hotel"
  | "meals"
  | "taxi"
  | "mileage"
  | "other";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  jobTitle: string;
  department: string;
  managerId?: string;
  avatarColor: string;
  status: UserStatus;
}

/**
 * Admin-managed expense category. `id` is a plain string (not the seeded
 * {@link ExpenseCategoryId} union) so Finance Admins can add new categories
 * with arbitrary codes; seeded claims keep their union-typed `categoryId`
 * values. `requiresMileage` flags distance-based categories (computed from
 * km × rate at entry time) per the category-management DoD.
 */
export interface ExpenseCategory {
  id: string;
  name: string;
  /** Short stable code shown in the claim builder + reports (e.g. "FLT"). */
  code: string;
  icon: string; // lucide icon name
  requiresReceipt: boolean;
  receiptThreshold: number; // IDR — above this a receipt is mandatory
  perItemCap?: number;
  /** True for distance-based categories (mileage) — drives the km × rate UI. */
  requiresMileage: boolean;
  active: boolean;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  categoryId?: ExpenseCategoryId;
  /** Max reimbursable amount for the period / per-item scope. */
  limit: number;
  period: "per_item" | "per_day" | "per_trip" | "per_month";
  currency: CurrencyCode;
  /** Whether a receipt is required at all for matching expenses. */
  receiptRequired: boolean;
  /** Amount at/above which a receipt becomes mandatory. */
  receiptRequiredAbove: number;
  /** Amount at/above which a written justification is mandatory. */
  justificationRequiredAbove: number;
  /**
   * ISO date the policy takes effect from. Changes apply to claims submitted
   * on/after this date; historical claims stay evaluated under the rules in
   * force at their submission time (mock effective dating).
   */
  effectiveDate: string;
  active: boolean;
}

/** Who an approval routing step is assigned to. */
export type ApproverType = "submitter_manager" | "specific_user" | "finance";

export interface RoutingStep {
  id: string;
  approverType: ApproverType;
  /** Required when approverType === "specific_user"; ignored otherwise. */
  approverId?: string;
  /** Display label, e.g. "Line manager" or a named approver. */
  label: string;
}

/**
 * Structured matching criteria for a route. A claim matches when every
 * populated criterion is satisfied (amount within range, category equal,
 * department equal). An empty/undefined criterion is treated as "any".
 */
export interface RoutingMatch {
  minAmount?: number;
  maxAmount?: number;
  categoryId?: ExpenseCategoryId;
  department?: string;
}

export interface RoutingRule {
  id: string;
  name: string;
  /** Human-readable summary of {@link match} (kept for legacy display). */
  condition?: string;
  match: RoutingMatch;
  /** Ordered approval steps; index 0 is the first reviewer. */
  steps: RoutingStep[];
  /** Fallback route used when no specific active route matches a claim. */
  isFallback?: boolean;
  active: boolean;
}

export interface LineItem {
  id: string;
  categoryId: ExpenseCategoryId;
  description: string;
  date: string; // ISO
  amount: number;
  currency: CurrencyCode;
  quantity?: number;
  unitLabel?: string; // e.g. "km", "nights"
  unitRate?: number;
  hasReceipt: boolean;
  note?: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  sizeKb: number;
  mimeType: string;
  lineItemId?: string;
  uploadedAt: string;
}

/**
 * Finance reimbursement metadata stamped onto a claim as it moves through the
 * payment lifecycle (Approved → Processing → Paid). Phase 1 is mock data, so
 * the same object serves the dashboard, payments board, and audit trail.
 */
export interface ClaimPayment {
  method: "bank_transfer" | "payroll";
  /** Bank / payroll reference number captured when Finance marks Processing. */
  reference: string;
  /** Finance admin who moved the claim into Processing. */
  processedBy?: string;
  processedAt?: string;
  /** Finance admin who confirmed the disbursement (Mark Paid). */
  paidBy?: string;
  paidAt?: string;
}

export interface ApprovalAction {
  id: string;
  actorId: string;
  action:
    | "created"
    | "submitted"
    | "approved"
    | "rejected"
    | "returned"
    | "resubmitted"
    | "processing"
    | "paid"
    | "commented";
  at: string;
  note?: string;
}

export interface ClaimException {
  id: string;
  type:
    | "missing_receipt"
    | "over_policy"
    | "duplicate"
    | "late_submission";
  severity: "high" | "medium" | "low";
  message: string;
  flaggedAt: string;
  status: "open" | "resolved";
}

export interface Claim {
  id: string;
  reference: string;
  title: string;
  purpose: string;
  employeeId: string;
  status: ClaimStatus;
  currency: CurrencyCode;
  createdAt: string;
  submittedAt?: string;
  decidedAt?: string;
  tripStart?: string;
  tripEnd?: string;
  destination?: string;
  lineItems: LineItem[];
  attachments: Attachment[];
  approvals: ApprovalAction[];
  exception?: ClaimException;
  /** Finance payment metadata once the claim enters the payment lifecycle. */
  payment?: ClaimPayment;
  /**
   * Zero-based index into the routing steps the claim must clear before it is
   * considered fully approved (see {@link routingStepsForClaim}). Phase 1 has a
   * single line-manager approver at step 0; high-value or exception-flagged
   * claims also pass through "Finance review" at step 1. Undefined is treated
   * as 0 so existing fixtures stay valid without re-seeding.
   */
  currentStepIndex?: number;
}

export interface Payment {
  id: string;
  claimId: string;
  claimReference: string;
  claimTitle: string;
  payeeId: string;
  amount: number;
  currency: CurrencyCode;
  method: "bank_transfer" | "payroll";
  status: PaymentStatus;
  scheduledFor?: string;
  paidAt?: string;
  bankReference?: string;
}

export interface Comment {
  id: string;
  claimId: string;
  authorId: string;
  body: string;
  at: string;
}

export interface Notification {
  id: string;
  audience: Role;
  category: "approval" | "action" | "payment" | "system";
  title: string;
  body: string;
  at: string;
  read: boolean;
  claimId?: string;
}

export interface AuditEntry {
  id: string;
  claimId: string;
  actorId: string;
  action: string;
  at: string;
  detail: string;
}

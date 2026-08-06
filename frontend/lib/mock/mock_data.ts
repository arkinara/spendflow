/* ============================================================================
   SpendFlow — mock data (Phase 1, web).
   NO backend, NO API, NO OCR. Every screen consumes these fixtures.
   ========================================================================== */

import type {
  AuditEntry,
  Claim,
  ClaimStatus,
  Comment,
  ExpenseCategory,
  ExpenseCategoryId,
  LineItem,
  Notification,
  Payment,
  Policy,
  Role,
  RoutingRule,
  User,
} from "@/lib/types";

/* ------------------------------------------------------------------ users -- */

export const users: User[] = [
  {
    id: "u-emp-1",
    name: "Aulia Pratiwi",
    email: "aulia.pratiwi@spendflow.example",
    role: "employee",
    jobTitle: "Operations Specialist",
    department: "Operations",
    managerId: "u-mgr-1",
    avatarColor: "primary",
  },
  {
    id: "u-mgr-1",
    name: "Dewi Anggraeni",
    email: "dewi.anggraeni@spendflow.example",
    role: "approver",
    jobTitle: "Operations Manager",
    department: "Operations",
    avatarColor: "tertiary",
  },
  {
    id: "u-fin-1",
    name: "Ridwan Saputra",
    email: "ridwan.saputra@spendflow.example",
    role: "finance",
    jobTitle: "Finance Administrator",
    department: "Finance",
    avatarColor: "secondary",
  },
  {
    id: "u-emp-2",
    name: "Bima Nugroho",
    email: "bima.nugroho@spendflow.example",
    role: "employee",
    jobTitle: "Field Engineer",
    department: "Operations",
    managerId: "u-mgr-1",
    avatarColor: "info",
  },
  {
    id: "u-emp-3",
    name: "Sari Wijaya",
    email: "sari.wijaya@spendflow.example",
    role: "employee",
    jobTitle: "Account Executive",
    department: "Sales",
    managerId: "u-mgr-1",
    avatarColor: "warning",
  },
];

export const CURRENT_USER_BY_ROLE: Record<Role, string> = {
  employee: "u-emp-1",
  approver: "u-mgr-1",
  finance: "u-fin-1",
};

/** Distinct department list used by the routing match-criteria dropdown. */
export const DEPARTMENTS: string[] = Array.from(
  new Set(users.map((u) => u.department))
).sort();

/* ------------------------------------------------------------- categories -- */

export const categories: ExpenseCategory[] = [
  { id: "flight", name: "Flight", code: "FLT", icon: "Plane", requiresReceipt: true, receiptThreshold: 500_000, requiresMileage: false, active: true },
  { id: "hotel", name: "Hotel", code: "HTL", icon: "BedDouble", requiresReceipt: true, receiptThreshold: 500_000, perItemCap: 1_200_000, requiresMileage: false, active: true },
  { id: "meals", name: "Meals", code: "MEL", icon: "Utensils", requiresReceipt: true, receiptThreshold: 250_000, perItemCap: 350_000, requiresMileage: false, active: true },
  { id: "taxi", name: "Taxi / Ride-hailing", code: "TAX", icon: "Car", requiresReceipt: false, receiptThreshold: 200_000, requiresMileage: false, active: true },
  { id: "mileage", name: "Mileage", code: "KIL", icon: "Route", requiresReceipt: false, receiptThreshold: 0, requiresMileage: true, active: true },
  { id: "other", name: "Other", code: "OTH", icon: "Receipt", requiresReceipt: true, receiptThreshold: 250_000, requiresMileage: false, active: true },
];

export const MILEAGE_RATE = 1_200; // IDR per km

/* ---------------------------------------------------------------- policies -- */

export const policies: Policy[] = [
  { id: "pol-1", name: "Hotel nightly cap", description: "Maximum reimbursable hotel rate per night for domestic travel.", categoryId: "hotel", limit: 1_200_000, period: "per_item", currency: "IDR", receiptRequired: true, receiptRequiredAbove: 500_000, justificationRequiredAbove: 1_200_000, effectiveDate: "2026-01-01", active: true },
  { id: "pol-2", name: "Meal daily allowance", description: "Combined meals per day while travelling.", categoryId: "meals", limit: 350_000, period: "per_day", currency: "IDR", receiptRequired: true, receiptRequiredAbove: 250_000, justificationRequiredAbove: 350_000, effectiveDate: "2026-01-01", active: true },
  { id: "pol-3", name: "Receipt requirement", description: "Any single expense above IDR 500,000 requires an attached receipt.", limit: 500_000, period: "per_item", currency: "IDR", receiptRequired: true, receiptRequiredAbove: 500_000, justificationRequiredAbove: 1_000_000, effectiveDate: "2026-01-01", active: true },
  { id: "pol-4", name: "Trip pre-approval", description: "Trips with an estimated total above IDR 5,000,000 need pre-approval.", limit: 5_000_000, period: "per_trip", currency: "IDR", receiptRequired: true, receiptRequiredAbove: 500_000, justificationRequiredAbove: 5_000_000, effectiveDate: "2026-01-01", active: true },
  { id: "pol-5", name: "Mileage rate", description: "Personal vehicle mileage reimbursed at a fixed rate.", categoryId: "mileage", limit: 1_200, period: "per_item", currency: "IDR", receiptRequired: false, receiptRequiredAbove: 0, justificationRequiredAbove: 0, effectiveDate: "2026-01-01", active: true },
];

/* -------------------------------------------------------------- routing -- */

export const routingRules: RoutingRule[] = [
  {
    id: "rt-1",
    name: "High-value claim",
    condition: "Total > IDR 5,000,000",
    match: { minAmount: 5_000_001 },
    steps: [
      { id: "rt-1-s1", approverType: "submitter_manager", label: "Line manager" },
      { id: "rt-1-s2", approverType: "finance", label: "Finance review" },
    ],
    active: true,
  },
  {
    id: "rt-2",
    name: "Sales department claim",
    condition: "Department = Sales",
    match: { department: "Sales" },
    steps: [
      { id: "rt-2-s1", approverType: "submitter_manager", label: "Line manager" },
      { id: "rt-2-s2", approverType: "specific_user", approverId: "u-fin-1", label: "Finance Admin" },
    ],
    active: true,
  },
  {
    id: "rt-fallback",
    name: "Standard claim (fallback)",
    condition: "Applies when no specific route matches",
    match: {},
    steps: [{ id: "rt-fb-s1", approverType: "submitter_manager", label: "Line manager" }],
    isFallback: true,
    active: true,
  },
];

/* ----------------------------------------------------------------- claims -- */

function li(
  id: string,
  categoryId: ExpenseCategoryId,
  description: string,
  date: string,
  amount: number,
  hasReceipt: boolean,
  extra: Partial<LineItem> = {}
): LineItem {
  return { id, categoryId, description, date, amount, currency: "IDR", hasReceipt, ...extra };
}

export const claims: Claim[] = [
  // 1. Pending approval — the flagship "Q2 Client Visit"
  {
    id: "clm-1001",
    reference: "EXP-2026-1001",
    title: "Q2 Client Visit – Jakarta",
    purpose: "On-site client kick-off meeting with PT Nusantara Retail.",
    employeeId: "u-emp-1",
    status: "pending",
    currency: "IDR",
    createdAt: "2026-07-20T08:10:00+07:00",
    submittedAt: "2026-07-21T09:32:00+07:00",
    tripStart: "2026-07-14",
    tripEnd: "2026-07-16",
    destination: "Jakarta",
    lineItems: [
      li("li-1", "flight", "Return flight CGK ⇄ SUB", "2026-07-14", 2_450_000, true),
      li("li-2", "hotel", "Hotel — 2 nights", "2026-07-14", 1_800_000, true, { quantity: 2, unitLabel: "nights", unitRate: 900_000 }),
      li("li-3", "meals", "Meals during trip", "2026-07-15", 320_000, true),
      li("li-4", "taxi", "Airport & city taxis", "2026-07-14", 145_000, false),
      li("li-5", "mileage", "Personal car to airport", "2026-07-14", 72_000, false, { quantity: 60, unitLabel: "km", unitRate: 1_200 }),
    ],
    attachments: [
      { id: "at-1", fileName: "flight-eticket.pdf", sizeKb: 214, mimeType: "application/pdf", lineItemId: "li-1", uploadedAt: "2026-07-21T09:20:00+07:00" },
      { id: "at-2", fileName: "hotel-invoice.pdf", sizeKb: 188, mimeType: "application/pdf", lineItemId: "li-2", uploadedAt: "2026-07-21T09:22:00+07:00" },
      { id: "at-3", fileName: "meals-receipt.jpg", sizeKb: 512, mimeType: "image/jpeg", lineItemId: "li-3", uploadedAt: "2026-07-21T09:24:00+07:00" },
    ],
    approvals: [
      { id: "ap-1", actorId: "u-emp-1", action: "created", at: "2026-07-20T08:10:00+07:00" },
      { id: "ap-2", actorId: "u-emp-1", action: "submitted", at: "2026-07-21T09:32:00+07:00", note: "Submitted for approval." },
    ],
  },

  // 2. Draft
  {
    id: "clm-1002",
    reference: "EXP-2026-1002",
    title: "Warehouse Audit – Surabaya",
    purpose: "Quarterly inventory audit at the Surabaya distribution centre.",
    employeeId: "u-emp-1",
    status: "draft",
    currency: "IDR",
    createdAt: "2026-07-26T16:40:00+07:00",
    tripStart: "2026-07-24",
    tripEnd: "2026-07-25",
    destination: "Surabaya",
    lineItems: [
      li("li-6", "taxi", "Taxi to warehouse", "2026-07-24", 88_000, false),
      li("li-7", "meals", "Lunch with site team", "2026-07-24", 210_000, false),
    ],
    attachments: [],
    approvals: [{ id: "ap-3", actorId: "u-emp-1", action: "created", at: "2026-07-26T16:40:00+07:00" }],
  },

  // 3. Action required (returned) — missing receipt
  {
    id: "clm-1003",
    reference: "EXP-2026-1003",
    title: "Vendor Workshop – Bandung",
    purpose: "Two-day supplier onboarding workshop.",
    employeeId: "u-emp-1",
    status: "action_required",
    currency: "IDR",
    createdAt: "2026-07-10T10:00:00+07:00",
    submittedAt: "2026-07-12T11:00:00+07:00",
    tripStart: "2026-07-07",
    tripEnd: "2026-07-08",
    destination: "Bandung",
    lineItems: [
      li("li-8", "hotel", "Hotel — 1 night", "2026-07-07", 980_000, false, { quantity: 1, unitLabel: "nights", unitRate: 980_000 }),
      li("li-9", "meals", "Dinner with vendor", "2026-07-07", 265_000, true),
      li("li-10", "taxi", "Local transport", "2026-07-07", 120_000, false),
    ],
    attachments: [
      { id: "at-4", fileName: "dinner-receipt.jpg", sizeKb: 430, mimeType: "image/jpeg", lineItemId: "li-9", uploadedAt: "2026-07-12T10:50:00+07:00" },
    ],
    approvals: [
      { id: "ap-4", actorId: "u-emp-1", action: "created", at: "2026-07-10T10:00:00+07:00" },
      { id: "ap-5", actorId: "u-emp-1", action: "submitted", at: "2026-07-12T11:00:00+07:00" },
      { id: "ap-6", actorId: "u-mgr-1", action: "returned", at: "2026-07-13T14:20:00+07:00", note: "Hotel invoice is missing and the amount exceeds the IDR 500k receipt threshold. Please attach it and resubmit." },
    ],
    exception: {
      id: "exc-1",
      type: "missing_receipt",
      severity: "high",
      message: "Hotel expense of IDR 980,000 exceeds the IDR 500,000 receipt threshold but has no attached receipt.",
      flaggedAt: "2026-07-13T14:19:00+07:00",
      status: "open",
    },
  },

  // 4. Approved (awaiting finance processing)
  {
    id: "clm-1004",
    reference: "EXP-2026-1004",
    title: "Regional Sales Sync – Medan",
    purpose: "Regional sales alignment meeting.",
    employeeId: "u-emp-3",
    status: "approved",
    currency: "IDR",
    createdAt: "2026-07-15T09:00:00+07:00",
    submittedAt: "2026-07-16T09:00:00+07:00",
    decidedAt: "2026-07-18T10:15:00+07:00",
    tripStart: "2026-07-09",
    tripEnd: "2026-07-10",
    destination: "Medan",
    lineItems: [
      li("li-11", "flight", "Return flight CGK ⇄ KNO", "2026-07-09", 3_120_000, true),
      li("li-12", "hotel", "Hotel — 1 night", "2026-07-09", 1_050_000, true, { quantity: 1, unitLabel: "nights", unitRate: 1_050_000 }),
      li("li-13", "meals", "Team dinner", "2026-07-09", 340_000, true),
    ],
    attachments: [
      { id: "at-5", fileName: "flight-medan.pdf", sizeKb: 201, mimeType: "application/pdf", lineItemId: "li-11", uploadedAt: "2026-07-16T08:40:00+07:00" },
      { id: "at-6", fileName: "hotel-medan.pdf", sizeKb: 176, mimeType: "application/pdf", lineItemId: "li-12", uploadedAt: "2026-07-16T08:41:00+07:00" },
      { id: "at-7", fileName: "dinner-medan.jpg", sizeKb: 388, mimeType: "image/jpeg", lineItemId: "li-13", uploadedAt: "2026-07-16T08:42:00+07:00" },
    ],
    approvals: [
      { id: "ap-7", actorId: "u-emp-3", action: "created", at: "2026-07-15T09:00:00+07:00" },
      { id: "ap-8", actorId: "u-emp-3", action: "submitted", at: "2026-07-16T09:00:00+07:00" },
      { id: "ap-9", actorId: "u-mgr-1", action: "approved", at: "2026-07-18T10:15:00+07:00", note: "Approved — within policy." },
    ],
  },

  // 5. Processing (payment in flight)
  {
    id: "clm-1005",
    reference: "EXP-2026-1005",
    title: "Site Inspection – Semarang",
    purpose: "Safety inspection of the Semarang facility.",
    employeeId: "u-emp-2",
    status: "processing",
    currency: "IDR",
    createdAt: "2026-07-05T09:00:00+07:00",
    submittedAt: "2026-07-06T09:00:00+07:00",
    decidedAt: "2026-07-08T09:00:00+07:00",
    tripStart: "2026-07-01",
    tripEnd: "2026-07-02",
    destination: "Semarang",
    lineItems: [
      li("li-14", "flight", "Return flight CGK ⇄ SRG", "2026-07-01", 1_980_000, true),
      li("li-15", "taxi", "Local transport", "2026-07-01", 165_000, true),
      li("li-16", "meals", "Meals", "2026-07-01", 290_000, true),
    ],
    attachments: [
      { id: "at-8", fileName: "flight-srg.pdf", sizeKb: 199, mimeType: "application/pdf", lineItemId: "li-14", uploadedAt: "2026-07-06T08:30:00+07:00" },
    ],
    approvals: [
      { id: "ap-10", actorId: "u-emp-2", action: "created", at: "2026-07-05T09:00:00+07:00" },
      { id: "ap-11", actorId: "u-emp-2", action: "submitted", at: "2026-07-06T09:00:00+07:00" },
      { id: "ap-12", actorId: "u-mgr-1", action: "approved", at: "2026-07-08T09:00:00+07:00", note: "Approved." },
      { id: "ap-12b", actorId: "u-fin-1", action: "processing", at: "2026-07-29T09:00:00+07:00", note: "Bank transfer TRX-771002 queued for disbursement." },
    ],
    payment: {
      method: "bank_transfer",
      reference: "TRX-771002",
      processedBy: "u-fin-1",
      processedAt: "2026-07-29T09:00:00+07:00",
    },
  },

  // 6. Paid
  {
    id: "clm-1006",
    reference: "EXP-2026-1006",
    title: "Training Conference – Bali",
    purpose: "Attend the annual operations excellence conference.",
    employeeId: "u-emp-1",
    status: "paid",
    currency: "IDR",
    createdAt: "2026-06-10T09:00:00+07:00",
    submittedAt: "2026-06-12T09:00:00+07:00",
    decidedAt: "2026-06-14T09:00:00+07:00",
    tripStart: "2026-06-02",
    tripEnd: "2026-06-04",
    destination: "Bali",
    lineItems: [
      li("li-17", "flight", "Return flight CGK ⇄ DPS", "2026-06-02", 2_760_000, true),
      li("li-18", "hotel", "Hotel — 2 nights", "2026-06-02", 2_100_000, true, { quantity: 2, unitLabel: "nights", unitRate: 1_050_000 }),
      li("li-19", "meals", "Meals", "2026-06-02", 410_000, true),
      li("li-20", "taxi", "Local transport", "2026-06-02", 180_000, true),
    ],
    attachments: [
      { id: "at-9", fileName: "flight-dps.pdf", sizeKb: 220, mimeType: "application/pdf", lineItemId: "li-17", uploadedAt: "2026-06-12T08:30:00+07:00" },
      { id: "at-10", fileName: "hotel-dps.pdf", sizeKb: 240, mimeType: "application/pdf", lineItemId: "li-18", uploadedAt: "2026-06-12T08:31:00+07:00" },
    ],
    approvals: [
      { id: "ap-13", actorId: "u-emp-1", action: "created", at: "2026-06-10T09:00:00+07:00" },
      { id: "ap-14", actorId: "u-emp-1", action: "submitted", at: "2026-06-12T09:00:00+07:00" },
      { id: "ap-15", actorId: "u-mgr-1", action: "approved", at: "2026-06-14T09:00:00+07:00", note: "Approved." },
      { id: "ap-16", actorId: "u-fin-1", action: "paid", at: "2026-06-20T15:00:00+07:00", note: "Disbursed via bank transfer." },
    ],
    payment: {
      method: "bank_transfer",
      reference: "TRX-880021",
      processedBy: "u-fin-1",
      processedAt: "2026-06-19T10:00:00+07:00",
      paidBy: "u-fin-1",
      paidAt: "2026-06-20T15:00:00+07:00",
    },
  },

  // 7. Rejected
  {
    id: "clm-1007",
    reference: "EXP-2026-1007",
    title: "Personal Upgrade – Yogyakarta",
    purpose: "Business trip with a discretionary hotel upgrade.",
    employeeId: "u-emp-2",
    status: "rejected",
    currency: "IDR",
    createdAt: "2026-07-02T09:00:00+07:00",
    submittedAt: "2026-07-03T09:00:00+07:00",
    decidedAt: "2026-07-04T11:30:00+07:00",
    tripStart: "2026-06-28",
    tripEnd: "2026-06-29",
    destination: "Yogyakarta",
    lineItems: [
      li("li-21", "hotel", "Suite upgrade — 1 night", "2026-06-28", 2_400_000, true, { quantity: 1, unitLabel: "nights", unitRate: 2_400_000 }),
      li("li-22", "meals", "Meals", "2026-06-28", 300_000, true),
    ],
    attachments: [
      { id: "at-11", fileName: "hotel-jog.pdf", sizeKb: 210, mimeType: "application/pdf", lineItemId: "li-21", uploadedAt: "2026-07-03T08:30:00+07:00" },
    ],
    approvals: [
      { id: "ap-17", actorId: "u-emp-2", action: "created", at: "2026-07-02T09:00:00+07:00" },
      { id: "ap-18", actorId: "u-emp-2", action: "submitted", at: "2026-07-03T09:00:00+07:00" },
      { id: "ap-19", actorId: "u-mgr-1", action: "rejected", at: "2026-07-04T11:30:00+07:00", note: "Hotel rate of IDR 2,400,000/night exceeds the IDR 1,200,000 nightly cap. Suite upgrades are not reimbursable." },
    ],
    exception: {
      id: "exc-2",
      type: "over_policy",
      severity: "high",
      message: "Hotel nightly rate exceeds the IDR 1,200,000 policy cap.",
      flaggedAt: "2026-07-04T11:00:00+07:00",
      status: "resolved",
    },
  },

  // 8. Pending approval (second in approver inbox)
  {
    id: "clm-1008",
    reference: "EXP-2026-1008",
    title: "Partner Meeting – Makassar",
    purpose: "Distribution partner negotiation.",
    employeeId: "u-emp-2",
    status: "pending",
    currency: "IDR",
    createdAt: "2026-07-24T09:00:00+07:00",
    submittedAt: "2026-07-25T14:00:00+07:00",
    tripStart: "2026-07-21",
    tripEnd: "2026-07-22",
    destination: "Makassar",
    lineItems: [
      li("li-23", "flight", "Return flight CGK ⇄ UPG", "2026-07-21", 3_480_000, true),
      li("li-24", "hotel", "Hotel — 1 night", "2026-07-21", 1_150_000, true, { quantity: 1, unitLabel: "nights", unitRate: 1_150_000 }),
      li("li-25", "meals", "Meals", "2026-07-21", 275_000, true),
      li("li-26", "taxi", "Local transport", "2026-07-21", 210_000, false),
    ],
    attachments: [
      { id: "at-12", fileName: "flight-upg.pdf", sizeKb: 205, mimeType: "application/pdf", lineItemId: "li-23", uploadedAt: "2026-07-25T13:40:00+07:00" },
      { id: "at-13", fileName: "hotel-upg.pdf", sizeKb: 190, mimeType: "application/pdf", lineItemId: "li-24", uploadedAt: "2026-07-25T13:41:00+07:00" },
    ],
    approvals: [
      { id: "ap-20", actorId: "u-emp-2", action: "created", at: "2026-07-24T09:00:00+07:00" },
      { id: "ap-21", actorId: "u-emp-2", action: "submitted", at: "2026-07-25T14:00:00+07:00" },
    ],
  },

  // 9. Paid (earlier reimbursement — second entry for the recently-paid list)
  {
    id: "clm-1009",
    reference: "EXP-2026-0998",
    title: "Team Offsite – Bandung",
    purpose: "Quarterly operations team offsite and planning workshop.",
    employeeId: "u-emp-1",
    status: "paid",
    currency: "IDR",
    createdAt: "2026-05-04T09:00:00+07:00",
    submittedAt: "2026-05-05T09:00:00+07:00",
    decidedAt: "2026-05-08T09:00:00+07:00",
    tripStart: "2026-05-02",
    tripEnd: "2026-05-03",
    destination: "Bandung",
    lineItems: [
      li("li-27", "flight", "Return flight CGK ⇄ BDO", "2026-05-02", 1_900_000, true),
      li("li-28", "meals", "Team meals", "2026-05-02", 250_000, true),
    ],
    attachments: [
      { id: "at-14", fileName: "flight-bdo.pdf", sizeKb: 198, mimeType: "application/pdf", lineItemId: "li-27", uploadedAt: "2026-05-05T08:30:00+07:00" },
    ],
    approvals: [
      { id: "ap-22", actorId: "u-emp-1", action: "created", at: "2026-05-04T09:00:00+07:00" },
      { id: "ap-23", actorId: "u-emp-1", action: "submitted", at: "2026-05-05T09:00:00+07:00" },
      { id: "ap-24", actorId: "u-mgr-1", action: "approved", at: "2026-05-08T09:00:00+07:00", note: "Approved." },
      { id: "ap-24b", actorId: "u-fin-1", action: "processing", at: "2026-05-11T09:00:00+07:00", note: "Bank transfer TRX-871130 queued." },
      { id: "ap-25", actorId: "u-fin-1", action: "paid", at: "2026-05-12T10:00:00+07:00", note: "Disbursed via bank transfer." },
    ],
    payment: {
      method: "bank_transfer",
      reference: "TRX-871130",
      processedBy: "u-fin-1",
      processedAt: "2026-05-11T09:00:00+07:00",
      paidBy: "u-fin-1",
      paidAt: "2026-05-12T10:00:00+07:00",
    },
  },

  // 10. Approved with an OPEN over-policy exception — finance exception queue.
  {
    id: "clm-1010",
    reference: "EXP-2026-1010",
    title: "Annual Sales Kickoff – Bali",
    purpose: "Annual sales leadership kickoff and forecasting workshop.",
    employeeId: "u-emp-3",
    status: "approved",
    currency: "IDR",
    createdAt: "2026-07-18T09:00:00+07:00",
    submittedAt: "2026-07-19T09:00:00+07:00",
    decidedAt: "2026-07-22T10:00:00+07:00",
    tripStart: "2026-07-15",
    tripEnd: "2026-07-16",
    destination: "Bali",
    lineItems: [
      li("li-29", "flight", "Return flight CGK ⇄ DPS", "2026-07-15", 2_000_000, true),
      li("li-30", "hotel", "Beachfront suite — 1 night", "2026-07-15", 1_800_000, true, { quantity: 1, unitLabel: "nights", unitRate: 1_800_000 }),
      li("li-31", "meals", "Kickoff dinner", "2026-07-15", 300_000, true),
    ],
    attachments: [
      { id: "at-15", fileName: "flight-kickoff.pdf", sizeKb: 210, mimeType: "application/pdf", lineItemId: "li-29", uploadedAt: "2026-07-19T08:30:00+07:00" },
      { id: "at-16", fileName: "hotel-kickoff.pdf", sizeKb: 188, mimeType: "application/pdf", lineItemId: "li-30", uploadedAt: "2026-07-19T08:31:00+07:00" },
    ],
    approvals: [
      { id: "ap-26", actorId: "u-emp-3", action: "created", at: "2026-07-18T09:00:00+07:00" },
      { id: "ap-27", actorId: "u-emp-3", action: "submitted", at: "2026-07-19T09:00:00+07:00", note: "Submitted with a policy warning on the hotel rate." },
      { id: "ap-28", actorId: "u-mgr-1", action: "approved", at: "2026-07-21T10:00:00+07:00", note: "Approved — flagged for finance exception review." },
      { id: "ap-29", actorId: "u-mgr-1", action: "approved", at: "2026-07-22T10:00:00+07:00", note: "Finance review: cleared to pay pending exception resolution." },
    ],
    exception: {
      id: "exc-3",
      type: "over_policy",
      severity: "medium",
      message: "Hotel nightly rate of IDR 1,800,000 exceeds the IDR 1,200,000 policy cap by IDR 600,000.",
      flaggedAt: "2026-07-19T09:00:30+07:00",
      status: "open",
    },
  },

  // 11. Approved with an OPEN missing-receipt exception — finance exception queue.
  {
    id: "clm-1011",
    reference: "EXP-2026-1011",
    title: "Client Site Survey – Surabaya",
    purpose: "Pre-contract site survey and technical assessment.",
    employeeId: "u-emp-3",
    status: "approved",
    currency: "IDR",
    createdAt: "2026-07-20T09:00:00+07:00",
    submittedAt: "2026-07-21T09:00:00+07:00",
    decidedAt: "2026-07-24T09:00:00+07:00",
    tripStart: "2026-07-17",
    tripEnd: "2026-07-17",
    destination: "Surabaya",
    lineItems: [
      li("li-32", "taxi", "Airport and inter-site taxis", "2026-07-17", 150_000, false),
      li("li-33", "meals", "Client working lunch", "2026-07-17", 620_000, false),
      li("li-34", "other", "Site printing and materials", "2026-07-17", 200_000, true),
    ],
    attachments: [
      { id: "at-17", fileName: "site-materials.pdf", sizeKb: 142, mimeType: "application/pdf", lineItemId: "li-34", uploadedAt: "2026-07-21T08:30:00+07:00" },
    ],
    approvals: [
      { id: "ap-30", actorId: "u-emp-3", action: "created", at: "2026-07-20T09:00:00+07:00" },
      { id: "ap-31", actorId: "u-emp-3", action: "submitted", at: "2026-07-21T09:00:00+07:00", note: "Client lunch receipt to follow after the venue sends it." },
      { id: "ap-32", actorId: "u-mgr-1", action: "approved", at: "2026-07-24T09:00:00+07:00", note: "Approved — finance to confirm the missing receipt exception." },
    ],
    exception: {
      id: "exc-4",
      type: "missing_receipt",
      severity: "high",
      message: "Client working lunch of IDR 620,000 exceeds the IDR 500,000 receipt threshold but has no attached receipt.",
      flaggedAt: "2026-07-21T09:00:30+07:00",
      status: "open",
    },
  },

  // 12. Approved, clean (no exception) — ready to pay on the payment board.
  {
    id: "clm-1012",
    reference: "EXP-2026-1012",
    title: "Technical Training – Jakarta",
    purpose: "Mandatory technical certification refresher.",
    employeeId: "u-emp-3",
    status: "approved",
    currency: "IDR",
    createdAt: "2026-07-23T09:00:00+07:00",
    submittedAt: "2026-07-24T09:00:00+07:00",
    decidedAt: "2026-07-27T09:00:00+07:00",
    tripStart: "2026-07-21",
    tripEnd: "2026-07-21",
    destination: "Jakarta",
    lineItems: [
      li("li-35", "flight", "Return flight CGK ⇄ CGK", "2026-07-21", 1_500_000, true),
      li("li-36", "hotel", "Hotel — 1 night", "2026-07-21", 1_000_000, true, { quantity: 1, unitLabel: "nights", unitRate: 1_000_000 }),
      li("li-37", "meals", "Training day meals", "2026-07-21", 280_000, true),
    ],
    attachments: [
      { id: "at-18", fileName: "flight-training.pdf", sizeKb: 196, mimeType: "application/pdf", lineItemId: "li-35", uploadedAt: "2026-07-24T08:30:00+07:00" },
      { id: "at-19", fileName: "hotel-training.pdf", sizeKb: 170, mimeType: "application/pdf", lineItemId: "li-36", uploadedAt: "2026-07-24T08:31:00+07:00" },
    ],
    approvals: [
      { id: "ap-33", actorId: "u-emp-3", action: "created", at: "2026-07-23T09:00:00+07:00" },
      { id: "ap-34", actorId: "u-emp-3", action: "submitted", at: "2026-07-24T09:00:00+07:00" },
      { id: "ap-35", actorId: "u-mgr-1", action: "approved", at: "2026-07-27T09:00:00+07:00", note: "Approved — within policy." },
    ],
  },
];

/* --------------------------------------------------------------- payments -- */

export const payments: Payment[] = [
  { id: "pay-1", claimId: "clm-1005", claimReference: "EXP-2026-1005", claimTitle: "Site Inspection – Semarang", payeeId: "u-emp-2", amount: 2_435_000, currency: "IDR", method: "bank_transfer", status: "processing", scheduledFor: "2026-07-29" },
  { id: "pay-2", claimId: "clm-1004", claimReference: "EXP-2026-1004", claimTitle: "Regional Sales Sync – Medan", payeeId: "u-emp-3", amount: 4_510_000, currency: "IDR", method: "bank_transfer", status: "queued" },
  { id: "pay-3", claimId: "clm-1006", claimReference: "EXP-2026-1006", claimTitle: "Training Conference – Bali", payeeId: "u-emp-1", amount: 5_450_000, currency: "IDR", method: "bank_transfer", status: "paid", paidAt: "2026-06-20T15:00:00+07:00", bankReference: "TRX-880021" },
  { id: "pay-4", claimId: "clm-9901", claimReference: "EXP-2026-0990", claimTitle: "Client Lunch – Jakarta", payeeId: "u-emp-3", amount: 620_000, currency: "IDR", method: "payroll", status: "scheduled", scheduledFor: "2026-07-31" },
  { id: "pay-5", claimId: "clm-9902", claimReference: "EXP-2026-0975", claimTitle: "Courier & Postage", payeeId: "u-emp-2", amount: 145_000, currency: "IDR", method: "bank_transfer", status: "failed", bankReference: "TRX-879940" },
];

/* --------------------------------------------------------------- comments -- */

export const comments: Comment[] = [
  { id: "cm-1", claimId: "clm-1003", authorId: "u-mgr-1", body: "Hi Aulia, could you attach the hotel invoice? The amount is above our receipt threshold.", at: "2026-07-13T14:22:00+07:00" },
  { id: "cm-2", claimId: "clm-1003", authorId: "u-emp-1", body: "Sure, I'll dig it out of my email and resubmit today.", at: "2026-07-13T15:05:00+07:00" },
  { id: "cm-3", claimId: "clm-1001", authorId: "u-emp-1", body: "Flagged the taxi rides — no receipt available for street taxis, under the IDR 200k threshold.", at: "2026-07-21T09:34:00+07:00" },
  { id: "cm-4", claimId: "clm-1004", authorId: "u-mgr-1", body: "Approved. Nicely itemised, thanks Sari.", at: "2026-07-18T10:16:00+07:00" },
];

/* ---------------------------------------------------------- notifications -- */

export const notifications: Notification[] = [
  { id: "nt-1", audience: "employee", category: "action", title: "Action required on EXP-2026-1003", body: "Dewi Anggraeni returned your claim: hotel invoice missing.", at: "2026-07-13T14:20:00+07:00", read: false, claimId: "clm-1003" },
  { id: "nt-2", audience: "employee", category: "payment", title: "Payment sent", body: "IDR 5,450,000 for Training Conference – Bali was disbursed.", at: "2026-06-20T15:00:00+07:00", read: true, claimId: "clm-1006" },
  { id: "nt-3", audience: "employee", category: "approval", title: "Claim submitted", body: "Q2 Client Visit – Jakarta is awaiting approval.", at: "2026-07-21T09:32:00+07:00", read: true, claimId: "clm-1001" },
  { id: "nt-4", audience: "approver", category: "approval", title: "New claim to review", body: "Aulia Pratiwi submitted Q2 Client Visit – Jakarta (IDR 4,787,000).", at: "2026-07-21T09:32:00+07:00", read: false, claimId: "clm-1001" },
  { id: "nt-5", audience: "approver", category: "approval", title: "New claim to review", body: "Bima Nugroho submitted Partner Meeting – Makassar (IDR 5,115,000).", at: "2026-07-25T14:00:00+07:00", read: false, claimId: "clm-1008" },
  { id: "nt-6", audience: "finance", category: "action", title: "Exception flagged", body: "EXP-2026-1003 has an open missing-receipt exception.", at: "2026-07-13T14:19:00+07:00", read: false, claimId: "clm-1003" },
  { id: "nt-7", audience: "finance", category: "payment", title: "Payment failed", body: "Bank transfer TRX-879940 for EXP-2026-0975 was rejected by the bank.", at: "2026-07-26T10:12:00+07:00", read: false, claimId: "clm-9902" },
  { id: "nt-8", audience: "finance", category: "approval", title: "Claim ready to pay", body: "Regional Sales Sync – Medan was approved and is queued for payment.", at: "2026-07-18T10:15:00+07:00", read: true, claimId: "clm-1004" },
];

/* -------------------------------------------------------------- audit log -- */

export const auditLog: AuditEntry[] = [
  { id: "au-1", claimId: "clm-1001", actorId: "u-emp-1", action: "Claim created", at: "2026-07-20T08:10:00+07:00", detail: "Draft created with 0 line items." },
  { id: "au-2", claimId: "clm-1001", actorId: "u-emp-1", action: "Line items added", at: "2026-07-20T08:40:00+07:00", detail: "5 line items totalling IDR 4,787,000." },
  { id: "au-3", claimId: "clm-1001", actorId: "u-emp-1", action: "Attachments uploaded", at: "2026-07-21T09:24:00+07:00", detail: "3 receipts attached." },
  { id: "au-4", claimId: "clm-1001", actorId: "u-emp-1", action: "Submitted for approval", at: "2026-07-21T09:32:00+07:00", detail: "Routed to Dewi Anggraeni (Line manager)." },
  { id: "au-5", claimId: "clm-1003", actorId: "u-mgr-1", action: "Returned to employee", at: "2026-07-13T14:20:00+07:00", detail: "Reason: missing hotel receipt above threshold." },
  { id: "au-6", claimId: "clm-1006", actorId: "u-fin-1", action: "Payment disbursed", at: "2026-06-20T15:00:00+07:00", detail: "Bank transfer TRX-880021, IDR 5,450,000." },
];

/* ------------------------------------------------------------- selectors -- */

export function computeClaimTotal(claim: Claim): number {
  return claim.lineItems.reduce((sum, item) => sum + item.amount, 0);
}

/** Threshold above which a claim needs a second "Finance review" step. */
export const HIGH_VALUE_THRESHOLD = 5_000_000;

/**
 * Resolve the ordered approval steps a claim must clear, mirroring the routing
 * rules fixture: standard claims stop at the line manager; high-value or
 * exception-flagged claims also pass through a finance review step. Used by the
 * approver decision flow to decide whether "Approve" advances the claim to the
 * next step or finalises it.
 */
export function routingStepsForClaim(claim: Claim): string[] {
  if (claim.exception || computeClaimTotal(claim) > HIGH_VALUE_THRESHOLD) {
    return ["Line manager", "Finance review"];
  }
  return ["Line manager"];
}

/**
 * Claims currently awaiting the line-manager approver (step 0). Pending claims
 * that have already been approved past step 0 (advanced to Finance review) are
 * intentionally excluded — they have left the approver's inbox. Phase 1 has a
 * single approver, so the optional id is accepted for forward-compatibility but
 * not yet used to filter.
 */
export function claimsForApprover(_approverId?: string): Claim[] {
  return claims.filter(
    (c) => c.status === "pending" && (c.currentStepIndex ?? 0) === 0
  );
}

/**
 * Push a notification into the live store. Used by the mock decision flow so the
 * employee/finance audience sees a fresh row after an approval, rejection, or
 * return — mirroring how the real backend would emit domain events.
 */
let notificationSeq = 9000;
export function pushNotification(n: Omit<Notification, "id">): Notification {
  const entry: Notification = { id: `nt-${++notificationSeq}`, ...n };
  notifications.unshift(entry);
  return entry;
}

/**
 * Append an immutable audit row to the live audit log. Used by the mock
 * Finance decision flow so the claim's audit trail re-renders immediately
 * after an exception resolution or payment transition.
 */
let auditSeq = 8000;
export function pushAudit(a: Omit<AuditEntry, "id">): AuditEntry {
  const entry: AuditEntry = { id: `au-${++auditSeq}`, ...a };
  auditLog.unshift(entry);
  return entry;
}

export function getUser(id: string): User | undefined {
  return users.find((u) => u.id === id);
}

export function getUserName(id: string): string {
  return getUser(id)?.name ?? "Unknown";
}

export function getClaim(id: string): Claim | undefined {
  return claims.find((c) => c.id === id);
}

export function getCategory(id: string): ExpenseCategory | undefined {
  return categories.find((c) => c.id === id);
}

export function claimsForEmployee(employeeId: string): Claim[] {
  return claims.filter((c) => c.employeeId === employeeId);
}

export function openExceptions(): Claim[] {
  return claims.filter((c) => c.exception && c.exception.status === "open");
}

/**
 * Claim statuses that put a claim in Finance's hands for payment: fully
 * approved (ready to disburse), mid-flight (processing), or already paid.
 * Used to scope the Finance exception queue so claims returned to the
 * employee (action_required) are not counted as Finance's to resolve.
 */
export const FINANCE_PAYMENT_STATUSES: ClaimStatus[] = [
  "approved",
  "processing",
  "paid",
];

/**
 * Finance-scoped exception queue: claims that are in the payment lifecycle
 * (approved / processing) AND still carry an open policy flag. These are the
 * claims genuinely needing a Finance judgment call — not every open flag in
 * the system (an action_required claim is back with the employee).
 */
export function openFinanceExceptions(): Claim[] {
  return claims.filter(
    (c) =>
      FINANCE_PAYMENT_STATUSES.includes(c.status) &&
      c.exception?.status === "open"
  );
}

/** Claims fully approved and ready for Finance to disburse. Claims still
 *  carrying an OPEN policy flag are excluded — they must be resolved in the
 *  exception queue before they can be paid. */
export function claimsReadyToPay(): Claim[] {
  return claims.filter(
    (c) => c.status === "approved" && c.exception?.status !== "open"
  );
}

/** Claims whose payment is currently in flight. */
export function claimsProcessing(): Claim[] {
  return claims.filter((c) => c.status === "processing");
}

/** Claims already reimbursed, newest-paid first. */
export function claimsPaid(): Claim[] {
  return claims
    .filter((c) => c.status === "paid")
    .sort((a, b) => {
      const pa = a.payment?.paidAt ?? a.decidedAt ?? a.submittedAt ?? a.createdAt;
      const pb = b.payment?.paidAt ?? b.decidedAt ?? b.submittedAt ?? b.createdAt;
      return pb.localeCompare(pa);
    });
}

export function commentsForClaim(claimId: string): Comment[] {
  return comments
    .filter((c) => c.claimId === claimId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function auditForClaim(claimId: string): AuditEntry[] {
  return auditLog
    .filter((a) => a.claimId === claimId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function notificationsFor(role: Role): Notification[] {
  return notifications
    .filter((n) => n.audience === role)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function unreadCount(role: Role): number {
  return notifications.filter((n) => n.audience === role && !n.read).length;
}

/**
 * Whether a user may participate in a claim's comments / audit trail.
 *
 * Phase 1 has one user per role: the claim submitter, their line manager
 * (the approver in the claim's routing — every seeded employee reports to
 * u-mgr-1), and the Finance Admin. The submitter, any approver in the claim's
 * routing, and Finance are participants; anyone else is blocked. Used to gate
 * the comments thread and the audit viewer per ticket #8.
 */
export function isClaimParticipant(claim: Claim, user: User): boolean {
  if (user.role === "finance") return true;
  if (claim.employeeId === user.id) return true;
  if (user.role === "approver") {
    // Phase 1 routing step 0 is "submitter_manager" → resolve to the manager id.
    const submitter = getUser(claim.employeeId);
    return submitter?.managerId === user.id;
  }
  return false;
}

/**
 * Resolve the claim detail route for a role. Employee and Approver each have a
 * dedicated per-claim detail page; Finance has no standalone claim detail in
 * Phase 1, so the audit trail (Finance-accessible, claim-scoped) is the
 * closest "claim view". Used by notification click navigation (#8).
 */
export function claimDetailRoute(role: Role, claimId: string): string {
  if (role === "employee") return `/employee/claims/${claimId}`;
  if (role === "approver") return `/approver/claims/${claimId}`;
  return `/claims/${claimId}/audit`;
}

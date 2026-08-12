import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * SpendFlow backend schema (BE-auth, ticket #10).
 *
 * `users`, `sessions`, `accounts`, `verifications` are the Better Auth core
 * schema (mapped via `usePlural: true`) extended with SpendFlow organisation
 * fields on `users`. `audit_logs` is owned by this app.
 *
 * Column naming is snake_case in the database; Drizzle property names are kept
 * camelCase where Better Auth expects them, so no field remapping is needed.
 * Drizzle serialises Date values via `timestamp` mode and the adapter
 * round-trips them as Date objects.
 */

/* ------------------------------------------------------------------ users -- */

export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  // --- SpendFlow org fields (server-owned; see auth additionalFields) ---
  // JSON-encoded array of roles (#44). Every user has at least one role; the
  // empty default exists only so a fresh `users` column insert never violates
  // NOT NULL — insert paths always set an explicit non-empty array.
  roles: text("roles").notNull().default("[]"),
  // Derived single role (finance > approver > employee precedence) kept for
  // single-role call sites + admin display. Written on every role mutation.
  primaryRole: text("primary_role", {
    enum: ["employee", "approver", "finance"],
  })
    .notNull()
    .default("employee"),
  // Self-referencing reporting line. NULL for users without a manager.
  managerId: text("manager_id").references(
    (): AnySQLiteColumn => usersTable.id,
    { onDelete: "set null" }
  ),
  department: text("department"),
  costCenter: text("cost_center"),
  status: text("status", { enum: ["active", "disabled", "pending"] })
    .notNull()
    .default("active"),
  // Mirror of the credential hash stored in `accounts.password`. Better Auth
  // normalises credentials into its `accounts` table (its multi-provider
  // model) and remains the verifier; `users.password_hash` is kept in sync by
  // the provisioning helper so the column required by the PRD schema is
  // present and auditable.
  passwordHash: text("password_hash"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const usersRelations = relations(usersTable, ({ one, many }) => ({
  sessions: many(sessionsTable),
  accounts: many(accountsTable),
  manager: one(usersTable, {
    fields: [usersTable.managerId],
    references: [usersTable.id],
    relationName: "managerReports",
  }),
  reports: many(usersTable, { relationName: "managerReports" }),
  invitations: many(userInvitationsTable),
}));

/* --------------------------------------------------------- user_invitations -- */

/**
 * Single-use invite token for a `status = "pending"` user. The token is
 * opaque (32 random bytes, base64url) and the accepted invariant is one active
 * invite per pending user (accept marks the row consumed). Emails are MOCKED
 * this cycle — the invite URL is written to `backend/logs/invites.log`.
 */
export const userInvitationsTable = sqliteTable(
  "user_invitations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    // Unix ms. Invites are valid for 7 days.
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    consumedByIp: text("consumed_by_ip"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({ tokenIdx: index("user_invitations_token_idx").on(t.token) })
);

export const userInvitationsRelations = relations(
  userInvitationsTable,
  ({ one }) => ({
    user: one(usersTable, {
      fields: [userInvitationsTable.userId],
      references: [usersTable.id],
    }),
  })
);

/* --------------------------------------------------------------- sessions -- */

export const sessionsTable = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const sessionsRelations = relations(sessionsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [sessionsTable.userId],
    references: [usersTable.id],
  }),
}));

/* --------------------------------------------------------------- accounts -- */

export const accountsTable = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  idToken: text("id_token"),
  // Credential hash used by Better Auth's email/password verifier.
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const accountsRelations = relations(accountsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [accountsTable.userId],
    references: [usersTable.id],
  }),
}));

/* ----------------------------------------------------------- verifications - */

export const verificationsTable = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/* ------------------------------------------------------------- audit_logs -- */

export const auditLogsTable = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  // JSON-encoded before/after snapshots (stringified for SQLite portability).
  before: text("before"),
  after: text("after"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/* ------------------------------------------------------------- categories -- */

/**
 * Admin-managed expense category. Seeded with the Phase 1 set (flight, hotel,
 * meals, taxi, mileage, other). `mileage_rate` (IDR per km) drives the
 * server-side mileage amount computation in claimStore.
 */
export const categoriesTable = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    requiresReceipt: integer("requires_receipt", { mode: "boolean" })
      .notNull()
      .default(false),
    receiptThreshold: integer("receipt_threshold").notNull().default(0),
    perItemCap: integer("per_item_cap"),
    // Set only for distance-based categories (mileage). Server reads this to
    // compute amount = quantity × mileage_rate, never trusting client amount.
    mileageRate: integer("mileage_rate"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({ activeIdx: index("categories_active_idx").on(t.active) })
);

/* --------------------------------------------------------------- policies -- */

/** Allowlisted policy/claim currencies (BE-admin, #14). Enforced at the store
 *  boundary — the column itself stays plain `text` for portability. */
export const CURRENCIES = ["IDR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * Configurable spend policy. Consumed by the (pure) policy engine at claim
 * submission time. Scoped to a category when `category_id` is set; otherwise
 * applies to every line item. CRUD UI is BE-admin (#13–16); this ticket only
 * reads rows.
 */
export const policiesTable = sqliteTable(
  "policies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    categoryId: text("category_id").references(() => categoriesTable.id, {
      onDelete: "set null",
    }),
    limitAmount: integer("limit_amount"),
    period: text("period", {
      enum: ["per_item", "per_day", "per_trip", "per_month"],
    })
      .notNull()
      .default("per_item"),
    currency: text("currency").notNull().default("IDR"),
    receiptRequired: integer("receipt_required", { mode: "boolean" })
      .notNull()
      .default(false),
    receiptRequiredAbove: integer("receipt_required_above").notNull().default(0),
    justificationRequiredAbove: integer("justification_required_above")
      .notNull()
      .default(0),
    effectiveDate: text("effective_date").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    activeIdx: index("policies_active_idx").on(t.active),
    categoryIdx: index("policies_category_idx").on(t.categoryId),
  })
);

/* ----------------------------------------------------------------- claims -- */

export const CLAIM_STATUSES = [
  "draft",
  "pending",
  "action_required",
  "approved",
  "rejected",
  "processing",
  "paid",
  "blocked_sod",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const claimsTable = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(),
    // Human-readable reference, e.g. "EXP-2026-1001". Generated server-side.
    reference: text("reference").notNull().unique(),
    title: text("title").notNull(),
    purpose: text("purpose").notNull().default(""),
    employeeId: text("employee_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: text("status", { enum: CLAIM_STATUSES }).notNull().default("draft"),
    currency: text("currency").notNull().default("IDR"),
    tripStart: text("trip_start"),
    tripEnd: text("trip_end"),
    destination: text("destination"),
    // The route resolved at submission time. Null while the claim is a draft.
    approvalRouteId: text("approval_route_id").references(
      (): AnySQLiteColumn => approvalRoutesTable.id,
      { onDelete: "set null" }
    ),
    // Zero-based index into the resolved route's ordered steps. The claim is at
    // this approver's desk; advanced by approve until the final step clears.
    currentStepIndex: integer("current_step_index").notNull().default(0),
    // Aggregated policy warning summary persisted at submit time (JSON). Used
    // by downstream exception review. Null when no warnings fired.
    policyException: text("policy_exception"),
    // SoD block reason (ticket #46). Set when submission resolves a route step
    // to the submitter (or needs a manager the submitter lacks); null otherwise.
    blockedReason: text("blocked_reason"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    employeeIdx: index("claims_employee_idx").on(t.employeeId),
    statusIdx: index("claims_status_idx").on(t.status),
    routeIdx: index("claims_route_idx").on(t.approvalRouteId),
  })
);

export const claimsRelations = relations(claimsTable, ({ one, many }) => ({
  employee: one(usersTable, {
    fields: [claimsTable.employeeId],
    references: [usersTable.id],
  }),
  approvalRoute: one(approvalRoutesTable, {
    fields: [claimsTable.approvalRouteId],
    references: [approvalRoutesTable.id],
  }),
  lineItems: many(claimLineItemsTable),
  approvalActions: many(approvalActionsTable),
}));

/* ------------------------------------------------------- claim_line_items -- */

export const claimLineItemsTable = sqliteTable(
  "claim_line_items",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claimsTable.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categoriesTable.id, { onDelete: "restrict" }),
    description: text("description").notNull().default(""),
    // ISO date the expense was incurred.
    date: text("date").notNull(),
    // Minor-units integer. For mileage categories this is computed server-side
    // from quantity × category.mileage_rate and never trusted from the client.
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("IDR"),
    // Quantity of units (e.g. km for mileage, nights for hotel).
    quantity: integer("quantity"),
    unitLabel: text("unit_label"),
    // Snapshot of the rate applied at entry (audit trail for mileage lines).
    unitRate: integer("unit_rate"),
    // Denormalised "has at least one attachment" flag — the policy engine
    // reads this to decide whether a receipt is missing. Maintained by the
    // attachment service on upload/delete.
    hasReceipt: integer("has_receipt", { mode: "boolean" })
      .notNull()
      .default(false),
    note: text("note"),
    // JSON array of policy violations persisted at submit time. Null when the
    // line passed all policies cleanly. Overwritten on resubmit (idempotent).
    policyFlag: text("policy_flag"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    claimIdx: index("claim_line_items_claim_idx").on(t.claimId),
    categoryIdx: index("claim_line_items_category_idx").on(t.categoryId),
  })
);

export const claimLineItemsRelations = relations(
  claimLineItemsTable,
  ({ one, many }) => ({
    claim: one(claimsTable, {
      fields: [claimLineItemsTable.claimId],
      references: [claimsTable.id],
    }),
    category: one(categoriesTable, {
      fields: [claimLineItemsTable.categoryId],
      references: [categoriesTable.id],
    }),
    attachments: many(attachmentsTable),
  })
);

/* ------------------------------------------------------------ attachments -- */

export const attachmentsTable = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    lineItemId: text("line_item_id")
      .notNull()
      .references(() => claimLineItemsTable.id, { onDelete: "cascade" }),
    // Original client-side filename (sanitised for the on-disk path separately).
    fileName: text("file_name").notNull(),
    // Relative path under backend/uploads/ (<lineId>/<filename>).
    fileUrl: text("file_url").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Manually-entered receipt metadata (NO OCR extraction in Phase 1).
    merchant: text("merchant"),
    amount: integer("amount"),
    currency: text("currency"),
    transactionDate: text("transaction_date"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    lineItemIdx: index("attachments_line_item_idx").on(t.lineItemId),
    uploaderIdx: index("attachments_uploaded_by_idx").on(t.uploadedBy),
  })
);

export const attachmentsRelations = relations(attachmentsTable, ({ one }) => ({
  lineItem: one(claimLineItemsTable, {
    fields: [attachmentsTable.lineItemId],
    references: [claimLineItemsTable.id],
  }),
  uploader: one(usersTable, {
    fields: [attachmentsTable.uploadedBy],
    references: [usersTable.id],
  }),
}));

/* -------------------------------------------------------- approval_routes -- */

export const APPROVER_TYPES = [
  "submitter_manager",
  "specific_user",
  "finance",
] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];

export const approvalRoutesTable = sqliteTable(
  "approval_routes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Structured match criteria. A claim matches when every populated criterion
    // is satisfied. All-null = matches any claim (used by the fallback route).
    matchMinAmount: integer("match_min_amount"),
    matchMaxAmount: integer("match_max_amount"),
    matchCategoryId: text("match_category_id").references(
      (): AnySQLiteColumn => categoriesTable.id,
      { onDelete: "set null" }
    ),
    matchDepartment: text("match_department"),
    isFallback: integer("is_fallback", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    activeIdx: index("approval_routes_active_idx").on(t.active),
    fallbackIdx: index("approval_routes_fallback_idx").on(t.isFallback),
  })
);

export const approvalRoutesRelations = relations(
  approvalRoutesTable,
  ({ one, many }) => ({
    steps: many(approvalStepsTable),
    matchCategory: one(categoriesTable, {
      fields: [approvalRoutesTable.matchCategoryId],
      references: [categoriesTable.id],
    }),
  })
);

/* --------------------------------------------------------- approval_steps -- */

export const approvalStepsTable = sqliteTable(
  "approval_steps",
  {
    id: text("id").primaryKey(),
    routeId: text("route_id")
      .notNull()
      .references(() => approvalRoutesTable.id, { onDelete: "cascade" }),
    // Zero-based ordering. Step 0 is the first reviewer.
    orderIndex: integer("order_index").notNull(),
    approverType: text("approver_type", { enum: APPROVER_TYPES }).notNull(),
    // Required when approverType === "specific_user"; null otherwise.
    approverId: text("approver_id").references((): AnySQLiteColumn => usersTable.id, {
      onDelete: "set null",
    }),
    label: text("label").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    routeIdx: index("approval_steps_route_idx").on(t.routeId),
    orderIdx: index("approval_steps_order_idx").on(t.orderIndex),
  })
);

export const approvalStepsRelations = relations(approvalStepsTable, ({ one }) => ({
  route: one(approvalRoutesTable, {
    fields: [approvalStepsTable.routeId],
    references: [approvalRoutesTable.id],
  }),
  approver: one(usersTable, {
    fields: [approvalStepsTable.approverId],
    references: [usersTable.id],
  }),
}));

/* ------------------------------------------------------- approval_actions -- */

export const APPROVAL_ACTIONS = [
  "created",
  "submitted",
  "approved",
  "rejected",
  "returned",
  "resubmitted",
  "withdrawn",
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const approvalActionsTable = sqliteTable(
  "approval_actions",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claimsTable.id, { onDelete: "cascade" }),
    // The step this decision was taken against. Used for stale-decision
    // detection + audit. Null for lifecycle actions (created/submitted/etc).
    stepId: text("step_id").references((): AnySQLiteColumn => approvalStepsTable.id, {
      onDelete: "set null",
    }),
    actorId: text("actor_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    action: text("action", { enum: APPROVAL_ACTIONS }).notNull(),
    comment: text("comment"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    claimIdx: index("approval_actions_claim_idx").on(t.claimId),
    stepIdx: index("approval_actions_step_idx").on(t.stepId),
    actorIdx: index("approval_actions_actor_idx").on(t.actorId),
  })
);

export const approvalActionsRelations = relations(
  approvalActionsTable,
  ({ one }) => ({
    claim: one(claimsTable, {
      fields: [approvalActionsTable.claimId],
      references: [claimsTable.id],
    }),
    step: one(approvalStepsTable, {
      fields: [approvalActionsTable.stepId],
      references: [approvalStepsTable.id],
    }),
    actor: one(usersTable, {
      fields: [approvalActionsTable.actorId],
      references: [usersTable.id],
    }),
  })
);

/* ------------------------------------------------------------ notifications -- */

export const NOTIFICATION_CATEGORIES = [
  "approval",
  "action",
  "payment",
  "system",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const notificationsTable = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    category: text("category", { enum: NOTIFICATION_CATEGORIES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    claimId: text("claim_id").references((): AnySQLiteColumn => claimsTable.id, {
      onDelete: "set null",
    }),
    // Legacy read flag from #10-#13. Superseded by `readAt` (#15), kept only so
    // the additive migration never drops/renames a column; new code reads and
    // writes `readAt` exclusively.
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    // Null while unread; stamped with the mark-read timestamp otherwise (#15).
    readAt: integer("read_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    recipientIdx: index("notifications_recipient_idx").on(t.recipientId),
    readAtIdx: index("notifications_read_at_idx").on(t.readAt),
  })
);

export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  recipient: one(usersTable, {
    fields: [notificationsTable.recipientId],
    references: [usersTable.id],
  }),
  claim: one(claimsTable, {
    fields: [notificationsTable.claimId],
    references: [claimsTable.id],
  }),
}));

/* ------------------------------------------------------------- comments --- */

/**
 * Contextual discussion on a claim (#15), separate from formal approval
 * decisions (`approval_actions.comment`). Visible to any claim participant —
 * submitter, current/former approver, finance admin. Adding a comment never
 * mutates claim status.
 */
export const commentsTable = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claimsTable.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    claimIdx: index("comments_claim_idx").on(t.claimId),
  })
);

export const commentsRelations = relations(commentsTable, ({ one }) => ({
  claim: one(claimsTable, {
    fields: [commentsTable.claimId],
    references: [claimsTable.id],
  }),
  author: one(usersTable, {
    fields: [commentsTable.authorId],
    references: [usersTable.id],
  }),
}));

/* ----------------------------------------------------------------- payments -- */

export const PAYMENT_METHODS = ["bank_transfer", "check", "cash", "other", "payroll"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["processing", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Reimbursement record for a claim, created when Finance transitions a claim
 * to Processing (method + reference captured then) and updated in place when
 * Finance marks it Paid (processed_by/processed_at stamped then). One row per
 * claim — a claim can only be processed once (#13).
 */
export const paymentsTable = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claimsTable.id, { onDelete: "cascade" }),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    referenceNumber: text("reference_number").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("IDR"),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("processing"),
    // Set only once the payment is marked Paid; null while Processing.
    processedBy: text("processed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    processedAt: integer("processed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({
    claimIdx: index("payments_claim_idx").on(t.claimId),
    statusIdx: index("payments_status_idx").on(t.status),
  })
);

export const paymentsRelations = relations(paymentsTable, ({ one }) => ({
  claim: one(claimsTable, {
    fields: [paymentsTable.claimId],
    references: [claimsTable.id],
  }),
  processor: one(usersTable, {
    fields: [paymentsTable.processedBy],
    references: [usersTable.id],
  }),
}));

/* ----------------------------------------------------------- password_resets -- */

/**
 * Single-use password-reset token (#69). The token is opaque (randomUUID v4,
 * 122 bits entropy) with a 1-hour TTL. Accepted invariant: one active reset
 * per request (older unconsumed rows for the same user are not invalidated
 * automatically — consumption marks the row, and a fresh request simply
 * supersedes via a new row). Single-use enforced by `consumed_at` stamp.
 */
export const passwordResetsTable = sqliteTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    // Unix seconds. Matches the `created_at` DEFAULT (unixepoch()).
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    tokenIdx: index("idx_password_resets_token").on(t.token),
    userIdx: index("idx_password_resets_user_id").on(t.userId),
  })
);

export const passwordResetsRelations = relations(
  passwordResetsTable,
  ({ one }) => ({
    user: one(usersTable, {
      fields: [passwordResetsTable.userId],
      references: [usersTable.id],
    }),
  })
);

/** Row type for the password_resets table (re-exported for callers). */
export type PasswordResetRow = typeof passwordResetsTable.$inferSelect;

/* -------------------------------------------------------------- exports ---- */

/** The schema handed to Better Auth's Drizzle adapter + owned by this app. */
export const schema = {
  users: usersTable,
  sessions: sessionsTable,
  accounts: accountsTable,
  verifications: verificationsTable,
  auditLogs: auditLogsTable,
  userInvitations: userInvitationsTable,
  categories: categoriesTable,
  policies: policiesTable,
  claims: claimsTable,
  claimLineItems: claimLineItemsTable,
  attachments: attachmentsTable,
  approvalRoutes: approvalRoutesTable,
  approvalSteps: approvalStepsTable,
  approvalActions: approvalActionsTable,
  notifications: notificationsTable,
  comments: commentsTable,
  payments: paymentsTable,
  passwordResets: passwordResetsTable,
};

export type Schema = typeof schema;

import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
  role: text("role", { enum: ["employee", "approver", "finance"] })
    .notNull()
    .default("employee"),
  // Self-referencing reporting line. NULL for users without a manager.
  managerId: text("manager_id").references(
    (): AnySQLiteColumn => usersTable.id,
    { onDelete: "set null" }
  ),
  department: text("department"),
  costCenter: text("cost_center"),
  status: text("status", { enum: ["active", "disabled"] })
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
}));

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

/* -------------------------------------------------------------- exports ---- */

/** The schema handed to Better Auth's Drizzle adapter. */
export const schema = {
  users: usersTable,
  sessions: sessionsTable,
  accounts: accountsTable,
  verifications: verificationsTable,
  auditLogs: auditLogsTable,
};

export type Schema = typeof schema;

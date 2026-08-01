/** SpendFlow backend shared domain types (BE-auth, ticket #10). */

export const ROLES = ["employee", "approver", "finance"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Public user shape — never includes password_hash. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: Role;
  managerId: string | null;
  department: string | null;
  costCenter: string | null;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

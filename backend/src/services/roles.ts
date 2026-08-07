/* ============================================================================
 * SpendFlow — multi-role helpers (ticket #44).
 *
 * `users.roles` is stored as a JSON-encoded text array (`'["approver"]'`);
 * `users.primary_role` is the derived single role written alongside it. These
 * pure helpers convert between the two representations and derive the primary
 * role using the finance > approver > employee precedence.
 * ========================================================================== */

import { ROLES, type Role } from "../types.js";

/** Parse a stored `roles` value into a Role[]. Tolerates a JSON array, a
 *  bare scalar string (legacy single role), and garbage (returns []). */
export function parseRoles(value: unknown): Role[] {
  if (Array.isArray(value)) {
    return value.filter(
      (r): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r)
    );
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return [];
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parseRoles(parsed) : [];
    } catch {
      // Not JSON — treat a bare valid role as a single-element array.
      if ((ROLES as readonly string[]).includes(trimmed)) return [trimmed as Role];
      return [];
    }
  }
  return [];
}

/** Serialize a Role[] into the stored JSON representation. */
export function serializeRoles(roles: Role[]): string {
  return JSON.stringify(roles);
}

/** The derived single role with finance > approver > employee precedence. */
export function derivePrimaryRole(roles: Role[]): Role {
  if (roles.includes("finance")) return "finance";
  if (roles.includes("approver")) return "approver";
  return "employee";
}

/** Wrap a single role as a one-element array (used by insert paths). */
export function roleToArray(role: Role): Role[] {
  return [role];
}

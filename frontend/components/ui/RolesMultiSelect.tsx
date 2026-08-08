"use client";

/* ============================================================================
 * SpendFlow — RolesMultiSelect (ticket #53).
 *
 * Controlled chip-group multi-select for the three SpendFlow roles
 * (employee, approver, finance). The derived `primaryRole`
 * (finance > approver > employee) is shown read-only when exactly one role
 * is picked, and as an overridable `Select` dropdown when 2+ are picked so a
 * Finance Admin can force a non-default landing role after sign-in.
 *
 * Backed by `Role` from `@/lib/types`; the BE accepts the resulting array
 * via PATCH /api/admin/users/:id/role (#53) or POST /api/admin/users.
 * ========================================================================== */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import type { Role } from "@/lib/types";

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "employee", label: "Employee" },
  { value: "approver", label: "Approver" },
  { value: "finance", label: "Finance Admin" },
];

/** FE mirror of `derivePrimaryRole` (BE services/roles.ts). */
export function derivePrimaryRole(roles: Role[]): Role {
  if (roles.includes("finance")) return "finance";
  if (roles.includes("approver")) return "approver";
  return "employee";
}

export interface RolesMultiSelectProps {
  label?: string;
  helper?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Selected roles (controlled). Must be non-empty; toggling the last role
   *  off is a no-op so the array never collapses to `[]`. */
  roles: Role[];
  onChange: (roles: Role[]) => void;
  /** Override the auto-derived primaryRole. When undefined the derived
   *  highest-privilege role is used. Must be a member of `roles`. */
  primaryRoleOverride?: Role;
  onPrimaryRoleChange?: (role: Role) => void;
}

export function RolesMultiSelect({
  label = "Roles",
  helper,
  error,
  required,
  disabled,
  roles,
  onChange,
  primaryRoleOverride,
  onPrimaryRoleChange,
}: RolesMultiSelectProps) {
  const derived = derivePrimaryRole(roles);
  const primary = primaryRoleOverride ?? derived;

  const toggle = (r: Role) => {
    if (disabled) return;
    if (roles.includes(r)) {
      const next = roles.filter((x) => x !== r);
      if (next.length === 0) return; // never empty
      // If the override was the dropped role, reset to the derived primary.
      if (primaryRoleOverride === r && onPrimaryRoleChange) {
        onPrimaryRoleChange(derivePrimaryRole(next));
      }
      onChange(next);
    } else {
      onChange([...roles, r]);
    }
  };

  const primaryOptions = roles.map((r) => ({
    value: r,
    label: ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r,
  }));

  return (
    <div className="space-y-1.5">
      {label && (
        <span className="block text-sm font-medium text-on-surface">
          {label}
          {required && <span className="ml-0.5 text-error">*</span>}
        </span>
      )}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={label}
      >
        {ROLE_OPTIONS.map((opt) => {
          const selected = roles.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`${opt.label} ${selected ? "selected" : "not selected"}`}
              onClick={() => toggle(opt.value)}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-primary/40",
                disabled && "cursor-not-allowed opacity-50",
                selected
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-outline bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {roles.length > 1 && (
        <Select
          label="Primary role"
          options={primaryOptions}
          value={primary}
          onChange={(v) => onPrimaryRoleChange?.(v as Role)}
          helper="Defaults to the highest-privilege role; override to change the sign-in landing role."
        />
      )}
      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : helper ? (
        <p className="text-xs text-on-surface-variant">{helper}</p>
      ) : null}
    </div>
  );
}

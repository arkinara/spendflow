import {
  AlertTriangle,
  BarChart3,
  Bell,
  CreditCard,
  Inbox,
  LayoutDashboard,
  ReceiptText,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { claimsForApprover } from "@/lib/seed-data";
import type { Role } from "@/lib/types";

/**
 * Role-aware navigation definition (Phase 1).
 *
 * Each mock role sees only its own nav items. Employee is intentionally limited
 * to Dashboard + Claims per the #1 ticket spec; Approver and Finance Admin each
 * get the items relevant to their workflow.
 *
 * Multi-role (#45): `getNavItems` now takes the full `roles[]` set and
 * concatenates each role's section so a user holding several roles sees every
 * link they're entitled to. The primary role's section is rendered first
 * (matching the post-login landing target); additional roles follow in a stable
 * canonical order (`employee` → `approver` → `finance`). Entries are
 * de-duplicated by `href` so a link shared between roles never appears twice.
 *
 * The Finance "Exceptions" badge is NOT computed here — it is fed the live
 * open-flag count by the caller (`AppShell` reads it from
 * `openExceptionStore`, whose source is `GET /api/finance/exceptions`, ticket
 * #37). Pass `openExceptionCount` and the badge trims to nothing when the
 * count is 0, missing, or the dashboard/queue failed to load.
 */

export interface NavDef {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

/** Canonical render order for additional (non-primary) roles. */
const ROLE_ORDER: Role[] = ["employee", "approver", "finance"];

/** Nav section for a single role (no de-dup — the composer below handles it). */
function navForRole(role: Role, openExceptionCount?: number | null): NavDef[] {
  switch (role) {
    case "employee":
      return [
        { label: "Dashboard", href: "/employee", icon: LayoutDashboard },
        { label: "My Claims", href: "/employee/claims", icon: ReceiptText },
      ];
    case "approver":
      return [
        {
          label: "Dashboard",
          href: "/approver",
          icon: LayoutDashboard,
          badge: claimsForApprover().length,
        },
        { label: "Alerts", href: "/notifications", icon: Bell },
      ];
    case "finance":
      return [
        { label: "Dashboard", href: "/finance", icon: LayoutDashboard },
        {
          label: "Exceptions",
          href: "/finance/exceptions",
          icon: AlertTriangle,
          // Live open-flag count from openExceptionStore; null/0 hide the badge.
          badge:
            openExceptionCount != null && openExceptionCount > 0
              ? openExceptionCount
              : undefined,
        },
        { label: "Payments", href: "/finance/payments", icon: CreditCard },
        { label: "Policies", href: "/finance/policies", icon: SlidersHorizontal },
        { label: "Users", href: "/finance/users", icon: Users },
        { label: "Reports", href: "/reports", icon: BarChart3 },
      ];
  }
}

/**
 * Build the nav for a user holding `roles`. The primary role's section leads
 * (matching the `ROLE_HOME[primaryRole]` landing target), then any additional
 * roles in canonical order. De-duplicated by `href` (first occurrence wins).
 *
 * Only roles actually present in `roles` render — `primaryRole` is used for
 * ordering, not as an implicit grant. An empty `roles` list (invalid session,
 * bounced by `RouteGuard` to /login) therefore yields no nav entries.
 */
export function getNavItems(
  roles: Role[],
  primaryRole: Role,
  openExceptionCount?: number | null,
): NavDef[] {
  // Lead with the primary role, then the remaining held roles in stable order.
  // Both lines are filtered against `roles` so a drifted/empty session never
  // shows nav for a role the user doesn't actually hold.
  const ordered = [
    primaryRole,
    ...ROLE_ORDER.filter((r) => r !== primaryRole),
  ].filter((r) => roles.includes(r));
  const seen = new Set<string>();
  const out: NavDef[] = [];
  for (const role of ordered) {
    for (const item of navForRole(role, openExceptionCount)) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      out.push(item);
    }
  }
  return out;
}

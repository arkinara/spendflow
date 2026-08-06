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

export function getNavItems(
  role: Role,
  openExceptionCount?: number | null,
): NavDef[] {
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

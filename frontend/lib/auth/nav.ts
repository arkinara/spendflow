import {
  AlertTriangle,
  BarChart3,
  Bell,
  CreditCard,
  Inbox,
  LayoutDashboard,
  ReceiptText,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import {
  claimsForApprover,
  openFinanceExceptions,
} from "@/lib/mock/mock_data";
import type { Role } from "@/lib/types";

/**
 * Role-aware navigation definition (Phase 1).
 *
 * Each mock role sees only its own nav items. Employee is intentionally limited
 * to Dashboard + Claims per the #1 ticket spec; Approver and Finance Admin each
 * get the items relevant to their workflow.
 */

export interface NavDef {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

export function getNavItems(role: Role): NavDef[] {
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
          badge: openFinanceExceptions().length,
        },
        { label: "Payments", href: "/finance/payments", icon: CreditCard },
        { label: "Policies", href: "/finance/policies", icon: SlidersHorizontal },
        { label: "Reports", href: "/reports", icon: BarChart3 },
      ];
  }
}

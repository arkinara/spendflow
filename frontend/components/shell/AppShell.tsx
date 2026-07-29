"use client";

import * as React from "react";
import {
  LayoutDashboard,
  ReceiptText,
  Inbox,
  AlertTriangle,
  CreditCard,
  SlidersHorizontal,
  BarChart3,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { AppBar } from "@/components/ui/AppBar";
import { NavBar, type NavItem } from "@/components/ui/NavBar";
import { RoleSwitcher, useRole } from "./RoleSwitcher";
import { unreadCount, claimsForApprover, openExceptions, type Role } from "@/lib/mock/mock_data";

interface NavDef {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

function navForRole(role: Role): NavDef[] {
  const inbox = claimsForApprover().length;
  const exceptions = openExceptions().length;
  switch (role) {
    case "employee":
      return [
        { label: "Dashboard", href: "/employee", icon: LayoutDashboard },
        { label: "My Claims", href: "/employee/claims", icon: ReceiptText },
        { label: "Reports", href: "/reports", icon: BarChart3 },
        { label: "Alerts", href: "/notifications", icon: Bell },
      ];
    case "approver":
      return [
        { label: "Dashboard", href: "/approver", icon: LayoutDashboard },
        { label: "Inbox", href: "/approver", icon: Inbox, badge: inbox },
        { label: "Reports", href: "/reports", icon: BarChart3 },
        { label: "Alerts", href: "/notifications", icon: Bell },
      ];
    case "finance":
      return [
        { label: "Dashboard", href: "/finance", icon: LayoutDashboard },
        { label: "Exceptions", href: "/finance/exceptions", icon: AlertTriangle, badge: exceptions },
        { label: "Payments", href: "/finance/payments", icon: CreditCard },
        { label: "Policies", href: "/finance/policies", icon: SlidersHorizontal },
        { label: "Reports", href: "/reports", icon: BarChart3 },
      ];
  }
}

const ROLE_HOME: Record<Role, string> = {
  employee: "/employee",
  approver: "/approver",
  finance: "/finance",
};

export interface AppShellProps {
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ action, children }: AppShellProps) {
  const { role, user } = useRole();
  const items: NavItem[] = navForRole(role);
  const unread = unreadCount(role);

  return (
    <div className="min-h-screen bg-background">
      <AppBar
        unreadCount={unread}
        action={action}
        roleSwitcher={<RoleSwitcher />}
        user={{ name: user.name, subtitle: user.jobTitle, color: user.avatarColor }}
        homeHref={ROLE_HOME[role]}
      />
      <NavBar items={items} />
      <main className="pb-24 pt-4 sm:pl-20 sm:pb-8 lg:pl-64">
        <div className="mx-0 w-full px-4 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}

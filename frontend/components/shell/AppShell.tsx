"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppBar } from "@/components/ui/AppBar";
import { NavBar, type NavItem } from "@/components/ui/NavBar";
import { useSession, useRole } from "@/lib/auth/session";
import { getNavItems } from "@/lib/auth/nav";
import { ROLE_HOME } from "@/lib/auth/routeAccess";
import { useUnreadCount } from "@/lib/store/notifyStore";
import { useOpenExceptionCount } from "@/lib/store/openExceptionStore";

export interface AppShellProps {
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ action, children }: AppShellProps) {
  const { role, user } = useRole();
  const { signOut } = useSession();
  const router = useRouter();
  // Polls GET /api/notifications/unread-count every 30s (paused while the tab
  // is hidden) and re-renders the badge the moment a mark-read action forces
  // an immediate refresh.
  const unread = useUnreadCount();
  // Live open-flag count for the Exceptions nav badge (#37). Null when not
  // Finance, while loading, or on dashboard/queue load failure — badge hidden.
  const openExceptionCount = useOpenExceptionCount(role === "finance");
  const items: NavItem[] = getNavItems(role, openExceptionCount);

  const handleSignOut = React.useCallback(() => {
    signOut();
    router.replace("/login");
  }, [signOut, router]);

  return (
    <div className="min-h-screen bg-background">
      <AppBar
        unreadCount={unread}
        action={action}
        user={{ name: user.name, subtitle: user.jobTitle, color: user.avatarColor }}
        homeHref={ROLE_HOME[role]}
        onSignOut={handleSignOut}
      />
      <NavBar items={items} />
      <main className="pb-24 pt-4 md:pl-20 md:pb-8 lg:pl-64">
        <div className="mx-0 w-full px-4 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}

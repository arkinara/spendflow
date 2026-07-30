"use client";

import { RouteGuard } from "@/components/shell/RouteGuard";

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RouteGuard allowedRoles={["employee", "approver", "finance"]}>{children}</RouteGuard>
  );
}

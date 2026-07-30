"use client";

import { RouteGuard } from "@/components/shell/RouteGuard";

export default function ClaimsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RouteGuard allowedRoles={["employee", "approver", "finance"]}>{children}</RouteGuard>
  );
}

"use client";

import { RouteGuard } from "@/components/shell/RouteGuard";

export default function ApproverLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard allowedRoles={["approver"]}>{children}</RouteGuard>;
}

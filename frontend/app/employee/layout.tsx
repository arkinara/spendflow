"use client";

import { RouteGuard } from "@/components/shell/RouteGuard";

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard allowedRoles={["employee"]}>{children}</RouteGuard>;
}

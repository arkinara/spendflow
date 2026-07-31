"use client";

import { RouteGuard } from "@/components/shell/RouteGuard";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard allowedRoles={["finance"]}>{children}</RouteGuard>;
}

"use client";

import { RouteGuard } from "@/components/shell/RouteGuard";

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard allowedRoles={["finance"]}>{children}</RouteGuard>;
}

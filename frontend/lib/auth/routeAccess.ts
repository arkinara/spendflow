import type { Role } from "@/lib/mock/mock_data";

/**
 * Client-side route access map (Phase 1, mock sessions).
 *
 * Real server-side role enforcement is BE-auth (out of scope). For Phase 1 the
 * mock role in localStorage is the source of truth, so route guarding happens
 * client-side via <RouteGuard> in each section layout.
 */

export const ROLE_HOME: Record<Role, string> = {
  employee: "/employee",
  approver: "/approver",
  finance: "/finance",
};

export type RouteAccess = Role[] | "public" | "auth";

/** Resolve which roles may view a given pathname. */
export function routeAccess(pathname: string): RouteAccess {
  if (pathname === "/" || pathname.startsWith("/login")) return "public";
  if (pathname.startsWith("/employee")) return ["employee"];
  if (pathname.startsWith("/approver")) return ["approver"];
  if (pathname.startsWith("/finance")) return ["finance"];
  if (pathname.startsWith("/reports")) return ["finance"];
  if (pathname.startsWith("/notifications")) return ["employee", "approver", "finance"];
  if (pathname.startsWith("/claims")) return ["employee", "approver", "finance"];
  return "auth";
}

export function canAccess(role: Role, pathname: string): boolean {
  const access = routeAccess(pathname);
  if (access === "public" || access === "auth") return true;
  return access.includes(role);
}

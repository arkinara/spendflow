"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/auth/routeAccess";
import { useSnackbar } from "@/components/ui/Snackbar";
import type { Role } from "@/lib/mock/mock_data";
import { AppShellSkeleton } from "./AppShellSkeleton";
import { SessionError } from "./SessionError";

/**
 * Client-side route guard for mock sessions.
 *
 * - loading → skeleton
 * - session-store failure → explicit error state (never an infinite skeleton)
 * - unauthenticated → redirect to /login?next=<path>
 * - authenticated but role not allowed → redirect to the role's home with a
 *   "not authorized" toast (never a blank/broken page)
 * - authenticated + allowed → render children
 */
export function RouteGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: Role[];
  children: React.ReactNode;
}) {
  const { status, session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const { show } = useSnackbar();
  const [redirecting, setRedirecting] = React.useState(false);
  const redirected = React.useRef(false);

  React.useEffect(() => {
    if (redirected.current) return;
    if (status === "loading" || status === "error") return;
    if (status === "unauthenticated") {
      redirected.current = true;
      setRedirecting(true);
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (session && !allowedRoles.includes(session.role)) {
      redirected.current = true;
      setRedirecting(true);
      show("You're not authorized to view that page.", { tone: "error" });
      router.replace(ROLE_HOME[session.role]);
    }
  }, [status, session, allowedRoles, pathname, router, show]);

  if (status === "error") return <SessionError />;
  if (status === "loading" || redirecting) return <AppShellSkeleton />;
  if (!session || !allowedRoles.includes(session.role)) return <AppShellSkeleton />;
  return <>{children}</>;
}

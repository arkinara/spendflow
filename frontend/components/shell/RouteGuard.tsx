"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShieldX } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/auth/routeAccess";
import { useSnackbar } from "@/components/ui/Snackbar";
import type { Role } from "@/lib/types";
import { AppShellSkeleton } from "./AppShellSkeleton";
import { SessionError } from "./SessionError";

/**
 * Client-side route guard for mock sessions.
 *
 * - loading → skeleton
 * - session-store failure → explicit error state (never an infinite skeleton)
 * - unauthenticated → redirect to /login?next=<path>
 * - authenticated but role not allowed → render a "not authorized" alert, then
 *   redirect to the role's home with a toast (never a blank/broken page)
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
  const [denyRole, setDenyRole] = React.useState(false);
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
      setDenyRole(true);
      setRedirecting(true);
      show("You're not authorized to view that page.", { tone: "error" });
      router.replace(ROLE_HOME[session.role]);
    }
  }, [status, session, allowedRoles, pathname, router, show]);

  if (status === "error") return <SessionError />;
  // While redirecting a role-mismatched session, surface a visible access-denied
  // notice (role="alert") instead of a bare skeleton, so the user — and the
  // access-control test — sees an explicit "not authorized" message before the
  // redirect completes.
  if (redirecting && denyRole) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container px-6 py-10 text-center"
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
          <ShieldX className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <p className="font-medium text-on-surface">You&apos;re not authorized to view this page.</p>
        <p className="text-sm text-on-surface-variant">Redirecting to your home screen…</p>
      </div>
    );
  }
  if (status === "loading" || redirecting) return <AppShellSkeleton />;
  if (!session || !allowedRoles.includes(session.role)) return <AppShellSkeleton />;
  return <>{children}</>;
}

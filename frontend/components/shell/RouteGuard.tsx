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
 * - `allowedRoles` null/undefined → public route: renders children untouched,
 *   no session check, no redirect (used by the invite-acceptance page #36).
 * - loading → skeleton
 * - session-store failure → explicit error state (never an infinite skeleton)
 * - unauthenticated → redirect to /login?next=<path>
 * - authenticated with `roles: []` (or primaryRole not in roles) → treated as
 *   an invalid session and bounced to /login (#45 negative AC: never silently
 *   let through, and never infinite-loop on the primaryRole home)
 * - authenticated but no held role matches `allowedRoles` → render a
 *   "not authorized" alert, then redirect to `ROLE_HOME[primaryRole]` with a
 *   toast (never a blank/broken page)
 * - authenticated + at least one held role matches → render children
 */
export function RouteGuard({
  allowedRoles,
  children,
}: {
  allowedRoles?: Role[] | null;
  children: React.ReactNode;
}) {
  const { status, session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const { show } = useSnackbar();
  const [redirecting, setRedirecting] = React.useState(false);
  const [denyRole, setDenyRole] = React.useState(false);
  const redirected = React.useRef(false);

  const isPublic = allowedRoles == null;

  // A session is structurally invalid if it has no roles at all, or its
  // primaryRole isn't listed (the invariant the rest of the app relies on).
  // Such a session can never satisfy any allow-list, so we bounce to /login
  // instead of redirecting to a home that would just re-deny (infinite loop).
  const sessionInvalid =
    !!session &&
    (session.roles.length === 0 || !session.roles.includes(session.primaryRole));

  const allowed =
    !!session &&
    !sessionInvalid &&
    !!allowedRoles &&
    allowedRoles.some((r) => session.roles.includes(r));

  React.useEffect(() => {
    if (isPublic || redirected.current) return;
    if (status === "loading" || status === "error") return;
    if (status === "unauthenticated") {
      redirected.current = true;
      setRedirecting(true);
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (session && sessionInvalid) {
      redirected.current = true;
      setRedirecting(true);
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (session && !allowed) {
      redirected.current = true;
      setDenyRole(true);
      setRedirecting(true);
      show("You're not authorized to view that page.", { tone: "error" });
      router.replace(ROLE_HOME[session.primaryRole]);
    }
  }, [status, session, sessionInvalid, allowed, allowedRoles, isPublic, pathname, router, show]);

  if (isPublic) return <>{children}</>;
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
  if (!session || !allowed) return <AppShellSkeleton />;
  return <>{children}</>;
}

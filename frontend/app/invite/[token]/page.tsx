"use client";

/* ============================================================================
 * SpendFlow — /invite/[token] (ticket #36, public route).
 *
 * The invitation email links here (`{frontendOrigin}/invite/{token}` per the
 * BE #38 email log). The invited user sets a password + confirm, and
 * `acceptInvite` activates their account and issues a real session cookie.
 *
 * On success the browser holds a fresh httpOnly session cookie, so the FE does
 * a full page load to the role's home (`/employee`, `/approver`, `/finance`)
 * — a hard navigation re-mounts SessionProvider, which re-reads `/api/me` with
 * the new cookie. A client-side `router.replace` would instead keep the stale
 * "unauthenticated" session state and bounce to /login.
 *
 * Panel states:
 *   - 404 `invite_invalid` / 410 `invite_expired` → "expired or invalid" panel
 *   - 410 `invite_consumed`                       → "already accepted" panel
 *   - any other load error                        → generic error panel
 *   - 200                                        → the activation form
 * ========================================================================== */

import * as React from "react";
import { useParams } from "next/navigation";
import {
  Wallet,
  KeyRound,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldX,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { ROLE_LABEL, ROLE_HOME } from "@/lib/auth/session";
import {
  acceptInvite,
  getInvite,
  UsersApiError,
  type InviteDetails,
} from "@/lib/api/users";

type InviteView =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "consumed" }
  | { status: "error"; message: string }
  | { status: "ready"; details: InviteDetails };

export default function AcceptInvitePage() {
  return (
    <RouteGuard>
      <React.Suspense fallback={null}>
        <AcceptInviteInner />
      </React.Suspense>
    </RouteGuard>
  );
}

function AcceptInviteInner() {
  const params = useParams<{ token?: string }>();
  const token = params?.token;

  const [view, setView] = React.useState<InviteView>({ status: "loading" });
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // No token in the URL → the email link was malformed; same expired panel.
  const tokenMissing = !token;

  React.useEffect(() => {
    if (tokenMissing) {
      setView({ status: "invalid" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const details = await getInvite(token!);
        if (!cancelled) setView({ status: "ready", details });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UsersApiError) {
          if (err.code === "invite_consumed") setView({ status: "consumed" });
          else if (err.code === "invite_expired" || err.code === "invite_invalid") {
            setView({ status: "invalid" });
          } else {
            setView({ status: "error", message: err.message });
          }
        } else {
          setView({
            status: "error",
            message:
              err instanceof Error
                ? err.message
                : "Could not load this invitation. Please try again.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tokenMissing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (view.status !== "ready") return;
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setFormError("Passwords do not match.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await acceptInvite(token!, password);
      // Hard navigation — see module header for why (fresh session cookie).
      window.location.assign(ROLE_HOME[view.details.role]);
    } catch (err) {
      if (err instanceof UsersApiError) {
        if (err.code === "invite_consumed") {
          setView({ status: "consumed" });
          return;
        }
        if (err.code === "invite_expired" || err.code === "invite_invalid") {
          setView({ status: "invalid" });
          return;
        }
        // e.g. 400 `invalid_password` — the BE enforces the real policy.
        setFormError(err.message);
      } else {
        setFormError(
          err instanceof Error
            ? err.message
            : "Could not activate your account. Check your connection and try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Wallet className="h-5 w-5" strokeWidth={2} aria-hidden />
          </span>
          <span className="text-lg font-semibold text-on-surface">SpendFlow</span>
        </div>
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-6 pb-10">
        <div className="w-full max-w-md">
          {view.status === "loading" && (
            <div
              role="status"
              aria-busy="true"
              aria-label="Checking your invitation"
              className="rounded-3xl border border-outline-variant bg-surface-container p-8 text-center"
            >
              <span className="inline-flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-primary/10 text-primary">
                <KeyRound className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </span>
              <p className="mt-4 text-sm text-on-surface-variant">
                Checking your invitation…
              </p>
            </div>
          )}

          {view.status === "invalid" && <ExpiredPanel />}
          {view.status === "consumed" && <ConsumedPanel />}
          {view.status === "error" && (
            <ErrorPanel message={view.message} />
          )}

          {view.status === "ready" && (
            <div className="rounded-3xl border border-outline-variant bg-surface-container p-8">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <KeyRound className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                </span>
                <div>
                  <h1 className="text-xl font-semibold text-on-surface">
                    Activate your account
                  </h1>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Set a password to start using SpendFlow.
                  </p>
                </div>
              </div>

              {/* Read-only invitee identity + assigned role (#36). */}
              <div className="mt-6 space-y-2.5 rounded-2xl bg-surface-container-high px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-on-surface-variant">Name</span>
                  <span className="truncate font-medium text-on-surface">
                    {view.details.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-on-surface-variant">Email</span>
                  <span className="truncate text-sm text-on-surface">
                    {view.details.email}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-on-surface-variant">Role</span>
                  <span className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                    {ROLE_LABEL[view.details.role]}
                  </span>
                </div>
              </div>

              <p className="mt-4 text-sm text-on-surface-variant">
                You&apos;ve been invited as{" "}
                <span className="font-medium text-on-surface">
                  {ROLE_LABEL[view.details.role]}
                </span>
                . Set a password to activate your account.
              </p>

              <form className="mt-6 space-y-4" onSubmit={handleSubmit} aria-label="Activate account">
                {formError && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="flex items-start gap-2 rounded-xl bg-error-container px-3.5 py-2.5 text-sm text-error-container-foreground"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span>{formError}</span>
                  </div>
                )}
                <TextField
                  label="New password"
                  type="password"
                  iconLeft={KeyRound}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  helper="At least 8 characters."
                  autoComplete="new-password"
                  required
                />
                <TextField
                  label="Confirm password"
                  type="password"
                  iconLeft={KeyRound}
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  autoComplete="new-password"
                  required
                />
                <Button type="submit" fullWidth loading={submitting}>
                  {submitting ? "Activating…" : "Activate my account"}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- panels == */

function ExpiredPanel() {
  return (
    <Panel
      icon={<Clock className="h-6 w-6" strokeWidth={1.75} aria-hidden />}
      tone="neutral"
      title="Invitation expired or invalid"
      body="This invitation link is no longer valid. Ask your Finance Admin to send a new invitation."
    />
  );
}

function ConsumedPanel() {
  return (
    <Panel
      icon={<CheckCircle2 className="h-6 w-6" strokeWidth={1.75} aria-hidden />}
      tone="neutral"
      title="Already accepted"
      body="This invitation has already been used. Sign in with the password you set."
    />
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <Panel
      icon={<ShieldX className="h-6 w-6" strokeWidth={1.75} aria-hidden />}
      tone="error"
      title="Couldn't load this invitation"
      body={message}
    />
  );
}

function Panel({
  icon,
  tone,
  title,
  body,
}: {
  icon: React.ReactNode;
  tone: "neutral" | "error";
  title: string;
  body: string;
}) {
  const toneClass =
    tone === "error"
      ? "bg-error-container text-error-container-foreground"
      : "bg-surface-container-high text-on-surface-variant";
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-3xl border border-outline-variant bg-surface-container px-6 py-10 text-center"
    >
      <span
        className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${toneClass}`}
      >
        {icon}
      </span>
      <div>
        <p className="font-medium text-on-surface">{title}</p>
        <p className="mt-1 text-sm text-on-surface-variant">{body}</p>
      </div>
    </div>
  );
}

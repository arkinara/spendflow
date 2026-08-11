"use client";

/* ============================================================================
 * SpendFlow — /reset-password/[token] (ticket #69, public route).
 *
 * The reset email links here (`{feUrl}/reset-password/{token}` per the BE
 * `requestReset`). The token is validated only when the form is submitted —
 * the page never shows the reset form on a dead token, but a miss still costs
 * the caller nothing until they actually try to set a password.
 *
 * Panel states:
 *   - no token in the URL / 401 `invalid_token` → "invalid or expired" panel
 *   - 410 `already_used`                          → "already used" panel
 *   - 200                                        → reset form
 *   - 422 `weak_password` / other API error      → inline form error
 *
 * On success the password has changed server-side but no session was created
 * (Better Auth's cookie is untouched), so a client-side `router.push("/login")`
 * is safe — unlike the invite flow there is no fresh session cookie to remount.
 * ========================================================================== */

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Wallet,
  KeyRound,
  Clock,
  CheckCircle2,
  ShieldX,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { useSnackbar } from "@/components/ui/Snackbar";
import { resetPassword, AuthApiError } from "@/lib/api/auth";

type ResetView =
  | { status: "form" }
  | { status: "invalid" }
  | { status: "used" };

export default function ResetPasswordPage() {
  return (
    <RouteGuard>
      <React.Suspense fallback={null}>
        <ResetPasswordInner />
      </React.Suspense>
    </RouteGuard>
  );
}

function ResetPasswordInner() {
  const params = useParams<{ token?: string }>();
  const router = useRouter();
  const { show } = useSnackbar();
  const token = params?.token;

  const [view, setView] = React.useState<ResetView>({
    status: token ? "form" : "invalid",
  });
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (view.status !== "form") return;
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
      await resetPassword(token!, password);
      show("Password reset. Please sign in with your new password.", {
        tone: "success",
      });
      router.push("/login");
    } catch (err) {
      if (err instanceof AuthApiError) {
        if (err.code === "invalid_token") {
          setView({ status: "invalid" });
          return;
        }
        if (err.code === "already_used") {
          setView({ status: "used" });
          return;
        }
        setFormError(err.message);
      } else {
        setFormError(
          err instanceof Error
            ? err.message
            : "Could not reset your password. Check your connection and try again.",
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
          {view.status === "invalid" && <InvalidPanel />}
          {view.status === "used" && <UsedPanel />}

          {view.status === "form" && (
            <div className="rounded-3xl border border-outline-variant bg-surface-container p-8">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <KeyRound className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                </span>
                <div>
                  <h1 className="text-xl font-semibold text-on-surface">
                    Set a new password
                  </h1>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Choose a new password for your SpendFlow account.
                  </p>
                </div>
              </div>

              <form className="mt-6 space-y-4" onSubmit={handleSubmit} aria-label="Reset password">
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
                  label="Confirm new password"
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
                  {submitting ? "Resetting…" : "Reset password"}
                </Button>
              </form>

              <Link
                href="/login"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- panels == */

function InvalidPanel() {
  return (
    <Panel
      icon={<Clock className="h-6 w-6" strokeWidth={1.75} aria-hidden />}
      tone="error"
      title="Invalid or expired reset link"
      body="This reset link is invalid or has expired. Request a new one."
    />
  );
}

function UsedPanel() {
  return (
    <Panel
      icon={<CheckCircle2 className="h-6 w-6" strokeWidth={1.75} aria-hidden />}
      tone="neutral"
      title="Reset link already used"
      body="This reset link has already been used. Request a new one if you still need to reset your password."
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
      <Link
        href="/login"
        className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        Back to sign in
      </Link>
    </div>
  );
}

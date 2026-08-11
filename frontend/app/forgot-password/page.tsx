"use client";

/* ============================================================================
 * SpendFlow — /forgot-password (ticket #69, public route).
 *
 * Entry point for the password-reset flow. Submits an email to
 * `POST /api/auth/forgot-password`; the response envelope is identical for
 * known and unknown addresses (no user enumeration), so on any success the
 * page shows the neutral "if an account exists" copy.
 *
 * The one distinguishable failure is a 429 `rate_limited` (5 requests / IP /
 * hour on the BE) — surfaced inline with the backend's retry window.
 * ========================================================================== */

import * as React from "react";
import Link from "next/link";
import {
  Wallet,
  Mail,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { forgotPassword, AuthApiError } from "@/lib/api/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  return (
    <RouteGuard>
      <React.Suspense fallback={null}>
        <ForgotPasswordInner />
      </React.Suspense>
    </RouteGuard>
  );
}

function ForgotPasswordInner() {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = email.trim();
    if (!EMAIL_RE.test(normalized)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(normalized);
      setSent(true);
    } catch (err) {
      if (err instanceof AuthApiError && err.code === "rate_limited") {
        const secs = err.retryAfterSeconds;
        setError(
          secs != null
            ? `Too many requests. Try again in ${secs}s.`
            : "Too many requests. Please try again later.",
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
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
          {sent ? (
            <div
              role="alert"
              className="flex flex-col items-center gap-3 rounded-3xl border border-outline-variant bg-surface-container px-6 py-10 text-center"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <CheckCircle2 className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <p className="font-medium text-on-surface">Check your inbox</p>
                <p className="mt-1 text-sm text-on-surface-variant">
                  If an account exists for {email.trim()}, a reset link was sent.
                </p>
              </div>
              <Link
                href="/login"
                className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                Back to sign in
              </Link>
            </div>
          ) : (
            <div className="rounded-3xl border border-outline-variant bg-surface-container p-8">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Mail className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                </span>
                <div>
                  <h1 className="text-xl font-semibold text-on-surface">
                    Reset your password
                  </h1>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Enter your work email and we&apos;ll send you a reset link.
                  </p>
                </div>
              </div>

              <form className="mt-6 space-y-4" onSubmit={handleSubmit} aria-label="Request password reset">
                {error && (
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
                    <span>{error}</span>
                  </div>
                )}
                <TextField
                  label="Work email"
                  type="text"
                  inputMode="email"
                  iconLeft={Mail}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  autoComplete="email"
                  required
                />
                <Button type="submit" fullWidth loading={submitting}>
                  {submitting ? "Sending…" : "Send reset link"}
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

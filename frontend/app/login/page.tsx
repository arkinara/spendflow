"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Wallet, Mail, Lock, ArrowRight, User, ShieldCheck, Banknote, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import {
  useSession,
  ROLE_HOME,
  DEMO_CREDENTIALS,
} from "@/lib/auth/session";
import { CURRENT_USER_BY_ROLE } from "@/lib/fixtures";
import { getUser } from "@/lib/seed-data";
import type { Role } from "@/lib/types";

const PRESETS: { role: Role; label: string; icon: typeof User }[] = [
  { role: "employee", label: "Sign in as Employee", icon: User },
  { role: "approver", label: "Sign in as Approver", icon: ShieldCheck },
  { role: "finance", label: "Sign in as Finance", icon: Banknote },
];

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useSession();
  const devPresets = process.env.NEXT_PUBLIC_SPENDFLOW_DEV_PRESETS === "1";

  const [email, setEmail] = React.useState("aulia.pratiwi@spendflow.example");
  const [password, setPassword] = React.useState("demo1234");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // NOTE: /login deliberately does NOT auto-redirect an already-authenticated
  // visitor. A leftover httpOnly session cookie would otherwise silently punt
  // them into a dashboard the moment they clicked "Sign in" on the landing
  // page — they could never reach the credential form to sign in as someone
  // else. The form always renders; a successful sign-in replaces any existing
  // session server-side.

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn(email, password);
    if (result.ok) {
      // Honour the `next` target RouteGuard/401 handler attached, but never
      // bounce back to "/" (the landing page that sent us here).
      const next = searchParams.get("next");
      router.push(next && next !== "/" ? next : ROLE_HOME[result.role]);
    } else {
      setError(result.error);
      setSubmitting(false);
    }
  }

  // Dev-only presets pre-fill the form with the seeded persona's real
  // credentials; authentication still runs the real email+password path.
  function fillPreset(role: Role) {
    const cred = DEMO_CREDENTIALS.find((c) => c.role === role);
    if (!cred) return;
    setError(null);
    setEmail(cred.email);
    setPassword(cred.password);
  }

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Brand panel */}
      <div className="relative hidden flex-1 flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary-foreground/15">
            <Wallet className="h-5 w-5" strokeWidth={2} aria-hidden />
          </span>
          <span className="text-lg font-semibold">SpendFlow</span>
        </div>
        <div>
          <h2 className="text-3xl font-bold leading-tight">
            From receipt to reimbursement in one flow.
          </h2>
          <p className="mt-3 max-w-md text-primary-foreground/80">
            Submit a complete travel claim with receipts in under two minutes. Approvals and
            finance handled in the same place.
          </p>
        </div>
        <p className="text-sm text-primary-foreground/70">Phase 1 prototype · live auth, demo data</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col">
        <div className="flex h-16 items-center justify-between px-6 lg:justify-end">
          <div className="flex items-center gap-2.5 lg:hidden">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Wallet className="h-5 w-5" strokeWidth={2} aria-hidden />
            </span>
            <span className="text-lg font-semibold text-on-surface">SpendFlow</span>
          </div>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-10">
          <div className="w-full max-w-md">
            <h1 className="text-2xl font-bold text-on-surface">Welcome back</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              Sign in to continue to your SpendFlow workspace.
            </p>

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="mt-4 flex items-start gap-2 rounded-xl border border-error/40 bg-error-container/50 px-3.5 py-2.5 text-sm text-on-surface"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" strokeWidth={1.75} aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <form className="mt-6 space-y-4" onSubmit={handleSubmit} aria-label="Sign in">
              <TextField
                label="Work email"
                type="email"
                iconLeft={Mail}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                autoComplete="email"
                required
              />
              <TextField
                label="Password"
                type="password"
                iconLeft={Lock}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                helper="Demo password is demo1234."
                autoComplete="current-password"
                required
              />
              <Button type="submit" fullWidth iconRight={ArrowRight} loading={submitting}>
                Sign in
              </Button>
            </form>

            {devPresets && (
              <>
                <div className="my-6 flex items-center gap-4">
                  <span className="h-px flex-1 bg-outline-variant" />
                  <span className="text-xs font-medium text-on-surface-variant">
                    OR PICK A DEMO ROLE
                  </span>
                  <span className="h-px flex-1 bg-outline-variant" />
                </div>

                <p className="mb-3 text-xs text-warning">
                  Dev only — presets pre-fill demo credentials. Production never
                  shows this.
                </p>

                <div className="space-y-2.5">
                  {PRESETS.map((p) => {
                    const u = getUser(CURRENT_USER_BY_ROLE[p.role])!;
                    return (
                      <button
                        key={p.role}
                        type="button"
                        onClick={() => fillPreset(p.role)}
                        aria-label={`${p.label} — pre-fill demo credentials for ${u.name}`}
                        className="flex w-full items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-left transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <p.icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                        </span>
                        <span className="flex-1">
                          <span className="block text-sm font-medium text-on-surface">{p.label}</span>
                          <span className="block text-xs text-on-surface-variant">
                            {u.name} · {u.jobTitle}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 text-on-surface-variant" strokeWidth={1.75} aria-hidden />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

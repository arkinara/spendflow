"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Wallet, Mail, Lock, ArrowRight, User, ShieldCheck, Banknote } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useRole } from "@/components/shell/RoleSwitcher";
import { CURRENT_USER_BY_ROLE, getUser, type Role } from "@/lib/mock/mock_data";

const PRESETS: { role: Role; label: string; icon: typeof User }[] = [
  { role: "employee", label: "Sign in as Employee", icon: User },
  { role: "approver", label: "Sign in as Approver", icon: ShieldCheck },
  { role: "finance", label: "Sign in as Finance", icon: Banknote },
];

const ROLE_HOME: Record<Role, string> = {
  employee: "/employee",
  approver: "/approver",
  finance: "/finance",
};

export default function LoginPage() {
  const router = useRouter();
  const { setRole } = useRole();
  const [email, setEmail] = React.useState("aulia.pratiwi@spendflow.example");
  const [password, setPassword] = React.useState("demo1234");

  function signIn(role: Role) {
    setRole(role);
    router.push(ROLE_HOME[role]);
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
        <p className="text-sm text-primary-foreground/70">Phase 1 prototype · mock data only</p>
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

            <form
              className="mt-8 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                signIn("employee");
              }}
            >
              <TextField
                label="Work email"
                type="email"
                iconLeft={Mail}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <TextField
                label="Password"
                type="password"
                iconLeft={Lock}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helper="Any value works — this is a mock login."
                required
              />
              <Button type="submit" fullWidth iconRight={ArrowRight}>
                Sign in
              </Button>
            </form>

            <div className="my-6 flex items-center gap-4">
              <span className="h-px flex-1 bg-outline-variant" />
              <span className="text-xs font-medium text-on-surface-variant">
                OR PICK A DEMO ROLE
              </span>
              <span className="h-px flex-1 bg-outline-variant" />
            </div>

            <div className="space-y-2.5">
              {PRESETS.map((p) => {
                const u = getUser(CURRENT_USER_BY_ROLE[p.role])!;
                return (
                  <button
                    key={p.role}
                    type="button"
                    onClick={() => signIn(p.role)}
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
          </div>
        </div>
      </div>
    </div>
  );
}

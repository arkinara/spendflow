"use client";

import Link from "next/link";
import {
  Wallet,
  ArrowRight,
  User,
  ShieldCheck,
  Banknote,
  Clock,
  ReceiptText,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import type { Role } from "@/lib/types";

const ROLES: {
  role: Role;
  href: string;
  name: string;
  person: string;
  icon: typeof User;
  blurb: string;
}[] = [
  {
    role: "employee",
    href: "/employee",
    name: "Employee",
    person: "Aulia Pratiwi · Operations",
    icon: User,
    blurb: "Submit travel claims with receipts, track status, and get reimbursed.",
  },
  {
    role: "approver",
    href: "/approver",
    name: "Manager / Approver",
    person: "Dewi Anggraeni · Operations",
    icon: ShieldCheck,
    blurb: "Review your team's claims, request changes, and approve in one place.",
  },
  {
    role: "finance",
    href: "/finance",
    name: "Finance Admin",
    person: "Ridwan Saputra · Finance",
    icon: Banknote,
    blurb: "Resolve exceptions, run payments, and administer policy.",
  },
];

const HIGHLIGHTS = [
  { icon: Clock, label: "Submit in under 2 minutes" },
  { icon: ReceiptText, label: "Manual receipt upload" },
  { icon: CheckCircle2, label: "Clear approval trail" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Wallet className="h-5 w-5" strokeWidth={2} aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight text-on-surface">SpendFlow</span>
        </div>
        <div className="flex items-center gap-2">
          <Button href="/login" variant="text" size="sm">
            Sign in
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="px-4 pb-16 pt-8 sm:px-8">
        <section className="mx-0 max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Wallet className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Spend management · Phase 1 prototype
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-on-surface sm:text-5xl">
            Travel expenses,
            <br />
            reimbursed without the friction.
          </h1>
          <p className="mt-4 text-lg text-on-surface-variant">
            SpendFlow takes a travel claim from receipt to payment — submission, approval, and
            finance, all in one flow. Pick a role below to explore the prototype.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            {HIGHLIGHTS.map((h) => (
              <span key={h.label} className="inline-flex items-center gap-2 text-sm text-on-surface-variant">
                <h.icon className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden />
                {h.label}
              </span>
            ))}
          </div>
        </section>

        <section className="mt-12" aria-label="Choose a role">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant">
            Explore as
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {ROLES.map((r) => (
              <Link
                key={r.role}
                href={r.href}
                className="group flex flex-col rounded-2xl border border-outline-variant bg-surface-container-low p-6 shadow-sm transition-colors duration-200 ease-m3 hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <r.icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-on-surface">{r.name}</h3>
                <p className="text-xs text-on-surface-variant">{r.person}</p>
                <p className="mt-3 flex-1 text-sm text-on-surface-variant">{r.blurb}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Open dashboard
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

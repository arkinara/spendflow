"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  History,
  AlertTriangle,
  FileText,
  ShieldCheck,
  RefreshCw,
  Ban,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { StatusChip } from "@/components/ui/StatusChip";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useClaimAudit } from "@/lib/mock/useClaimAudit";
import type { BackendAuditEntry } from "@/lib/api/audit";
import { getClaim } from "@/lib/api/claims";
import { getUserName, claimDetailRoute, type Claim } from "@/lib/mock/mock_data";
import { formatDateTime } from "@/lib/format";

const ACTION_LABEL: Record<string, string> = {
  created: "Claim created",
  submitted: "Submitted for approval",
  approved: "Approved",
  rejected: "Rejected",
  returned: "Returned for changes",
  resubmitted: "Resubmitted",
  withdrawn: "Withdrawn",
  processing: "Payment processing",
  paid: "Payment disbursed",
  commented: "Comment added",
};

/** Normalise a BE audit `action` string into a stable label/detail key. */
function auditKey(action: string): string {
  const lower = action.toLowerCase();
  for (const key of [
    "resubmitted",
    "submitted",
    "withdrawn",
    "approved",
    "rejected",
    "returned",
    "processing",
    "paid",
    "created",
    "attachment.upload",
    "attachment.delete",
  ]) {
    if (lower.includes(key)) {
      if (key === "attachment.upload") return "created";
      if (key === "attachment.delete") return "withdrawn";
      return key;
    }
  }
  return "default";
}

function prettifyAction(action: string): string {
  return action
    .replace(/^[a-z]+\./, "")
    .replace(/[_.]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function isRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Human-readable body text for an audit entry: the status transition when present, else a generic note. */
function describeEntry(entry: BackendAuditEntry): string {
  const after = isRecord(entry.after);
  const before = isRecord(entry.before);
  if (after && typeof after.status === "string") {
    return before && typeof before.status === "string"
      ? `Status changed from ${before.status} to ${after.status}.`
      : `Status set to ${after.status}.`;
  }
  return `${prettifyAction(entry.action)} recorded on this claim.`;
}

export default function AuditTrailPage() {
  const params = useParams<{ id: string }>();
  const { role, user } = useRole();
  const { state, reload } = useClaimAudit(params.id);
  const [claim, setClaim] = React.useState<Claim | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    setClaim(undefined);
    void getClaim(params.id)
      .then((c) => {
        if (!cancelled) setClaim(c);
      })
      .catch(() => {
        // best-effort header only — the viewer's access decision below
        // doesn't depend on this fetch
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (state.status === "notfound") {
    return (
      <AppShell>
        <EmptyState
          icon={AlertTriangle}
          title="Claim not found"
          body="This claim may have been removed or the link is incorrect."
          action={
            <Button href="/employee/claims" icon={ArrowLeft}>
              Back
            </Button>
          }
        />
      </AppShell>
    );
  }

  // Permission: the audit viewer is a Finance Admin-only surface — stricter
  // than the BE's participant gate on `/audit` (which also allows the
  // submitter and approvers). Non-finance sessions are always blocked here,
  // never a blank page or a silent redirect.
  if (user.role !== "finance") {
    return (
      <AppShell>
        <EmptyState
          icon={Ban}
          title="Access denied"
          body="The audit trail is only available to Finance Admin sessions."
          action={
            <Button href={claimDetailRoute(role, params.id)} icon={ArrowLeft}>
              Back to claim
            </Button>
          }
        />
      </AppShell>
    );
  }

  // Non-finance-admin participants never reach here, so a `denied` state at
  // this point means the BE itself rejected the request (e.g. cross-tenant).
  if (state.status === "denied") {
    return (
      <AppShell>
        <EmptyState
          icon={Ban}
          title="Access denied"
          body="You do not have access to this claim's audit trail."
          action={
            <Button href="/finance" icon={ArrowLeft}>
              Back to dashboard
            </Button>
          }
        />
      </AppShell>
    );
  }

  const backHref = role === "finance" ? "/finance" : claimDetailRoute(role, params.id);

  const timeline: TimelineEntry[] = state.items.map((e) => {
    const key = auditKey(e.action);
    return {
      id: e.id,
      title: ACTION_LABEL[key] ?? prettifyAction(e.action),
      actor: getUserName(e.actorId),
      timestamp: formatDateTime(e.createdAt),
      body: describeEntry(e),
      icon: <Avatar name={getUserName(e.actorId)} size="xs" color="secondary" />,
    };
  });

  return (
    <AppShell>
      <div className="mx-0 max-w-3xl space-y-5">
        <Button href={backHref} variant="text" size="sm" icon={ArrowLeft}>
          {role === "finance" ? "Back to dashboard" : "Back to claim"}
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <History className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-on-surface">Audit trail</h1>
              <p className="text-sm text-on-surface-variant">
                {claim ? `${claim.title} · ${claim.reference}` : `Claim ${params.id}`}
              </p>
            </div>
          </div>
          {claim && <StatusChip status={claim.status} />}
        </div>

        <Card className="flex items-center gap-3 border-info/30 bg-info-container/30">
          <ShieldCheck className="h-5 w-5 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
          <p className="text-sm text-on-surface-variant">
            This is an immutable, append-only log of every action taken on the claim, in chronological order.
          </p>
        </Card>

        <Card title="Activity" subtitle={`${state.items.length} recorded event${state.items.length === 1 ? "" : "s"}`}>
          {state.status === "loading" ? (
            <AuditSkeleton />
          ) : state.status === "error" ? (
            <div
              role="alert"
              className="flex flex-col items-center gap-4 px-4 py-10 text-center sm:flex-row sm:text-left"
            >
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
                <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-on-surface">
                  Couldn&rsquo;t load the audit trail
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {state.message || "Something went wrong."} Try again.
                </p>
              </div>
              <Button variant="outlined" icon={RefreshCw} onClick={reload}>
                Retry
              </Button>
            </div>
          ) : state.items.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No audit entries"
              body="Actions on this claim will be recorded here."
              variant="compact"
            />
          ) : (
            <Timeline entries={timeline} />
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function AuditSkeleton() {
  return (
    <div aria-busy="true" role="status" aria-label="Loading audit trail" className="space-y-4">
      <Skeleton variant="list" lines={3} />
    </div>
  );
}

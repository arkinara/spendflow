"use client";

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
import {
  getClaim,
  getUser,
  claimDetailRoute,
  type AuditEntry,
} from "@/lib/mock/mock_data";
import { formatDateTime } from "@/lib/format";

export default function AuditTrailPage() {
  const params = useParams<{ id: string }>();
  const { role, user } = useRole();
  const claim = getClaim(params.id);
  const { state, reload } = useClaimAudit(params.id);

  if (!claim) {
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

  // Permission (ticket #8 negative AC): the audit viewer is scoped to
  // Finance Admin mock sessions. Non-finance sessions are blocked with an
  // explicit access-denied message — never a blank page or a silent redirect.
  if (user.role !== "finance") {
    return (
      <AppShell>
        <EmptyState
          icon={Ban}
          title="Access denied"
          body="The audit trail is only available to Finance Admin sessions."
          action={
            <Button href={claimDetailRoute(role, claim.id)} icon={ArrowLeft}>
              Back to claim
            </Button>
          }
        />
      </AppShell>
    );
  }

  const backHref = role === "finance" ? "/finance" : claimDetailRoute(role, claim.id);

  const timeline: TimelineEntry[] = state.items.map((e: AuditEntry) => {
    const actor = getUser(e.actorId);
    return {
      id: e.id,
      title: e.action,
      actor: actor ? `${actor.name} · ${actor.jobTitle}` : e.actorId,
      timestamp: formatDateTime(e.at),
      body: e.detail,
      icon: (
        <Avatar
          name={actor?.name ?? "System"}
          size="xs"
          color={(actor?.avatarColor as never) ?? "secondary"}
        />
      ),
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
                {claim.title} · {claim.reference}
              </p>
            </div>
          </div>
          <StatusChip status={claim.status} />
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

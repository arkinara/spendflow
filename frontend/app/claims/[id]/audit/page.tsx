"use client";

import { useParams } from "next/navigation";
import {
  ArrowLeft,
  History,
  AlertTriangle,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { StatusChip } from "@/components/ui/StatusChip";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getClaim,
  getUser,
  auditForClaim,
} from "@/lib/mock/mock_data";
import { formatDateTime } from "@/lib/format";

export default function AuditTrailPage() {
  const params = useParams<{ id: string }>();
  const claim = getClaim(params.id);

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

  const entries = auditForClaim(claim.id);
  const timeline: TimelineEntry[] = entries.map((e) => {
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
        <Button href={`/employee/claims/${claim.id}`} variant="text" size="sm" icon={ArrowLeft}>
          Back to claim
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
            This is an immutable log of every action taken on the claim, in chronological order.
          </p>
        </Card>

        <Card title="Activity" subtitle={`${entries.length} recorded events`}>
          {entries.length === 0 ? (
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

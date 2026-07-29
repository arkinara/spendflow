"use client";

import * as React from "react";
import {
  Inbox,
  Hourglass,
  CheckCircle2,
  Wallet,
  ArrowRight,
  Users,
  ClipboardCheck,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { ListItem } from "@/components/ui/ListItem";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import {
  claims,
  claimsForApprover,
  computeClaimTotal,
  getUser,
  type Claim,
} from "@/lib/mock/mock_data";
import { formatCurrency, formatCurrencyCompact, formatRelativeTime } from "@/lib/format";

export default function ApproverDashboard() {
  const inbox = claimsForApprover().sort((a, b) =>
    (a.submittedAt ?? a.createdAt).localeCompare(b.submittedAt ?? b.createdAt)
  );
  const teamClaims = claims; // manager sees all team claims
  const approvedThisPeriod = teamClaims.filter((c) =>
    ["approved", "processing", "paid"].includes(c.status)
  );
  const pendingAmount = inbox.reduce((s, c) => s + computeClaimTotal(c), 0);
  const approvedAmount = approvedThisPeriod.reduce((s, c) => s + computeClaimTotal(c), 0);
  const uniquePeople = new Set(teamClaims.map((c) => c.employeeId)).size;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Approvals</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Review and decide on claims submitted by your team.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Awaiting your review"
            value={String(inbox.length)}
            icon={Inbox}
            hint="In your inbox"
          />
          <MetricCard
            label="Pending value"
            value={formatCurrencyCompact(pendingAmount)}
            icon={Hourglass}
            hint="Across pending claims"
          />
          <MetricCard
            label="Approved"
            value={formatCurrencyCompact(approvedAmount)}
            icon={CheckCircle2}
            hint={`${approvedThisPeriod.length} claims this period`}
          />
          <MetricCard
            label="Team members"
            value={String(uniquePeople)}
            icon={Users}
            hint="Reporting to you"
          />
        </div>

        <Card
          title="Inbox"
          subtitle={`${inbox.length} claim${inbox.length === 1 ? "" : "s"} awaiting a decision`}
          padded={false}
        >
          {inbox.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Inbox zero"
              body="Every claim submitted to you has been reviewed. Nice work."
            />
          ) : (
            <ul className="divide-y divide-outline-variant px-2 pb-2">
              {inbox.map((c) => (
                <ApproverInboxRow key={c.id} claim={c} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function ApproverInboxRow({ claim }: { claim: Claim }) {
  const employee = getUser(claim.employeeId);
  const total = computeClaimTotal(claim);
  return (
    <li>
      <ListItem
        href={`/approver/claims/${claim.id}`}
        leading={
          <Avatar
            name={employee?.name ?? "Unknown"}
            color={(employee?.avatarColor as never) ?? "primary"}
          />
        }
        title={claim.title}
        subtitle={`${employee?.name ?? "Unknown"} · ${claim.reference} · ${claim.lineItems.length} items`}
        meta={
          <div className="space-y-1">
            <p className="text-sm font-semibold text-on-surface">{formatCurrency(total)}</p>
            <p>{formatRelativeTime(claim.submittedAt ?? claim.createdAt)}</p>
          </div>
        }
        trailing={
          <div className="hidden items-center gap-2 sm:flex">
            {claim.exception && claim.exception.status === "open" && (
              <StatusChip status="action_required" size="sm" />
            )}
            <Button
              href={`/approver/claims/${claim.id}`}
              variant="tonal"
              size="sm"
              iconRight={ArrowRight}
            >
              Review
            </Button>
          </div>
        }
      />
    </li>
  );
}

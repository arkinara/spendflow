"use client";

import * as React from "react";
import { Plus, Search, ReceiptText, FilterX } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/TextField";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { StatusChip } from "@/components/ui/StatusChip";
import { ListItem } from "@/components/ui/ListItem";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  claimsForEmployee,
  computeClaimTotal,
  type Claim,
  type ClaimStatus,
} from "@/lib/mock/mock_data";
import { formatCurrency, formatDate } from "@/lib/format";

type Filter = "all" | ClaimStatus;

export default function ClaimHistoryPage() {
  const { user } = useRole();
  const all = React.useMemo(
    () =>
      claimsForEmployee(user.id).sort((a, b) =>
        (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt)
      ),
    [user.id]
  );

  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const claim of all) c[claim.status] = (c[claim.status] ?? 0) + 1;
    return c;
  }, [all]);

  const filtered = all.filter((c) => {
    const matchStatus = filter === "all" || c.status === filter;
    const q = query.trim().toLowerCase();
    const matchQuery =
      !q ||
      c.title.toLowerCase().includes(q) ||
      c.reference.toLowerCase().includes(q) ||
      (c.destination ?? "").toLowerCase().includes(q);
    return matchStatus && matchQuery;
  });

  const options: { value: Filter; label: string; count?: number }[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "draft", label: "Draft", count: counts.draft },
    { value: "pending", label: "Pending", count: counts.pending },
    { value: "action_required", label: "Action Required", count: counts.action_required },
    { value: "approved", label: "Approved", count: counts.approved },
    { value: "paid", label: "Paid", count: counts.paid },
    { value: "rejected", label: "Rejected", count: counts.rejected },
  ];

  return (
    <AppShell
      action={
        <Button href="/employee/claims/new" icon={Plus} size="sm">
          New claim
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">My claims</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              {all.length} claims · {formatCurrency(all.reduce((s, c) => s + computeClaimTotal(c), 0))} total
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <TextField
            iconLeft={Search}
            placeholder="Search by title, reference or destination…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search claims"
          />
          <div className="overflow-x-auto pb-1">
            <SegmentedTabs
              options={options}
              value={filter}
              onChange={setFilter}
              ariaLabel="Filter claims by status"
            />
          </div>
        </div>

        <Card padded={false}>
          {filtered.length === 0 ? (
            query || filter !== "all" ? (
              <EmptyState
                icon={FilterX}
                title="No matching claims"
                body="No claims match your search and filter. Try clearing them."
                action={
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ReceiptText}
                title="No claims yet"
                body="Your submitted and draft claims will show up here."
                action={
                  <Button href="/employee/claims/new" icon={Plus}>
                    New claim
                  </Button>
                }
              />
            )
          ) : (
            <ul className="divide-y divide-outline-variant px-2 py-2">
              {filtered.map((c) => (
                <ClaimRow key={c.id} claim={c} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <li>
      <ListItem
        href={`/employee/claims/${claim.id}`}
        title={claim.title}
        subtitle={`${claim.reference} · ${claim.destination ?? "—"} · ${claim.lineItems.length} items`}
        meta={
          <div className="space-y-1">
            <p className="text-sm font-semibold text-on-surface">
              {formatCurrency(computeClaimTotal(claim))}
            </p>
            <p>{formatDate(claim.submittedAt ?? claim.createdAt)}</p>
          </div>
        }
        trailing={<StatusChip status={claim.status} />}
        showChevron
      />
    </li>
  );
}

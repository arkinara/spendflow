"use client";

import * as React from "react";
import {
  AlertTriangle,
  ShieldCheck,
  ReceiptText,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSnackbar } from "@/components/ui/Snackbar";
import {
  openExceptions,
  computeClaimTotal,
  getUser,
  type Claim,
  type ClaimException,
} from "@/lib/mock/mock_data";
import { formatCurrency, formatDate } from "@/lib/format";

const EXCEPTION_LABEL: Record<ClaimException["type"], string> = {
  missing_receipt: "Missing receipt",
  over_policy: "Over policy",
  duplicate: "Possible duplicate",
  late_submission: "Late submission",
};

const SEVERITY_TONE: Record<ClaimException["severity"], string> = {
  high: "bg-error-container text-error-container-foreground",
  medium: "bg-warning-container text-warning-container-foreground",
  low: "bg-info-container text-info-container-foreground",
};

const RESOLUTIONS = [
  { value: "waive", label: "Waive — accept as-is" },
  { value: "request_receipt", label: "Request receipt from employee" },
  { value: "return", label: "Return claim to approver" },
  { value: "reject", label: "Reject the flagged line" },
];

export default function ExceptionsPage() {
  const { show } = useSnackbar();
  const [resolved, setResolved] = React.useState<Set<string>>(new Set());
  const [active, setActive] = React.useState<Claim | null>(null);
  const [resolution, setResolution] = React.useState<string>();
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string>();

  const all = openExceptions();
  const rows = all.filter((c) => !resolved.has(c.id));

  function openResolve(claim: Claim) {
    setActive(claim);
    setResolution(undefined);
    setNote("");
    setError(undefined);
  }

  function confirmResolve() {
    if (!resolution) {
      setError("Choose how you want to resolve this exception.");
      return;
    }
    if (active) {
      setResolved((s) => new Set(s).add(active.id));
      show(`Exception on ${active.reference} resolved.`, { tone: "success" });
    }
    setActive(null);
  }

  const columns: Column<Claim>[] = [
    {
      key: "reference",
      header: "Claim",
      sortable: true,
      sortValue: (c) => c.reference,
      render: (c) => (
        <div>
          <p className="font-medium text-on-surface">{c.title}</p>
          <p className="text-xs text-on-surface-variant">{c.reference}</p>
        </div>
      ),
    },
    {
      key: "employee",
      header: "Employee",
      render: (c) => getUser(c.employeeId)?.name ?? "Unknown",
    },
    {
      key: "type",
      header: "Exception",
      sortable: true,
      sortValue: (c) => c.exception?.type ?? "",
      render: (c) =>
        c.exception ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              SEVERITY_TONE[c.exception.severity]
            }`}
          >
            <AlertTriangle className="h-3 w-3" strokeWidth={2} aria-hidden />
            {EXCEPTION_LABEL[c.exception.type]}
          </span>
        ) : null,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortable: true,
      sortValue: (c) => computeClaimTotal(c),
      render: (c) => (
        <span className="font-semibold text-on-surface">{formatCurrency(computeClaimTotal(c))}</span>
      ),
    },
    {
      key: "flagged",
      header: "Flagged",
      align: "right",
      sortable: true,
      sortValue: (c) => c.exception?.flaggedAt ?? "",
      render: (c) => (c.exception ? formatDate(c.exception.flaggedAt) : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => <StatusChip status={c.status} size="sm" />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (c) => (
        <div className="flex justify-end gap-1.5">
          <Button href={`/claims/${c.id}/audit`} variant="text" size="sm" iconRight={ExternalLink}>
            Open
          </Button>
          <Button size="sm" onClick={() => openResolve(c)}>
            Resolve
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Exception queue</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            {rows.length} open exception{rows.length === 1 ? "" : "s"} awaiting a decision.
          </p>
        </div>

        <Card padded={false}>
          <DataTable
            columns={columns}
            data={rows}
            rowKey={(c) => c.id}
            density="compact"
            caption="Open policy exceptions"
            empty={
              <EmptyState
                icon={ShieldCheck}
                title="All clear"
                body="No open exceptions. Flagged claims will appear here for review."
              />
            }
          />
        </Card>
      </div>

      <Dialog
        open={active !== null}
        onClose={() => setActive(null)}
        title="Resolve exception"
        description={active ? `${active.title} · ${active.reference}` : undefined}
        icon={
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-warning-container text-warning-container-foreground">
            <ReceiptText className="h-6 w-6" strokeWidth={1.75} aria-hidden />
          </span>
        }
        footer={
          <>
            <Button variant="text" onClick={() => setActive(null)}>
              Cancel
            </Button>
            <Button icon={CheckCircle2} onClick={confirmResolve}>
              Mark resolved
            </Button>
          </>
        }
      >
        {active?.exception && (
          <div className="mb-4 rounded-xl bg-surface-container px-4 py-3 text-sm text-on-surface">
            {active.exception.message}
          </div>
        )}
        <div className="space-y-4">
          <Select
            label="Resolution"
            required
            placeholder="Choose an action…"
            options={RESOLUTIONS}
            value={resolution}
            onChange={(v) => {
              setResolution(v);
              if (error) setError(undefined);
            }}
            error={error}
          />
          <TextArea
            label="Note (optional)"
            placeholder="Add context for the audit trail…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </Dialog>
    </AppShell>
  );
}

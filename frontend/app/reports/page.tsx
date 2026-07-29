"use client";

import * as React from "react";
import {
  Download,
  BarChart3,
  Wallet,
  ReceiptText,
  TrendingUp,
  FilterX,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSnackbar } from "@/components/ui/Snackbar";
import {
  claims,
  categories,
  computeClaimTotal,
  getCategory,
  getUser,
  type Claim,
  type ClaimStatus,
  type ExpenseCategoryId,
} from "@/lib/mock/mock_data";
import { formatCurrency, formatCurrencyCompact, formatDate } from "@/lib/format";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending Approval" },
  { value: "action_required", label: "Action Required" },
  { value: "approved", label: "Approved" },
  { value: "processing", label: "Processing" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
];

const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  ...categories.map((c) => ({ value: c.id, label: c.name })),
];

const PERIOD_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "2026-07", label: "July 2026" },
  { value: "2026-06", label: "June 2026" },
];

function categoryTotal(claim: Claim, categoryId: string): number {
  if (categoryId === "all") return computeClaimTotal(claim);
  return claim.lineItems
    .filter((l) => l.categoryId === categoryId)
    .reduce((s, l) => s + l.amount, 0);
}

export default function ReportsPage() {
  const { show } = useSnackbar();
  const [status, setStatus] = React.useState("all");
  const [category, setCategory] = React.useState("all");
  const [period, setPeriod] = React.useState("all");

  const filtered = claims.filter((c) => {
    const matchStatus = status === "all" || c.status === status;
    const matchCategory =
      category === "all" || c.lineItems.some((l) => l.categoryId === category);
    const stamp = (c.submittedAt ?? c.createdAt).slice(0, 7);
    const matchPeriod = period === "all" || stamp === period;
    return matchStatus && matchCategory && matchPeriod;
  });

  const totalValue = filtered.reduce((s, c) => s + categoryTotal(c, category), 0);
  const paidValue = filtered
    .filter((c) => c.status === "paid")
    .reduce((s, c) => s + categoryTotal(c, category), 0);
  const avgClaim = filtered.length ? totalValue / filtered.length : 0;

  // Category breakdown across the filtered set.
  const breakdown = categories
    .map((cat) => ({
      cat,
      total: filtered.reduce(
        (s, c) =>
          s +
          c.lineItems
            .filter((l) => l.categoryId === cat.id)
            .reduce((a, l) => a + l.amount, 0),
        0
      ),
    }))
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total);
  const breakdownMax = breakdown[0]?.total ?? 1;

  const filtersActive = status !== "all" || category !== "all" || period !== "all";

  function resetFilters() {
    setStatus("all");
    setCategory("all");
    setPeriod("all");
  }

  function exportCsv() {
    const header = [
      "Reference",
      "Title",
      "Employee",
      "Destination",
      "Status",
      "Submitted",
      "Line items",
      "Amount (IDR)",
    ];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = filtered.map((c) =>
      [
        c.reference,
        c.title,
        getUser(c.employeeId)?.name ?? "Unknown",
        c.destination ?? "",
        c.status,
        formatDate(c.submittedAt ?? c.createdAt),
        String(c.lineItems.length),
        String(categoryTotal(c, category)),
      ]
        .map(escape)
        .join(",")
    );
    const csv = [header.map(escape).join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spendflow-report-${period}-${status}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    show(`Exported ${filtered.length} claim${filtered.length === 1 ? "" : "s"} to CSV.`, {
      tone: "success",
    });
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
      sortable: true,
      sortValue: (c) => getUser(c.employeeId)?.name ?? "",
      render: (c) => getUser(c.employeeId)?.name ?? "Unknown",
    },
    {
      key: "destination",
      header: "Destination",
      render: (c) => c.destination ?? "—",
    },
    {
      key: "submitted",
      header: "Submitted",
      align: "right",
      sortable: true,
      sortValue: (c) => c.submittedAt ?? c.createdAt,
      render: (c) => formatDate(c.submittedAt ?? c.createdAt),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => <StatusChip status={c.status} size="sm" />,
    },
    {
      key: "amount",
      header: category === "all" ? "Total" : `${getCategory(category as ExpenseCategoryId)?.name ?? ""}`,
      align: "right",
      sortable: true,
      sortValue: (c) => categoryTotal(c, category),
      render: (c) => (
        <span className="font-semibold text-on-surface">
          {formatCurrency(categoryTotal(c, category))}
        </span>
      ),
    },
  ];

  return (
    <AppShell
      action={
        <Button size="sm" icon={Download} onClick={exportCsv} disabled={filtered.length === 0}>
          Export CSV
        </Button>
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Reports</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Spend across travel claims. Filter, review totals, and export for accounting.
          </p>
        </div>

        <Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Period"
              options={PERIOD_OPTIONS}
              value={period}
              onChange={setPeriod}
            />
            <Select
              label="Status"
              options={STATUS_OPTIONS}
              value={status}
              onChange={setStatus}
            />
            <Select
              label="Category"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={setCategory}
            />
          </div>
          {filtersActive && (
            <div className="mt-4 flex justify-end">
              <Button variant="text" size="sm" icon={FilterX} onClick={resetFilters}>
                Clear filters
              </Button>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Claims" value={String(filtered.length)} icon={ReceiptText} />
          <MetricCard
            label="Total value"
            value={formatCurrencyCompact(totalValue)}
            icon={BarChart3}
          />
          <MetricCard
            label="Paid"
            value={formatCurrencyCompact(paidValue)}
            icon={Wallet}
          />
          <MetricCard
            label="Average claim"
            value={formatCurrencyCompact(avgClaim)}
            icon={TrendingUp}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card title="By category" className="lg:col-span-1">
            {breakdown.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No spend in this selection.</p>
            ) : (
              <ul className="space-y-3">
                {breakdown.map(({ cat, total }) => (
                  <li key={cat.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-on-surface">{cat.name}</span>
                      <span className="font-medium text-on-surface">
                        {formatCurrency(total)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-container-high">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.max(6, (total / breakdownMax) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Claims" subtitle={`${filtered.length} matching`} padded={false} className="lg:col-span-2">
            <DataTable
              columns={columns}
              data={filtered}
              rowKey={(c) => c.id}
              density="compact"
              caption="Filtered claims report"
              empty={
                <EmptyState
                  icon={FilterX}
                  title="No claims match"
                  body="Adjust the filters above to widen the report."
                  action={
                    <Button variant="outlined" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  }
                  variant="compact"
                />
              }
            />
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

"use client";

import * as React from "react";
import { Plus, Pencil, Trash2, GitBranch } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { TextArea } from "@/components/ui/TextArea";
import { Select } from "@/components/ui/Select";
import { useSnackbar } from "@/components/ui/Snackbar";
import {
  policies as seedPolicies,
  categories as seedCategories,
  routingRules as seedRouting,
  type Policy,
  type ExpenseCategory,
  type RoutingRule,
} from "@/lib/mock/mock_data";
import { formatCurrency } from "@/lib/format";

type Tab = "policies" | "categories" | "routing";

const PERIOD_LABEL: Record<Policy["period"], string> = {
  per_item: "Per item",
  per_day: "Per day",
  per_trip: "Per trip",
  per_month: "Per month",
};

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? "inline-flex items-center rounded-full bg-success-container px-2.5 py-0.5 text-[11px] font-medium text-success-container-foreground"
          : "inline-flex items-center rounded-full bg-surface-container-high px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant"
      }
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export default function PoliciesAdminPage() {
  const [tab, setTab] = React.useState<Tab>("policies");

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Policy administration</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Manage spend policies, expense categories, and approval routing.
          </p>
        </div>

        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          ariaLabel="Admin section"
          options={[
            { value: "policies", label: "Policies", count: seedPolicies.length },
            { value: "categories", label: "Categories", count: seedCategories.length },
            { value: "routing", label: "Routing", count: seedRouting.length },
          ]}
        />

        {tab === "policies" && <PolicyTab />}
        {tab === "categories" && <CategoryTab />}
        {tab === "routing" && <RoutingTab />}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------- policies -- */

function PolicyTab() {
  const { show } = useSnackbar();
  const [rows, setRows] = React.useState<Policy[]>(seedPolicies);
  const [editing, setEditing] = React.useState<Policy | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<Policy | null>(null);

  function remove(p: Policy) {
    setRows((r) => r.filter((x) => x.id !== p.id));
    show(`Policy “${p.name}” deleted.`, { tone: "success" });
    setConfirmDelete(null);
  }

  function save(draft: Policy) {
    setRows((r) => {
      const exists = r.some((x) => x.id === draft.id);
      return exists ? r.map((x) => (x.id === draft.id ? draft : x)) : [...r, draft];
    });
    show(editing ? "Policy updated." : "Policy created.", { tone: "success" });
    setEditing(null);
    setCreating(false);
  }

  const columns: Column<Policy>[] = [
    {
      key: "name",
      header: "Policy",
      sortable: true,
      sortValue: (p) => p.name,
      render: (p) => (
        <div>
          <p className="font-medium text-on-surface">{p.name}</p>
          <p className="max-w-md text-xs text-on-surface-variant">{p.description}</p>
        </div>
      ),
    },
    {
      key: "limit",
      header: "Limit",
      align: "right",
      sortable: true,
      sortValue: (p) => p.limit,
      render: (p) => (
        <span className="font-semibold text-on-surface">{formatCurrency(p.limit, p.currency)}</span>
      ),
    },
    { key: "period", header: "Period", render: (p) => PERIOD_LABEL[p.period] },
    { key: "status", header: "Status", render: (p) => <StatusPill active={p.active} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (p) => (
        <RowActions onEdit={() => setEditing(p)} onDelete={() => setConfirmDelete(p)} />
      ),
    },
  ];

  return (
    <>
      <div className="flex justify-end">
        <Button icon={Plus} size="sm" onClick={() => setCreating(true)}>
          New policy
        </Button>
      </div>
      <Card padded={false}>
        <DataTable
          columns={columns}
          data={rows}
          rowKey={(p) => p.id}
          density="compact"
          caption="Spend policies"
        />
      </Card>

      <PolicyDialog
        open={creating || editing !== null}
        initial={editing}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSave={save}
      />

      <DeleteDialog
        open={confirmDelete !== null}
        name={confirmDelete?.name ?? ""}
        kind="policy"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
      />
    </>
  );
}

function PolicyDialog({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: Policy | null;
  onClose: () => void;
  onSave: (p: Policy) => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [limit, setLimit] = React.useState("");
  const [period, setPeriod] = React.useState<Policy["period"]>("per_item");
  const [errors, setErrors] = React.useState<{ name?: string; limit?: string }>({});

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setLimit(initial ? String(initial.limit) : "");
      setPeriod(initial?.period ?? "per_item");
      setErrors({});
    }
  }, [open, initial]);

  function submit() {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Give the policy a name.";
    const limitNum = Number(limit);
    if (!limit || Number.isNaN(limitNum) || limitNum <= 0) next.limit = "Enter a positive limit.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSave({
      id: initial?.id ?? `pol-${Math.round(limitNum)}-${name.length}`,
      name: name.trim(),
      description: description.trim(),
      categoryId: initial?.categoryId,
      limit: limitNum,
      period,
      currency: initial?.currency ?? "IDR",
      active: initial?.active ?? true,
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit policy" : "New policy"}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>{initial ? "Save changes" : "Create policy"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Name"
          required
          value={name}
          error={errors.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Hotel nightly cap"
        />
        <TextArea
          label="Description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this policy enforce?"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Limit (IDR)"
            required
            inputMode="numeric"
            value={limit}
            error={errors.limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="1200000"
          />
          <Select
            label="Period"
            options={[
              { value: "per_item", label: "Per item" },
              { value: "per_day", label: "Per day" },
              { value: "per_trip", label: "Per trip" },
              { value: "per_month", label: "Per month" },
            ]}
            value={period}
            onChange={(v) => setPeriod(v as Policy["period"])}
          />
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ categories -- */

function CategoryTab() {
  const { show } = useSnackbar();
  const [rows, setRows] = React.useState<ExpenseCategory[]>(seedCategories);

  function toggle(cat: ExpenseCategory) {
    setRows((r) => r.map((x) => (x.id === cat.id ? { ...x, active: !x.active } : x)));
    show(`“${cat.name}” ${cat.active ? "disabled" : "enabled"}.`, { tone: "success" });
  }

  const columns: Column<ExpenseCategory>[] = [
    {
      key: "name",
      header: "Category",
      sortable: true,
      sortValue: (c) => c.name,
      render: (c) => <span className="font-medium text-on-surface">{c.name}</span>,
    },
    {
      key: "receipt",
      header: "Receipt required over",
      align: "right",
      render: (c) =>
        c.requiresReceipt ? formatCurrency(c.receiptThreshold) : "Not required",
    },
    {
      key: "cap",
      header: "Per-item cap",
      align: "right",
      render: (c) => (c.perItemCap ? formatCurrency(c.perItemCap) : "—"),
    },
    { key: "status", header: "Status", render: (c) => <StatusPill active={c.active} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (c) => (
        <Button variant="text" size="sm" onClick={() => toggle(c)}>
          {c.active ? "Disable" : "Enable"}
        </Button>
      ),
    },
  ];

  return (
    <Card padded={false}>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(c) => c.id}
        density="compact"
        caption="Expense categories"
      />
    </Card>
  );
}

/* --------------------------------------------------------------- routing -- */

function RoutingTab() {
  const { show } = useSnackbar();
  const [rows, setRows] = React.useState<RoutingRule[]>(seedRouting);

  function toggle(rule: RoutingRule) {
    setRows((r) => r.map((x) => (x.id === rule.id ? { ...x, active: !x.active } : x)));
    show(`Routing rule “${rule.name}” ${rule.active ? "disabled" : "enabled"}.`, {
      tone: "success",
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {rows.map((rule) => (
        <Card key={rule.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden />
                <h3 className="text-base font-semibold text-on-surface">{rule.name}</h3>
              </div>
              <p className="mt-1 text-sm text-on-surface-variant">{rule.condition}</p>
            </div>
            <StatusPill active={rule.active} />
          </div>
          <ol className="mt-4 flex flex-wrap items-center gap-2">
            {rule.steps.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1 text-xs font-medium text-on-surface">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  {step}
                </span>
                {i < rule.steps.length - 1 && (
                  <span className="text-on-surface-variant" aria-hidden>
                    ›
                  </span>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-4 flex justify-end">
            <Button variant="text" size="sm" onClick={() => toggle(rule)}>
              {rule.active ? "Disable" : "Enable"}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- shared -- */

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <button
        type="button"
        onClick={onEdit}
        aria-label="Edit"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Pencil className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-error transition-colors hover:bg-error-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
      >
        <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}

function DeleteDialog({
  open,
  name,
  kind,
  onClose,
  onConfirm,
}: {
  open: boolean;
  name: string;
  kind: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={`Delete ${kind}?`}
      description={`“${name}” will be removed. This cannot be undone.`}
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
          <Trash2 className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} onClick={onConfirm}>
            Delete {kind}
          </Button>
        </>
      }
    />
  );
}

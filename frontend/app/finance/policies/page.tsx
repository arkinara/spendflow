"use client";

import * as React from "react";
import {
  Plus,
  Pencil,
  GitBranch,
  PowerOff,
  ArrowUp,
  ArrowDown,
  X,
  Gauge as MileageIcon,
  AlertTriangle,
  RefreshCw,
  ListPlus,
  ShieldCheck,
  ShieldX,
  Clock,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { TextArea } from "@/components/ui/TextArea";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSnackbar } from "@/components/ui/Snackbar";
import { users, DEPARTMENTS } from "@/lib/fixtures";
import {
  useCategories,
  usePolicies,
  useRoutes,
  useActiveCategoriesPreview,
  type UseAdminCollection,
} from "@/lib/mock/useAdminStore";
import {
  addCategory,
  editCategory,
  deactivateCategory,
  addPolicy,
  editPolicy,
  deactivatePolicy,
  addRoute,
  editRoute,
  reorderRouteSteps,
  deactivateRoute,
  summarizeMatch,
  approverTypeLabel,
  AdminApiError,
  type AdminCategory,
  type AdminPolicy,
  type AdminRoute,
  type AdminRouteStep,
  type ApproverType,
  type CategoryInput,
  type PolicyInput,
  type RouteInput,
  type RouteStepInput,
} from "@/lib/api/admin";
import { formatCurrency, formatDate } from "@/lib/format";
import type { CurrencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "policies" | "categories" | "routing";

const PERIOD_LABEL: Record<AdminPolicy["period"], string> = {
  per_item: "Per item",
  per_day: "Per day",
  per_trip: "Per trip",
  per_month: "Per month",
};

const CURRENCY_OPTIONS: { value: CurrencyCode; label: string }[] = [
  { value: "IDR", label: "IDR — Indonesian Rupiah" },
  { value: "USD", label: "USD — US Dollar" },
];

const APPROVER_TYPE_OPTIONS: { value: ApproverType; label: string }[] = [
  { value: "submitter_manager", label: "Submitter's manager" },
  { value: "specific_user", label: "Named approver" },
  { value: "finance", label: "Finance Admin" },
];

/** Today in the ISO date form the BE compares `effective_date` against. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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
  const [denied, setDenied] = React.useState(false);
  const onForbidden = React.useCallback(() => setDenied(true), []);

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Policy administration</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Manage spend policies, expense categories, and approval routing. Changes are read from and written to the live backend.
          </p>
        </div>

        {denied ? (
          <AdminForbidden />
        ) : (
          <>
            <SegmentedTabs<Tab>
              value={tab}
              onChange={setTab}
              ariaLabel="Admin section"
              options={[
                { value: "policies", label: "Policies" },
                { value: "categories", label: "Categories" },
                { value: "routing", label: "Routing" },
              ]}
            />

            {tab === "policies" && <PolicyTab onForbidden={onForbidden} />}
            {tab === "categories" && <CategoryTab onForbidden={onForbidden} />}
            {tab === "routing" && <RoutingTab onForbidden={onForbidden} />}
          </>
        )}
      </div>
    </AppShell>
  );
}

/* ============================================================ shared states == */

/**
 * Rendered in place of the admin console when a mutation (not just the
 * initial list load) comes back 403 — e.g. the caller's Finance-Admin
 * standing was revoked mid-session. Mirrors `RouteGuard`'s access-denied
 * panel so the page never looks broken, just unauthorized.
 */
function AdminForbidden() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container px-6 py-10 text-center"
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
        <ShieldX className="h-6 w-6" strokeWidth={1.75} aria-hidden />
      </span>
      <p className="font-medium text-on-surface">You&apos;re not authorized to manage admin settings.</p>
      <p className="text-sm text-on-surface-variant">
        Your session no longer has Finance Admin access. Reload the page or sign in again.
      </p>
    </div>
  );
}

function AdminError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card padded={false}>
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <div>
          <p className="font-medium text-on-surface">Couldn't load this section</p>
          <p className="mt-1 max-w-sm text-sm text-on-surface-variant">{message}</p>
        </div>
        <Button variant="tonal" icon={RefreshCw} size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

function SectionEmpty({
  title,
  body,
  onAdd,
  addLabel,
  icon,
}: {
  title: string;
  body: string;
  onAdd: () => void;
  addLabel: string;
  icon: typeof ListPlus;
}) {
  return (
    <Card padded={false}>
      <EmptyState
        icon={icon}
        title={title}
        body={body}
        action={
          <Button icon={Plus} size="sm" onClick={onAdd}>
            {addLabel}
          </Button>
        }
      />
    </Card>
  );
}

/** Inline banner for an unmapped/network mutation error. The dialog stays
 *  open on failure and the Save/Deactivate button remains clickable, so this
 *  doubles as the "retry-capable error state" the negative ACs require. */
function FormErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-xl bg-error-container px-3 py-2 text-sm text-error-container-foreground"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {message}
    </p>
  );
}

/**
 * Deactivate-only confirmation (the BE exposes no reactivate endpoint — DELETE
 * is a one-way soft delete). Stays open with an inline error on failure so the
 * Deactivate button doubles as a retry action.
 */
function DeactivateDialog({
  open,
  name,
  kind,
  error,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  name: string;
  kind: string;
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={`Deactivate ${kind}?`}
      description={`"${name}" will be marked inactive and hidden from new submissions, but stays in the list so historical claims keep their references.`}
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
          <PowerOff className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? "Deactivating…" : `Deactivate ${kind}`}
          </Button>
        </>
      }
    >
      {error && <FormErrorBanner message={error} />}
    </Dialog>
  );
}

function RowActions({
  onEdit,
  onDeactivate,
  active,
}: {
  onEdit: () => void;
  onDeactivate: () => void;
  active: boolean;
}) {
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
      {active && (
        <button
          type="button"
          onClick={onDeactivate}
          aria-label="Deactivate"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-error transition-colors hover:bg-error-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
        >
          <PowerOff className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Accessible on/off switch used inside the admin dialogs. */
function Switch({
  checked,
  onChange,
  label,
  helper,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  helper?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0">
        <p className="text-sm font-medium text-on-surface">{label}</p>
        {helper && <p className="mt-0.5 text-xs text-on-surface-variant">{helper}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ease-m3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          checked ? "bg-primary" : "bg-surface-container-highest"
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ease-m3",
            checked ? "translate-x-6" : "translate-x-1"
          )}
        />
      </button>
    </div>
  );
}

/** Read the ready rows out of a collection hook, or `[]` while loading/errored. */
function readyRows<T>(collection: UseAdminCollection<T>): T[] {
  return collection.state.status === "ready" ? collection.state.rows : [];
}

/* ============================================================ CATEGORIES ==== */

function CategoryTab({ onForbidden }: { onForbidden: () => void }) {
  const { show } = useSnackbar();
  const { state, retry, refresh } = useCategories();
  const preview = useActiveCategoriesPreview();
  const [editing, setEditing] = React.useState<AdminCategory | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [confirm, setConfirm] = React.useState<AdminCategory | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [confirmPending, setConfirmPending] = React.useState(false);

  React.useEffect(() => {
    if (state.status === "denied") onForbidden();
  }, [state.status, onForbidden]);

  function refreshAll() {
    refresh();
    preview.refresh();
  }

  async function handleSave(input: CategoryInput) {
    if (editing) {
      await editCategory(editing.id, input);
      show(`Category "${input.name}" updated.`, { tone: "success" });
    } else {
      await addCategory(input);
      show(`Category "${input.name}" created.`, { tone: "success" });
    }
    setEditing(null);
    setCreating(false);
    refreshAll();
  }

  async function handleDeactivate() {
    if (!confirm) return;
    setConfirmPending(true);
    setConfirmError(null);
    try {
      await deactivateCategory(confirm.id);
      show(`"${confirm.name}" deactivated.`, { tone: "success" });
      setConfirm(null);
      refreshAll();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 403) {
        onForbidden();
        return;
      }
      setConfirmError(
        err instanceof Error ? err.message : "Could not deactivate the category."
      );
    } finally {
      setConfirmPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-on-surface-variant">
          Categories available to employees in the claim builder. Deactivate rather than delete to preserve historical claim references.
        </p>
        <Button icon={Plus} size="sm" onClick={() => setCreating(true)}>
          New category
        </Button>
      </div>

      {state.status === "loading" && (
        <Card padded={false}>
          <div className="p-4">
            <Skeleton variant="list" lines={4} />
          </div>
        </Card>
      )}
      {state.status === "error" && (
        <AdminError message={state.message} onRetry={retry} />
      )}
      {state.status === "ready" && state.rows.length === 0 && (
        <SectionEmpty
          icon={ListPlus}
          title="No expense categories yet"
          body="Add the categories employees can choose from when entering line items."
          onAdd={() => setCreating(true)}
          addLabel="New category"
        />
      )}
      {state.status === "ready" && state.rows.length > 0 && (
        <Card padded={false}>
          <DataTable
            columns={[
              {
                key: "name",
                header: "Category",
                sortable: true,
                sortValue: (c) => c.name,
                render: (c) => (
                  <div>
                    <p className="font-medium text-on-surface">{c.name}</p>
                    <p className="text-xs text-on-surface-variant">{c.code}</p>
                  </div>
                ),
              },
              {
                key: "mileage",
                header: "Mileage",
                render: (c) =>
                  c.requiresMileage ? (
                    <span className="inline-flex items-center gap-1 text-sm text-on-surface">
                      <MileageIcon className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden />
                      Distance-based
                    </span>
                  ) : (
                    <span className="text-sm text-on-surface-variant">—</span>
                  ),
              },
              {
                key: "receipt",
                header: "Receipt ≥",
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
                  <RowActions
                    active={c.active}
                    onEdit={() => setEditing(c)}
                    onDeactivate={() => {
                      setConfirm(c);
                      setConfirmError(null);
                    }}
                  />
                ),
              },
            ]}
            data={state.rows}
            rowKey={(c) => c.id}
            density="compact"
            caption="Expense categories"
          />
        </Card>
      )}

      {/* Live preview of the employee claim-builder category list (DoD). */}
      <CategoryPreview
        status={preview.state.status}
        rows={readyRows(preview)}
        onRetry={preview.retry}
      />

      <CategoryDialog
        open={creating || editing !== null}
        initial={editing}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSave={handleSave}
        onForbidden={onForbidden}
      />

      <DeactivateDialog
        open={confirm !== null}
        name={confirm?.name ?? ""}
        kind="category"
        error={confirmError}
        pending={confirmPending}
        onClose={() => {
          setConfirm(null);
          setConfirmError(null);
        }}
        onConfirm={handleDeactivate}
      />
    </div>
  );
}

function CategoryPreview({
  status,
  rows,
  onRetry,
}: {
  status: "loading" | "ready" | "error" | "denied";
  rows: AdminCategory[];
  onRetry: () => void;
}) {
  return (
    <Card
      title="Employee claim-builder preview"
      subtitle="Live snapshot of active categories as they appear to employees entering a claim"
    >
      {status === "loading" ? (
        <Skeleton variant="list" lines={3} />
      ) : status === "error" ? (
        <AdminError message="Preview could not be loaded." onRetry={onRetry} />
      ) : status === "denied" ? (
        <p className="py-6 text-center text-sm text-on-surface-variant">Preview unavailable.</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-on-surface-variant">
          No active categories — employees have nothing to choose from yet.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {rows.map((c) => (
            <li
              key={c.id}
              className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-3 py-1.5 text-sm text-on-surface"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {c.code}
              </span>
              {c.name}
              {c.requiresMileage && (
                <MileageIcon className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} aria-hidden />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface CategoryFieldErrors {
  name?: string;
  code?: string;
  receiptThreshold?: string;
  perItemCap?: string;
}

function CategoryDialog({
  open,
  initial,
  onClose,
  onSave,
  onForbidden,
}: {
  open: boolean;
  initial: AdminCategory | null;
  onClose: () => void;
  onSave: (input: CategoryInput) => Promise<void>;
  onForbidden: () => void;
}) {
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [requiresMileage, setRequiresMileage] = React.useState(false);
  const [requiresReceipt, setRequiresReceipt] = React.useState(true);
  const [receiptThreshold, setReceiptThreshold] = React.useState("");
  const [perItemCap, setPerItemCap] = React.useState("");
  const [errors, setErrors] = React.useState<CategoryFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setCode(initial?.code ?? "");
      setRequiresMileage(initial?.requiresMileage ?? false);
      setRequiresReceipt(initial?.requiresReceipt ?? true);
      setReceiptThreshold(initial ? String(initial.receiptThreshold) : "");
      setPerItemCap(initial?.perItemCap != null ? String(initial.perItemCap) : "");
      setErrors({});
      setFormError(null);
      setSubmitting(false);
    }
  }, [open, initial]);

  async function submit() {
    const next: CategoryFieldErrors = {};
    if (!name.trim()) next.name = "Category name is required.";
    if (!code.trim()) next.code = "Category code is required.";
    const thresholdNum = Number(receiptThreshold);
    if (receiptThreshold === "" || Number.isNaN(thresholdNum) || thresholdNum < 0) {
      next.receiptThreshold = "Enter zero or a positive amount.";
    }
    const capNum = perItemCap === "" ? undefined : Number(perItemCap);
    if (capNum != null && (Number.isNaN(capNum) || capNum < 0)) {
      next.perItemCap = "Cap cannot be negative.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setFormError(null);
    setSubmitting(true);
    try {
      await onSave({
        name,
        code,
        requiresMileage,
        requiresReceipt,
        receiptThreshold: thresholdNum,
        perItemCap: capNum,
      });
    } catch (err) {
      if (err instanceof AdminApiError) {
        if (err.status === 403) {
          onForbidden();
          return;
        }
        const mapped: CategoryFieldErrors = {};
        if (/code/i.test(err.message)) mapped.code = err.message;
        else if (/name/i.test(err.message)) mapped.name = err.message;
        else setFormError(err.message);
        setErrors((cur) => ({ ...cur, ...mapped }));
      } else {
        setFormError(
          err instanceof Error
            ? err.message
            : "Could not save the category. Check your connection and try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit category" : "New category"}
      description="Name, code, and the mileage flag drive how employees enter expenses for this category."
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : initial ? "Save changes" : "Create category"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <FormErrorBanner message={formError} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
          <TextField
            label="Name"
            required
            value={name}
            error={errors.name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Training"
          />
          <TextField
            label="Code"
            required
            value={code}
            error={errors.code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())}
            placeholder="TRN"
            helper="2–6 chars"
            maxLength={6}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Receipt required above"
            required
            inputMode="numeric"
            value={receiptThreshold}
            error={errors.receiptThreshold}
            onChange={(e) => setReceiptThreshold(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="500000"
          />
          <TextField
            label="Per-item cap (optional)"
            inputMode="numeric"
            value={perItemCap}
            error={errors.perItemCap}
            onChange={(e) => setPerItemCap(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="1200000"
          />
        </div>
        <div className="rounded-2xl border border-outline-variant px-4 py-3">
          <Switch
            label="Mileage category"
            helper="Distance-based entry (km × rate) instead of a flat amount."
            checked={requiresMileage}
            onChange={setRequiresMileage}
          />
          <div className="my-2 border-t border-outline-variant" />
          <Switch
            label="Receipt required"
            helper="A receipt is mandatory for expenses in this category above the threshold."
            checked={requiresReceipt}
            onChange={setRequiresReceipt}
          />
        </div>
      </div>
    </Dialog>
  );
}

/* ============================================================== POLICIES === */

function PolicyTab({ onForbidden }: { onForbidden: () => void }) {
  const { show } = useSnackbar();
  const { state, retry, refresh } = usePolicies();
  const categoryState = useCategories();
  const [editing, setEditing] = React.useState<AdminPolicy | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [confirm, setConfirm] = React.useState<AdminPolicy | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [confirmPending, setConfirmPending] = React.useState(false);

  React.useEffect(() => {
    if (state.status === "denied") onForbidden();
  }, [state.status, onForbidden]);

  const categories = readyRows(categoryState);
  const categoryName = React.useCallback(
    (id?: string) => categories.find((c) => c.id === id)?.name,
    [categories]
  );

  async function handleSave(input: PolicyInput) {
    if (editing) {
      await editPolicy(editing.id, input);
      show(`Policy "${input.name}" updated.`, { tone: "success" });
    } else {
      await addPolicy(input);
      show(`Policy "${input.name}" created.`, { tone: "success" });
    }
    setEditing(null);
    setCreating(false);
    refresh();
  }

  async function handleDeactivate() {
    if (!confirm) return;
    setConfirmPending(true);
    setConfirmError(null);
    try {
      await deactivatePolicy(confirm.id);
      show(`"${confirm.name}" deactivated.`, { tone: "success" });
      setConfirm(null);
      refresh();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 403) {
        onForbidden();
        return;
      }
      setConfirmError(err instanceof Error ? err.message : "Could not deactivate the policy.");
    } finally {
      setConfirmPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-on-surface-variant">
          Spending limits and receipt/justification thresholds per category. Effective dating applies changes to claims submitted on or after the effective date.
        </p>
        <Button icon={Plus} size="sm" onClick={() => setCreating(true)}>
          New policy
        </Button>
      </div>

      {state.status === "loading" && (
        <Card padded={false}>
          <div className="p-4">
            <Skeleton variant="list" lines={4} />
          </div>
        </Card>
      )}
      {state.status === "error" && <AdminError message={state.message} onRetry={retry} />}
      {state.status === "ready" && state.rows.length === 0 && (
        <SectionEmpty
          icon={ShieldCheck}
          title="No spend policies yet"
          body="Define spending limits and receipt/justification thresholds per category."
          onAdd={() => setCreating(true)}
          addLabel="New policy"
        />
      )}
      {state.status === "ready" && state.rows.length > 0 && (
        <Card padded={false}>
          <DataTable
            columns={[
              {
                key: "name",
                header: "Policy",
                sortable: true,
                sortValue: (p) => p.name,
                render: (p) => (
                  <div>
                    <p className="font-medium text-on-surface">{p.name}</p>
                    <p className="max-w-md text-xs text-on-surface-variant">
                      {p.description || categoryName(p.categoryId) || "—"}
                    </p>
                  </div>
                ),
              },
              {
                key: "limit",
                header: "Max amount",
                align: "right",
                sortable: true,
                sortValue: (p) => p.limit,
                render: (p) => (
                  <span className="font-semibold text-on-surface">
                    {formatCurrency(p.limit, p.currency)}
                  </span>
                ),
              },
              { key: "period", header: "Period", render: (p) => PERIOD_LABEL[p.period] },
              {
                key: "receipt",
                header: "Receipt ≥",
                align: "right",
                render: (p) =>
                  p.receiptRequired ? formatCurrency(p.receiptRequiredAbove) : "Not required",
              },
              {
                key: "just",
                header: "Justification ≥",
                align: "right",
                render: (p) => formatCurrency(p.justificationRequiredAbove),
              },
              {
                key: "effective",
                header: "Effective",
                render: (p) => (
                  <div className="flex items-center gap-1.5">
                    <span>{formatDate(p.effectiveDate)}</span>
                    {p.effectiveDate > todayIso() && (
                      <span
                        title="Effective date is in the future — not yet applied to new claims"
                        className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 text-[11px] font-medium text-secondary-container-foreground"
                      >
                        <Clock className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                        Scheduled
                      </span>
                    )}
                  </div>
                ),
              },
              { key: "status", header: "Status", render: (p) => <StatusPill active={p.active} /> },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (p) => (
                  <RowActions
                    active={p.active}
                    onEdit={() => setEditing(p)}
                    onDeactivate={() => {
                      setConfirm(p);
                      setConfirmError(null);
                    }}
                  />
                ),
              },
            ]}
            data={state.rows}
            rowKey={(p) => p.id}
            density="compact"
            caption="Spend policies"
          />
        </Card>
      )}

      <PolicyDialog
        open={creating || editing !== null}
        initial={editing}
        categories={categories}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSave={handleSave}
        onForbidden={onForbidden}
      />

      <DeactivateDialog
        open={confirm !== null}
        name={confirm?.name ?? ""}
        kind="policy"
        error={confirmError}
        pending={confirmPending}
        onClose={() => {
          setConfirm(null);
          setConfirmError(null);
        }}
        onConfirm={handleDeactivate}
      />
    </div>
  );
}

interface PolicyFieldErrors {
  name?: string;
  categoryId?: string;
  limit?: string;
  currency?: string;
  receiptRequiredAbove?: string;
  justificationRequiredAbove?: string;
  effectiveDate?: string;
}

function PolicyDialog({
  open,
  initial,
  categories,
  onClose,
  onSave,
  onForbidden,
}: {
  open: boolean;
  initial: AdminPolicy | null;
  categories: AdminCategory[];
  onClose: () => void;
  onSave: (input: PolicyInput) => Promise<void>;
  onForbidden: () => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string>("");
  const [limit, setLimit] = React.useState("");
  const [period, setPeriod] = React.useState<AdminPolicy["period"]>("per_item");
  const [currency, setCurrency] = React.useState<CurrencyCode>("IDR");
  const [receiptRequired, setReceiptRequired] = React.useState(true);
  const [receiptRequiredAbove, setReceiptRequiredAbove] = React.useState("");
  const [justificationRequiredAbove, setJustificationRequiredAbove] = React.useState("");
  const [effectiveDate, setEffectiveDate] = React.useState("");
  const [errors, setErrors] = React.useState<PolicyFieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setCategoryId(initial?.categoryId ?? categories[0]?.id ?? "");
      setLimit(initial ? String(initial.limit) : "");
      setPeriod(initial?.period ?? "per_item");
      setCurrency(initial?.currency ?? "IDR");
      setReceiptRequired(initial?.receiptRequired ?? true);
      setReceiptRequiredAbove(initial ? String(initial.receiptRequiredAbove) : "");
      setJustificationRequiredAbove(
        initial ? String(initial.justificationRequiredAbove) : ""
      );
      setEffectiveDate(initial?.effectiveDate ?? todayIso());
      setErrors({});
      setFormError(null);
      setSubmitting(false);
    }
  }, [open, initial, categories]);

  async function submit() {
    const next: PolicyFieldErrors = {};
    if (!name.trim()) next.name = "Policy name is required.";
    if (!categoryId) next.categoryId = "Select a category.";
    const limitNum = Number(limit);
    if (!limit || Number.isNaN(limitNum) || limitNum <= 0) {
      next.limit = "Enter a positive max amount.";
    }
    const rra = Number(receiptRequiredAbove);
    if (receiptRequiredAbove === "" || Number.isNaN(rra) || rra < 0) {
      next.receiptRequiredAbove = "Enter zero or a positive amount.";
    }
    const jra = Number(justificationRequiredAbove);
    if (justificationRequiredAbove === "" || Number.isNaN(jra) || jra < 0) {
      next.justificationRequiredAbove = "Enter zero or a positive amount.";
    }
    // Cross-field guard (mirrors the BE's min<max check): a trigger threshold
    // must not exceed the max reimbursable amount.
    if (!next.limit && !next.receiptRequiredAbove && rra > limitNum) {
      next.receiptRequiredAbove = "Receipt threshold cannot exceed the max amount.";
    }
    if (!next.limit && !next.justificationRequiredAbove && jra > limitNum) {
      next.justificationRequiredAbove =
        "Justification threshold cannot exceed the max amount.";
    }
    if (!effectiveDate || Number.isNaN(new Date(effectiveDate).getTime())) {
      next.effectiveDate = "Pick an effective date.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setFormError(null);
    setSubmitting(true);
    try {
      await onSave({
        name,
        description,
        categoryId,
        limit: limitNum,
        period,
        currency,
        receiptRequired,
        receiptRequiredAbove: rra,
        justificationRequiredAbove: jra,
        effectiveDate,
      });
    } catch (err) {
      if (err instanceof AdminApiError) {
        if (err.status === 403) {
          onForbidden();
          return;
        }
        const msg = err.message;
        const mapped: PolicyFieldErrors = {};
        if (/categor/i.test(msg)) mapped.categoryId = msg;
        else if (/currency/i.test(msg)) mapped.currency = msg;
        else if (/receipt.*exceed|receipt_required_above/i.test(msg))
          mapped.receiptRequiredAbove = msg;
        else if (/justification/i.test(msg)) mapped.justificationRequiredAbove = msg;
        else if (/effective.date/i.test(msg)) mapped.effectiveDate = msg;
        else if (/limit amount/i.test(msg)) mapped.limit = msg;
        else mapped.name = msg;
        setErrors((cur) => ({ ...cur, ...mapped }));
      } else {
        setFormError(
          err instanceof Error
            ? err.message
            : "Could not save the policy. Check your connection and try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={initial ? "Edit policy" : "New policy"}
      description="Set the spending limit, receipt/justification thresholds, and when the change takes effect."
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : initial ? "Save changes" : "Create policy"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <FormErrorBanner message={formError} />}
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
          <Select
            label="Category"
            required
            options={categoryOptions}
            value={categoryId}
            error={errors.categoryId}
            onChange={setCategoryId}
            placeholder={categories.length ? "Select…" : "Create a category first"}
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
            onChange={(v) => setPeriod(v as AdminPolicy["period"])}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Max amount"
            required
            inputMode="numeric"
            value={limit}
            error={errors.limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="1200000"
          />
          <Select
            label="Currency"
            options={CURRENCY_OPTIONS}
            value={currency}
            error={errors.currency}
            onChange={(v) => setCurrency(v as CurrencyCode)}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Receipt required above"
            required
            inputMode="numeric"
            value={receiptRequiredAbove}
            error={errors.receiptRequiredAbove}
            onChange={(e) => setReceiptRequiredAbove(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="500000"
          />
          <TextField
            label="Justification required above"
            required
            inputMode="numeric"
            value={justificationRequiredAbove}
            error={errors.justificationRequiredAbove}
            onChange={(e) =>
              setJustificationRequiredAbove(e.target.value.replace(/[^0-9]/g, ""))
            }
            placeholder="1200000"
          />
        </div>
        <DateField
          label="Effective date"
          required
          value={effectiveDate}
          error={errors.effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          helper="Applies to claims submitted on or after this date."
        />
        <div className="rounded-2xl border border-outline-variant px-4 py-3">
          <Switch
            label="Receipt required"
            helper="A receipt is mandatory for expenses this policy covers."
            checked={receiptRequired}
            onChange={setReceiptRequired}
          />
        </div>
      </div>
    </Dialog>
  );
}

/* =============================================================== ROUTING === */

function RoutingTab({ onForbidden }: { onForbidden: () => void }) {
  const { show } = useSnackbar();
  const { state, retry, refresh } = useRoutes();
  const categoryState = useCategories();
  const [editing, setEditing] = React.useState<AdminRoute | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [confirm, setConfirm] = React.useState<AdminRoute | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [confirmPending, setConfirmPending] = React.useState(false);

  React.useEffect(() => {
    if (state.status === "denied") onForbidden();
  }, [state.status, onForbidden]);

  const categories = readyRows(categoryState);
  const categoryName = React.useCallback(
    (id?: string) => categories.find((c) => c.id === id)?.name,
    [categories]
  );

  async function handleSave(input: RouteInput) {
    try {
      if (editing) {
        await editRoute(editing.id, input);
        show(`Route "${input.name}" updated.`, { tone: "success" });
      } else {
        await addRoute(input);
        show(`Route "${input.name}" created.`, { tone: "success" });
      }
      setEditing(null);
      setCreating(false);
      refresh();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 403) {
        onForbidden();
        return;
      }
      throw err;
    }
  }

  async function handleDeactivate() {
    if (!confirm) return;
    setConfirmPending(true);
    setConfirmError(null);
    try {
      await deactivateRoute(confirm.id);
      show(`Route "${confirm.name}" deactivated.`, { tone: "success" });
      setConfirm(null);
      refresh();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 403) {
        onForbidden();
        return;
      }
      setConfirmError(err instanceof Error ? err.message : "Could not deactivate the route.");
    } finally {
      setConfirmPending(false);
    }
  }

  async function handleReorder(routeId: string, orderedStepIds: string[]) {
    try {
      await reorderRouteSteps(routeId, orderedStepIds);
      refresh();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 403) {
        onForbidden();
        return;
      }
      show(err instanceof Error ? err.message : "Could not reorder steps.", {
        tone: "error",
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-on-surface-variant">
          Define how claims are matched to an approval chain. If no specific route matches, the fallback route applies.
        </p>
        <Button icon={Plus} size="sm" onClick={() => setCreating(true)}>
          New route
        </Button>
      </div>

      {state.status === "loading" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      )}
      {state.status === "error" && <AdminError message={state.message} onRetry={retry} />}
      {state.status === "ready" && state.rows.length === 0 && (
        <SectionEmpty
          icon={GitBranch}
          title="No approval routes yet"
          body="Define how submitted claims are matched to an ordered approval chain."
          onAdd={() => setCreating(true)}
          addLabel="New route"
        />
      )}
      {state.status === "ready" && state.rows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {state.rows.map((rule) => (
            <RouteCard
              key={rule.id}
              rule={rule}
              categoryName={categoryName}
              onEdit={() => setEditing(rule)}
              onDeactivate={() => {
                setConfirm(rule);
                setConfirmError(null);
              }}
              onReorder={(ids) => handleReorder(rule.id, ids)}
            />
          ))}
        </div>
      )}

      <RouteDialog
        open={creating || editing !== null}
        initial={editing}
        categories={categories}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSave={handleSave}
      />

      <DeactivateDialog
        open={confirm !== null}
        name={confirm?.name ?? ""}
        kind="route"
        error={confirmError}
        pending={confirmPending}
        onClose={() => {
          setConfirm(null);
          setConfirmError(null);
        }}
        onConfirm={handleDeactivate}
      />
    </div>
  );
}

function RouteCard({
  rule,
  categoryName,
  onEdit,
  onDeactivate,
  onReorder,
}: {
  rule: AdminRoute;
  categoryName: (id?: string) => string | undefined;
  onEdit: () => void;
  onDeactivate: () => void;
  onReorder: (orderedStepIds: string[]) => void;
}) {
  const condition = summarizeMatch(rule.match, categoryName(rule.match.categoryId));
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden />
            <h3 className="text-base font-semibold text-on-surface">{rule.name}</h3>
            {rule.isFallback && (
              <span className="inline-flex items-center rounded-full bg-secondary-container px-2 py-0.5 text-[11px] font-medium text-secondary-container-foreground">
                Fallback
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-on-surface-variant">{condition}</p>
        </div>
        <StatusPill active={rule.active} />
      </div>
      <ol className="mt-4 space-y-2">
        {rule.steps.map((step, i) => (
          <li
            key={step.id}
            className="flex items-center gap-2 rounded-xl bg-surface-container-high px-3 py-2"
          >
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              {i + 1}
            </span>
            <span className="flex-1 text-sm font-medium text-on-surface">{step.label}</span>
            <span className="text-[11px] uppercase tracking-wide text-on-surface-variant">
              {approverTypeLabel(step.approverType)}
            </span>
            <div className="flex items-center">
              <button
                type="button"
                aria-label={`Move step ${i + 1} up`}
                disabled={i === 0}
                onClick={() => onReorder(swap(rule.steps, i, i - 1))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Move step ${i + 1} down`}
                disabled={i === rule.steps.length - 1}
                onClick={() => onReorder(swap(rule.steps, i, i + 1))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ArrowDown className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex justify-end">
        <RowActions active={rule.active} onEdit={onEdit} onDeactivate={onDeactivate} />
      </div>
    </Card>
  );
}

/** Return step ids with positions i and j swapped (for up/down reorder). */
function swap(steps: AdminRouteStep[], i: number, j: number): string[] {
  if (j < 0 || j >= steps.length) return steps.map((s) => s.id);
  const ids = steps.map((s) => s.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

function RouteDialog({
  open,
  initial,
  categories,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: AdminRoute | null;
  categories: AdminCategory[];
  onClose: () => void;
  onSave: (input: RouteInput) => Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [minAmount, setMinAmount] = React.useState("");
  const [maxAmount, setMaxAmount] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [steps, setSteps] = React.useState<RouteStepInput[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setMinAmount(initial?.match.minAmount != null ? String(initial.match.minAmount) : "");
      setMaxAmount(initial?.match.maxAmount != null ? String(initial.match.maxAmount) : "");
      setCategoryId(initial?.match.categoryId ?? "");
      setDepartment(initial?.match.department ?? "");
      setSteps(
        initial
          ? initial.steps.map((s) => ({
              approverType: s.approverType,
              approverId: s.approverId,
              label: s.label,
            }))
          : [
              {
                approverType: "submitter_manager" as ApproverType,
                label: "Submitter's manager",
              },
            ]
      );
      setError(null);
      setSubmitting(false);
    }
  }, [open, initial]);

  function updateStep(idx: number, patch: Partial<RouteStepInput>) {
    setSteps((arr) => arr.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((arr) => {
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= arr.length) return arr;
      const copy = [...arr];
      [copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]];
      return copy;
    });
  }

  function addStep() {
    setSteps((arr) => [...arr, { approverType: "finance", label: "Finance Admin" }]);
  }

  function removeStep(idx: number) {
    setSteps((arr) => arr.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!name.trim()) {
      setError("Route name is required.");
      return;
    }
    if (steps.length === 0) {
      setError("A route needs at least one approval step.");
      return;
    }
    const minNum = minAmount === "" ? undefined : Number(minAmount);
    const maxNum = maxAmount === "" ? undefined : Number(maxAmount);
    if (minNum != null && (Number.isNaN(minNum) || minNum < 0)) {
      setError("Minimum amount must be zero or a positive number.");
      return;
    }
    if (maxNum != null && (Number.isNaN(maxNum) || maxNum < 0)) {
      setError("Maximum amount must be zero or a positive number.");
      return;
    }
    if (minNum != null && maxNum != null && minNum > maxNum) {
      setError("Minimum amount cannot exceed the maximum amount.");
      return;
    }
    if (steps.some((s) => s.approverType === "specific_user" && !s.approverId)) {
      setError("Every named-approver step must select a specific user.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSave({
        name,
        match: {
          minAmount: minNum,
          maxAmount: maxNum,
          categoryId: categoryId || undefined,
          department: department || undefined,
        },
        steps,
        isFallback: initial?.isFallback,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save the route. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const categoryOptions = [
    { value: "", label: "Any category" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];
  const departmentOptions = [
    { value: "", label: "Any department" },
    ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
  ];
  const userOptions = users
    .filter((u) => u.role !== "employee")
    .map((u) => ({ value: u.id, label: `${u.name} — ${u.jobTitle}` }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={initial ? "Edit route" : "New route"}
      description="Match claims by amount, category, or department, then define the ordered approval chain."
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : initial ? "Save changes" : "Create route"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Route name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. High-value claim"
        />
        <fieldset className="space-y-4 rounded-2xl border border-outline-variant p-4">
          <legend className="px-1 text-sm font-medium text-on-surface">Match criteria</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Min amount (optional)"
              inputMode="numeric"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="5000000"
            />
            <TextField
              label="Max amount (optional)"
              inputMode="numeric"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="10000000"
            />
            <Select
              label="Category"
              options={categoryOptions}
              value={categoryId}
              onChange={setCategoryId}
            />
            <Select
              label="Department"
              options={departmentOptions}
              value={department}
              onChange={setDepartment}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl border border-outline-variant p-4">
          <legend className="px-1 text-sm font-medium text-on-surface">
            Approval steps ({steps.length})
          </legend>
          {steps.length === 0 && (
            <p className="rounded-xl bg-surface-container-high px-3 py-4 text-center text-sm text-on-surface-variant">
              A route needs at least one approval step.
            </p>
          )}
          {steps.map((step, i) => (
            <div
              key={i}
              className="flex flex-wrap items-end gap-3 rounded-xl bg-surface-container-high p-3"
            >
              <div className="flex h-10 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {i + 1}
              </div>
              <div className="min-w-[160px] flex-1">
                <Select
                  label="Approver type"
                  options={APPROVER_TYPE_OPTIONS}
                  value={step.approverType}
                  onChange={(v) =>
                    updateStep(i, { approverType: v as ApproverType, approverId: undefined })
                  }
                />
              </div>
              {step.approverType === "specific_user" && (
                <div className="min-w-[180px] flex-1">
                  <Select
                    label="Named approver"
                    options={userOptions}
                    value={step.approverId ?? ""}
                    onChange={(v) => updateStep(i, { approverId: v })}
                  />
                </div>
              )}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move step ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => moveStep(i, -1)}
                  className="inline-flex h-10 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Move step ${i + 1} down`}
                  disabled={i === steps.length - 1}
                  onClick={() => moveStep(i, 1)}
                  className="inline-flex h-10 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ArrowDown className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Remove step ${i + 1}`}
                  onClick={() => removeStep(i)}
                  className="inline-flex h-10 w-9 items-center justify-center rounded-full text-error transition-colors hover:bg-error-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </div>
          ))}
          <Button variant="tonal" size="sm" icon={Plus} onClick={addStep}>
            Add step
          </Button>
        </fieldset>

        {error && <FormErrorBanner message={error} />}
      </div>
    </Dialog>
  );
}

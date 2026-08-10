"use client";

/* ============================================================================
 * SpendFlow — RouteAddDialog (#63, extracted from page.tsx in #55b).
 *
 * "New route" / "Edit route" dialog for the policies admin console. Create:
 * name + match criteria (amount range, category, department) + an ordered
 * approval chain. Edit: the same form pre-filled from the selected row.
 * Submitting POSTs/PATCHes `/api/admin/routes` via `onSave`; the parent owns
 * the store mutation, snackbar, and refresh (and catches 403 — the dialog
 * itself never calls `onForbidden`, unlike Category/PolicyAddDialog). On
 * failure the dialog stays open and surfaces the error inline. Step reordering
 * here is local only; the persisted reorder goes through `RouteCard` →
 * `reorderRouteSteps` (#21).
 * ========================================================================== */

import * as React from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { Select } from "@/components/ui/Select";
import { users, DEPARTMENTS } from "@/lib/fixtures";
import type {
  AdminCategory,
  AdminRoute,
  ApproverType,
  RouteInput,
  RouteStepInput,
} from "@/lib/api/admin";

const APPROVER_TYPE_OPTIONS: { value: ApproverType; label: string }[] = [
  { value: "submitter_manager", label: "Submitter's manager" },
  { value: "specific_user", label: "Named approver" },
  { value: "finance", label: "Finance Admin" },
];

/** Inline banner for an unmapped/network mutation error. The dialog stays
 *  open on failure and the Save button remains clickable, so this doubles as
 *  the "retry-capable error state" the negative ACs require. */
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

export default function RouteAddDialog({
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

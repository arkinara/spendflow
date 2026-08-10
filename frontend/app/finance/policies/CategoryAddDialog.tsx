"use client";

/* ============================================================================
 * SpendFlow — CategoryAddDialog (#55a).
 *
 * "New category" / "Edit category" dialog for the policies admin console.
 * Create: name + code (+ optional receipt threshold, per-item cap, mileage
 * flag). Edit: the same form pre-filled from the selected row. Submitting
 * POSTs/PATCHes `/api/admin/categories` via `onSave`; the parent owns the
 * store mutation, snackbar, and refresh. On failure the dialog stays open and
 * surfaces the `AdminApiError` inline (409 `duplicate_code` → code field).
 * ========================================================================== */

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { AdminApiError, type AdminCategory, type CategoryInput } from "@/lib/api/admin";
import { cn } from "@/lib/utils";

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

interface CategoryFieldErrors {
  name?: string;
  code?: string;
  receiptThreshold?: string;
  perItemCap?: string;
}

export default function CategoryAddDialog({
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

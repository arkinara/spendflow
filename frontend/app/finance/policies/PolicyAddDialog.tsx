"use client";

/* ============================================================================
 * SpendFlow — PolicyAddDialog (#55a).
 *
 * "New policy" / "Edit policy" dialog for the policies admin console.
 * Create: name + category + currency + max amount + receipt/justification
 * thresholds + effective date. Edit: the same form pre-filled from the
 * selected row. Submitting POSTs/PATCHes `/api/admin/policies` via `onSave`;
 * the parent owns the store mutation, snackbar, and refresh. On failure the
 * dialog stays open and surfaces the `AdminApiError` inline (400
 * `validation` covers min>=max thresholds and unsupported currency).
 * ========================================================================== */

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { TextArea } from "@/components/ui/TextArea";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { AdminApiError, type AdminCategory, type AdminPolicy, type PolicyInput } from "@/lib/api/admin";
import { type CurrencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Today in the ISO date form the BE compares `effective_date` against. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const CURRENCY_OPTIONS: { value: CurrencyCode; label: string }[] = [
  { value: "IDR", label: "IDR — Indonesian Rupiah" },
  { value: "USD", label: "USD — US Dollar" },
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

interface PolicyFieldErrors {
  name?: string;
  categoryId?: string;
  limit?: string;
  currency?: string;
  receiptRequiredAbove?: string;
  justificationRequiredAbove?: string;
  effectiveDate?: string;
}

export default function PolicyAddDialog({
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

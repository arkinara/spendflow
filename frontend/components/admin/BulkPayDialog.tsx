"use client";

/* ============================================================================
 * SpendFlow — BulkPayDialog (ticket #73, FE half).
 *
 * Confirms a batch disbursement of every selected approved claim. One payment
 * method + one reference number stamp every `payments` row written for the
 * batch (BE #73). Follows the same password re-auth (#64) + all-or-nothing
 * batch contract as the other bulk dialogs: full success toasts + closes +
 * hands the processed ids to `onSuccess`; a batch rollback surfaces
 * `BulkPartialFailureError` with the failing claim ids inline and the dialog
 * stays open.
 * ========================================================================== */

import * as React from "react";
import { Banknote } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import { useSnackbar } from "@/components/ui/Snackbar";
import { bulkPayClaims } from "@/lib/api/finance";
import {
  BulkPartialFailureError,
  UsersApiError,
} from "@/lib/api/users";

const PAYMENT_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "payroll", label: "Payroll" },
];

export function BulkPayDialog({
  open,
  claimIds,
  onClose,
  onSuccess,
}: {
  open: boolean;
  claimIds: string[];
  onClose: () => void;
  /** Fired on a full success with the processed claim ids (row-drop hint). */
  onSuccess: (processed: string[]) => void;
}) {
  const { show } = useSnackbar();
  const [paymentMethod, setPaymentMethod] = React.useState<
    "bank_transfer" | "payroll"
  >("bank_transfer");
  const [reference, setReference] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [formError, setFormError] = React.useState<React.ReactNode>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const count = claimIds.length;

  // Reset the form every time the dialog opens (Esc / Cancel / success all
  // tear the form down so the next open starts clean).
  React.useEffect(() => {
    if (open) {
      setPaymentMethod("bank_transfer");
      setReference("");
      setPassword("");
      setFormError(null);
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit =
    !submitting && password.trim() !== "" && reference.trim() !== "";

  async function submit() {
    if (!canSubmit || claimIds.length === 0) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await bulkPayClaims({
        claimIds,
        password,
        paymentMethod,
        reference: reference.trim(),
      });
      show(
        `${result.processed.length} claim${result.processed.length === 1 ? "" : "s"} paid`,
        { tone: "success" }
      );
      setPassword("");
      setReference("");
      onSuccess(result.processed);
      onClose();
    } catch (err) {
      if (err instanceof BulkPartialFailureError) {
        const failed = err.details;
        setFormError(
          <div className="space-y-1.5">
            <p className="font-medium">
              {failed.length} of {count} claims could not be paid — the batch
              was rolled back.
            </p>
            <ul className="space-y-1">
              {failed.map((d) => (
                <li key={d.userId} className="flex items-start gap-2 text-xs">
                  <span className="font-mono">{d.userId}</span>
                  <span className="min-w-0 break-words">
                    — {d.error.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      } else if (err instanceof UsersApiError) {
        // #64: 401 invalid_password / 400 invalid_body / 403 — BE verbatim.
        setFormError(err.message);
      } else {
        setFormError("We couldn't pay these claims. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!submitting}
      role="alertdialog"
      title={`Pay ${count} claim${count === 1 ? "" : "s"}`}
      description={`Disburse every selected approved claim with one method + reference.`}
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Banknote className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="filled"
            icon={Banknote}
            loading={submitting}
            disabled={!canSubmit}
            onClick={submit}
          >
            Pay {count}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Payment method"
          required
          options={PAYMENT_METHOD_OPTIONS}
          value={paymentMethod}
          onChange={(v) => setPaymentMethod(v as "bank_transfer" | "payroll")}
        />
        <TextField
          label="Reference number"
          required
          placeholder="e.g. BATCH-2026-08-001"
          helper="Stamped on every payment row in this batch."
          value={reference}
          onChange={(e) => {
            setReference(e.target.value);
            if (formError) setFormError(null);
          }}
          disabled={submitting}
        />
        <TextField
          label="Re-enter your password to confirm"
          type="password"
          autoComplete="current-password"
          helper="Your password must match your current session"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (formError) setFormError(null);
          }}
          required
          disabled={submitting}
        />
        {formError && <FormErrorBanner message={formError} />}
      </div>
    </Dialog>
  );
}

export default BulkPayDialog;

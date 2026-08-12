"use client";

/* ============================================================================
 * SpendFlow — BulkRejectDialog (ticket #73, FE half).
 *
 * Confirms a batch reject of every selected exception-queue claim, returning
 * them to their employees with one shared comment (BE requires ≥10 chars;
 * shorter comments are 400 `invalid_body`). Follows the same password re-auth
 * (#64) + all-or-nothing batch contract as BulkApproveDialog: full success
 * toasts + closes + hands the processed ids to `onSuccess`; a batch rollback
 * surfaces `BulkPartialFailureError` with the failing claim ids inline and the
 * dialog stays open.
 * ========================================================================== */

import * as React from "react";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { TextArea } from "@/components/ui/TextArea";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import { useSnackbar } from "@/components/ui/Snackbar";
import { bulkRejectClaims } from "@/lib/api/finance";
import {
  BulkPartialFailureError,
  UsersApiError,
} from "@/lib/api/users";

export function BulkRejectDialog({
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
  const [comment, setComment] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [formError, setFormError] = React.useState<React.ReactNode>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const count = claimIds.length;

  // Reset the form every time the dialog opens (Esc / Cancel / success all
  // tear the form down so the next open starts clean).
  React.useEffect(() => {
    if (open) {
      setComment("");
      setPassword("");
      setFormError(null);
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit =
    !submitting &&
    password.trim() !== "" &&
    comment.trim().length >= 10;

  async function submit() {
    if (!canSubmit || claimIds.length === 0) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await bulkRejectClaims({
        claimIds,
        password,
        comment: comment.trim(),
      });
      show(
        `${result.processed.length} claim${result.processed.length === 1 ? "" : "s"} returned to the employees`,
        { tone: "success" }
      );
      setPassword("");
      setComment("");
      onSuccess(result.processed);
      onClose();
    } catch (err) {
      if (err instanceof BulkPartialFailureError) {
        const failed = err.details;
        setFormError(
          <div className="space-y-1.5">
            <p className="font-medium">
              {failed.length} of {count} claims could not be rejected — the
              batch was rolled back.
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
        setFormError("We couldn't reject these claims. Try again.");
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
      title={`Reject ${count} claim${count === 1 ? "" : "s"}`}
      description={`Return every selected claim to its employee with one shared comment.`}
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
          <XCircle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={XCircle}
            loading={submitting}
            disabled={!canSubmit}
            onClick={submit}
          >
            Reject {count}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextArea
          label="Comment to the employees"
          required
          helper="Shared across every claim. At least 10 characters."
          placeholder="e.g. Receipts are required for these amounts — please attach and resubmit."
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
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

export default BulkRejectDialog;

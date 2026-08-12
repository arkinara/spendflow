"use client";

/* ============================================================================
 * SpendFlow — BulkApproveDialog (ticket #73, FE half).
 *
 * Confirms a batch finance-approval of every selected exception-queue claim.
 * Mirrors the UnblockClaimDialog password-re-auth contract (#64): the actor
 * re-enters their own password, the BE verifies it (`requirePasswordReauth`,
 * 401 `invalid_password`), then runs the batch all-or-nothing.
 *
 * On a full success the dialog toasts + closes, handing the processed claim
 * ids back to the page via `onSuccess` so the queue can drop those rows
 * without a refetch (the same mutate pattern `unblockClaim` uses). When the
 * BE reports a batch rollback (2xx body with `failed[]`), a
 * `BulkPartialFailureError` surfaces the failing claim ids + messages inline
 * and the dialog stays open for a retry.
 * ========================================================================== */

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import { useSnackbar } from "@/components/ui/Snackbar";
import { bulkApproveClaims } from "@/lib/api/finance";
import {
  BulkPartialFailureError,
  UsersApiError,
} from "@/lib/api/users";

export function BulkApproveDialog({
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
  const [password, setPassword] = React.useState("");
  const [formError, setFormError] = React.useState<React.ReactNode>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const count = claimIds.length;

  // Reset the form every time the dialog opens (Esc / Cancel / success all
  // tear the form down so the next open starts clean).
  React.useEffect(() => {
    if (open) {
      setPassword("");
      setFormError(null);
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = !submitting && password.trim() !== "";

  async function submit() {
    if (!canSubmit || claimIds.length === 0) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await bulkApproveClaims({ claimIds, password });
      show(
        `${result.processed.length} claim${result.processed.length === 1 ? "" : "s"} approved`,
        { tone: "success" }
      );
      setPassword("");
      onSuccess(result.processed);
      onClose();
    } catch (err) {
      if (err instanceof BulkPartialFailureError) {
        const failed = err.details;
        setFormError(
          <div className="space-y-1.5">
            <p className="font-medium">
              {failed.length} of {count} claims could not be approved — the
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
        setFormError("We couldn't approve these claims. Try again.");
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
      title={`Approve ${count} claim${count === 1 ? "" : "s"}`}
      description={`Approve every selected claim in one batch? A policy flag stays open until a line is overridden.`}
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <CheckCircle2 className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="filled"
            icon={CheckCircle2}
            loading={submitting}
            disabled={!canSubmit}
            onClick={submit}
          >
            Approve {count}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
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

export default BulkApproveDialog;

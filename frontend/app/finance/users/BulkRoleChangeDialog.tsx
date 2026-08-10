"use client";

/* ============================================================================
 * SpendFlow — BulkRoleChangeDialog (#61, extracted from page.tsx in #54c).
 *
 * "Bulk change role" dialog: a Finance Admin picks one role and applies it to
 * every selected user in the directory. Submitting calls the parent's
 * `onSaved(newRole)`, which fans out `changeUserRole` sequentially via the
 * `useUsers.bulkChangeRole` hook (#32). The dialog itself never touches the
 * API directly, so the page owns the cache + selection reconciliation.
 *
 * Error contract (mirrors the inline def this replaced):
 *   - `BulkPartialFailureError` → inline list of failing user ids + messages,
 *     unless any leg was a 403 (then the whole page flips to access-denied).
 *   - `UsersApiError` 403 → `onForbidden` (parent flips to denied panel).
 *   - other → inline message, dialog stays open.
 * ========================================================================== */

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import {
  BulkPartialFailureError,
  UsersApiError,
} from "@/lib/api/users";
import { ROLE_LABEL } from "@/lib/auth/session";
import type { Role } from "@/lib/types";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "employee", label: "Employee" },
  { value: "approver", label: "Approver" },
  { value: "finance", label: "Finance Admin" },
];

export function BulkRoleChangeDialog({
  open,
  count,
  onClose,
  onSaved,
  onForbidden,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onSaved: (newRole: Role) => Promise<void>;
  onForbidden: () => void;
}) {
  const [role, setRole] = React.useState<Role>("employee");
  const [formError, setFormError] = React.useState<React.ReactNode>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setRole("employee");
      setFormError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function submit() {
    setFormError(null);
    setSubmitting(true);
    try {
      await onSaved(role);
    } catch (err) {
      if (err instanceof BulkPartialFailureError) {
        if (err.details.some((d) => d.error.status === 403)) {
          onForbidden();
          return;
        }
        const failed = err.details;
        setFormError(
          <div className="space-y-1.5">
            <p className="font-medium">
              {failed.length} of {count} users could not be updated.
            </p>
            <ul className="space-y-1">
              {failed.map((d) => (
                <li key={d.userId} className="flex items-start gap-2 text-xs">
                  <span className="font-mono">{d.userId}</span>
                  <span className="min-w-0 break-words text-error-container-foreground/80">
                    — {d.error.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
        return;
      }
      if (err instanceof UsersApiError && err.status === 403) {
        onForbidden();
        return;
      }
      setFormError(
        err instanceof Error
          ? err.message
          : "Could not change roles. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Bulk change role"
      description={`Change the role of ${count} selected users to ${ROLE_LABEL[role]}?`}
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <ShieldCheck className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || count === 0}>
            {submitting
              ? "Changing roles…"
              : `Change role for ${count} user${count === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <FormErrorBanner message={formError} />}
        <Select
          label="New role"
          required
          options={ROLE_OPTIONS}
          value={role}
          onChange={(v) => setRole(v as Role)}
        />
      </div>
    </Dialog>
  );
}

export default BulkRoleChangeDialog;

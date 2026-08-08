"use client";

/* ============================================================================
 * SpendFlow — RoleChangeDialog (#54b).
 *
 * "Change role" dialog: a Finance Admin edits a user's full role set through
 * the RolesMultiSelect chip picker (#53). Submitting fires `changeUserRoles`
 * with the whole roles array (the legacy single-role `changeUserRole` path
 * stays covered by apiUsers.test.ts back-compat tests). On failure the dialog
 * stays open and surfaces the BE error inline; a BE 403 flips the whole page
 * to the access-denied panel via `onForbidden`.
 * ========================================================================== */

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { RolesMultiSelect } from "@/components/ui/RolesMultiSelect";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import { UsersApiError, type BackendUser } from "@/lib/api/users";
import { ROLE_LABEL } from "@/lib/auth/session";
import type { Role } from "@/lib/types";

export function RoleChangeDialog({
  open,
  target,
  onClose,
  onSaved,
  onForbidden,
}: {
  open: boolean;
  target: BackendUser | null;
  onClose: () => void;
  onSaved: (target: BackendUser, newRoles: Role[]) => Promise<void>;
  onForbidden: () => void;
}) {
  const [roles, setRoles] = React.useState<Role[]>(["employee"]);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open && target) {
      setRoles(target.roles ?? [target.role]);
      setFormError(null);
      setSubmitting(false);
    }
  }, [open, target]);

  async function submit() {
    if (!target) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await onSaved(target, roles);
    } catch (err) {
      if (err instanceof UsersApiError && err.status === 403) {
        onForbidden();
        return;
      }
      setFormError(
        err instanceof Error ? err.message : "Could not change the roles. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const currentRoles = target
    ? (target.roles ?? [target.role]).map((r) => ROLE_LABEL[r]).join(", ")
    : "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change role"
      description={
        target
          ? `Change ${target.name}'s roles. Their current role is ${currentRoles}.`
          : ""
      }
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
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Change role"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <FormErrorBanner message={formError} />}
        <RolesMultiSelect
          label="Roles"
          required
          roles={roles}
          onChange={setRoles}
        />
      </div>
    </Dialog>
  );
}

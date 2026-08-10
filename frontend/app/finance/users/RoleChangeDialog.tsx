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
 *
 * #64: a password field re-authenticates the actor before the destructive
 * role change — the submit is disabled until it is non-empty, and a BE 401
 * (wrong / missing password) surfaces the BE's message inline with the dialog
 * staying open. The password lives only in local state and is cleared on
 * close/success.
 * ========================================================================== */

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { RolesMultiSelect } from "@/components/ui/RolesMultiSelect";
import { TextField } from "@/components/ui/TextField";
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
  onSaved: (target: BackendUser, newRoles: Role[], password: string) => Promise<void>;
  onForbidden: () => void;
}) {
  const [roles, setRoles] = React.useState<Role[]>(["employee"]);
  const [password, setPassword] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open && target) {
      setRoles(target.roles ?? [target.role]);
      setPassword("");
      setFormError(null);
      setSubmitting(false);
    }
  }, [open, target]);

  function handleClose() {
    // Password never lingers past the dialog's life.
    setPassword("");
    setFormError(null);
    onClose();
  }

  async function submit() {
    if (!target || !password) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await onSaved(target, roles, password);
      setPassword("");
    } catch (err) {
      if (err instanceof UsersApiError && err.status === 403) {
        onForbidden();
        return;
      }
      // 401 invalid_password / missing_password → the BE's message verbatim.
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
      onClose={handleClose}
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
          <Button variant="text" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !password}>
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
      </div>
    </Dialog>
  );
}

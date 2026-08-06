"use client";

/* ============================================================================
 * SpendFlow — DeleteUserDialog (#43).
 *
 * Destructive confirm for hard-deleting a `pending` or `disabled` user from
 * `/finance/users`. Two-step: (1) click "Delete" on the row, (2) this dialog
 * lists exactly what gets removed and re-authenticates the actor with their
 * own password (BE #41/#42) so an accidental click or an idle-session hijack
 * can't nuke an account the attacker never knew the password for.
 *
 * Error contract (see `lib/api/users.ts#deleteUser`):
 *   - 401 invalid_password → inline "Incorrect password", password cleared +
 *     field re-focused (dialog stays open).
 *   - 409 cannot_delete_active_user → inline error suggesting deactivating
 *     first (defense only; the UI never offers delete on active rows).
 *   - 403 forbidden → parent flips to the access-denied panel.
 *   - 404 / other → inline message, dialog stays open.
 *
 * The password lives only in this dialog's local state — it is never stored,
 * logged, or persisted, and is cleared on close and on success.
 * ========================================================================== */

import * as React from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import { UsersApiError, type BackendUser } from "@/lib/api/users";

/** What a hard delete permanently removes (mirrors the BE cascade). */
const REMOVAL_ITEMS = [
  "User account + login credentials",
  "Pending invitations",
  "Active sessions",
];

export function DeleteUserDialog({
  open,
  target,
  onClose,
  onSaved,
  onForbidden,
}: {
  open: boolean;
  target: BackendUser | null;
  onClose: () => void;
  onSaved: (target: BackendUser, password: string) => Promise<void>;
  onForbidden: () => void;
}) {
  const [password, setPassword] = React.useState("");
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setPassword("");
      setPasswordError(null);
      setFormError(null);
      setSubmitting(false);
    }
  }, [open]);

  function handleClose() {
    // Password never lingers past the dialog's life.
    setPassword("");
    setPasswordError(null);
    setFormError(null);
    onClose();
  }

  async function submit() {
    if (!target || !password) return;
    setPasswordError(null);
    setFormError(null);
    setSubmitting(true);
    try {
      await onSaved(target, password);
      // Success → parent closes the dialog; the row is gone via the hook cache.
      setPassword("");
    } catch (err) {
      if (err instanceof UsersApiError) {
        if (err.status === 403) {
          onForbidden();
          return;
        }
        if (err.status === 401) {
          setPasswordError("Incorrect password");
          setPassword("");
          requestAnimationFrame(() => passwordRef.current?.focus());
          return;
        }
        if (err.status === 409) {
          setFormError(
            "This user is still active and cannot be deleted. Deactivate them first, then try again.",
          );
          return;
        }
        if (err.status === 404) {
          setFormError("This user was already deleted or no longer exists.");
          return;
        }
      }
      setFormError(
        err instanceof Error
          ? err.message
          : "Could not delete this user. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={target ? `Delete ${target.name}?` : "Delete user?"}
      description="This permanently removes the account and its data. There is no undo."
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      role="alertdialog"
      footer={
        <>
          <Button variant="text" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Trash2}
            onClick={submit}
            disabled={submitting || !password}
            loading={submitting}
          >
            {submitting ? "Deleting…" : "Delete permanently"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant">
          {target ? `${target.name}'s` : "This user's"} account, invites, and
          sessions will be permanently removed:
        </p>
        <ul className="space-y-1.5">
          {REMOVAL_ITEMS.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 rounded-lg bg-surface-container-high px-3 py-2 text-sm text-on-surface"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-error" aria-hidden />
              {item}
            </li>
          ))}
        </ul>

        <p className="rounded-xl border border-outline-variant bg-surface-container px-3 py-2 text-xs leading-relaxed text-on-surface-variant">
          Active users with claims or approvals cannot be deleted. This action
          is only available for pending or deactivated users. To remove an
          active user, deactivate them first, wait for audit history, then
          contact engineering.
        </p>

        {formError && <FormErrorBanner message={formError} />}

        <TextField
          ref={passwordRef}
          label="Re-enter your password to confirm"
          type="password"
          autoComplete="current-password"
          helper="Your password must match your current session"
          error={passwordError ?? undefined}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (passwordError) setPasswordError(null);
            if (formError) setFormError(null);
          }}
          required
          disabled={submitting}
        />
      </div>
    </Dialog>
  );
}

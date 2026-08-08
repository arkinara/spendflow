"use client";

/* ============================================================================
 * SpendFlow — SetManagerDialog.
 *
 * "Set manager" dialog: reassigns who an employee reports to. Only active
 * approvers are offered as candidates (the only role that can actually approve
 * submitted claims), never the target themselves. Clearing the reporting line
 * submits `null`. On failure the dialog stays open and surfaces the BE error
 * inline (e.g. 400 `self_manager`, `cycle`).
 * ========================================================================== */

import * as React from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import { UsersApiError, type BackendUser } from "@/lib/api/users";

export function SetManagerDialog({
  open,
  target,
  users,
  onClose,
  onSaved,
  onForbidden,
}: {
  open: boolean;
  target: BackendUser | null;
  users: BackendUser[];
  onClose: () => void;
  onSaved: (target: BackendUser, managerId: string | null) => Promise<void>;
  onForbidden: () => void;
}) {
  const [managerId, setManagerId] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const nameById = React.useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  React.useEffect(() => {
    if (open && target) {
      setManagerId(target.managerId ?? "");
      setFormError(null);
      setSubmitting(false);
    }
  }, [open, target]);

  // The manager picker only ever offers active approvers (the only role that
  // can actually approve submitted claims), never the target themselves.
  const candidates = React.useMemo(
    () =>
      users
        .filter(
          (u) =>
            u.role === "approver" &&
            u.status === "active" &&
            u.id !== target?.id
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users, target]
  );

  const options = React.useMemo(
    () => [
      { value: "", label: "No manager (clear)" },
      ...candidates.map((u) => ({ value: u.id, label: u.name })),
    ],
    [candidates]
  );

  async function submit() {
    if (!target) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await onSaved(target, managerId === "" ? null : managerId);
    } catch (err) {
      if (err instanceof UsersApiError && err.status === 403) {
        onForbidden();
        return;
      }
      setFormError(
        err instanceof Error ? err.message : "Could not set the manager. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const currentName = target?.managerId ? nameById.get(target.managerId) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Set manager"
      description={
        target
          ? `Pick who ${target.name} reports to, or clear the reporting line.`
          : ""
      }
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <UserRound className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Set manager"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant">
          Current manager: <span className="font-medium text-on-surface">{currentName ?? "—"}</span>
        </p>
        {formError && <FormErrorBanner message={formError} />}
        {candidates.length === 0 ? (
          <div
            role="status"
            className="rounded-xl bg-surface-container-high px-4 py-6 text-center text-sm text-on-surface-variant"
          >
            No active approvers available. Add an Approver user first.
          </div>
        ) : (
          <Select
            label="Manager"
            required
            options={options}
            value={managerId}
            onChange={setManagerId}
            placeholder="Select a manager…"
          />
        )}
      </div>
    </Dialog>
  );
}

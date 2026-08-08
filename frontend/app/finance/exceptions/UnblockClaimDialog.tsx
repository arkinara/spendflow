"use client";

/* ============================================================================
 * SpendFlow — UnblockClaimDialog (ticket #48, FE half).
 *
 * Finance-Admin action for a `blocked_sod` claim in the exceptions queue. The
 * claim was held by the segregation-of-duties guard (#46) and can only be
 * released by re-routing it so the conflict disappears:
 *   - "Assign manager to {submitter}"  → PATCH `managerId` (unblocks a
 *     `no_manager` route) — requires picking an active approver manager.
 *   - "Reassign this step's approver"  → PATCH `stepId` + `newApproverId`
 *     (unblocks a `self_approval` step) — requires picking the step (from the
 *     claim's `routeSteps`, supplied by the BE) + the new approver.
 * Both actions also require a free-text `resolution` (min 10 chars) that is
 * recorded on the BE audit entry ("Required for audit").
 *
 * Error handling mirrors the SetManager/Delete dialogs: on success the parent
 * closes the dialog + toasts + drops the row from the queue (no refetch); on a
 * 409 `still_blocked` the BE's SoD message surfaces inline verbatim and the
 * dialog stays open; any other failure shows a generic inline error. Esc
 * dismisses without submitting, and the form state is cleared on close.
 * ========================================================================== */

import * as React from "react";
import { AlertTriangle, Unlock } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { Button } from "@/components/ui/Button";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import { UsersApiError, type BackendUser } from "@/lib/api/users";
import {
  type FinanceExceptionItem,
  type FinanceRouteStep,
  type UnblockClaimInput,
} from "@/lib/api/finance";
import { cn } from "@/lib/utils";
import { useUsers } from "@/lib/hooks/useUsers";

const APPROVER_TYPE_LABEL: Record<FinanceRouteStep["approverType"], string> = {
  submitter_manager: "Manager",
  specific_user: "Specific approver",
  finance: "Finance review",
};

function ActionCard({
  name,
  checked,
  label,
  detail,
  onChange,
}: {
  name: string;
  checked: boolean;
  label: string;
  detail: string;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors duration-200 ease-m3",
        checked
          ? "border-primary bg-primary/5"
          : "border-outline-variant hover:bg-surface-container-highest"
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-on-surface">{label}</span>
        <span className="mt-0.5 block text-xs text-on-surface-variant">{detail}</span>
      </span>
    </label>
  );
}

export function UnblockClaimDialog({
  claim,
  onClose,
  onSubmit,
}: {
  claim: FinanceExceptionItem | null;
  onClose: () => void;
  onSubmit: (claimId: string, body: UnblockClaimInput) => Promise<unknown>;
}) {
  const [action, setAction] = React.useState<UnblockClaimInput["action"]>(
    "assign_manager",
  );
  const [managerId, setManagerId] = React.useState("");
  const [stepId, setStepId] = React.useState("");
  const [newApproverId, setNewApproverId] = React.useState("");
  const [resolution, setResolution] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const open = claim !== null;

  // The dialog fetches its own user directory when it opens (#48) so the
  // approver / step pickers have data without the parent page needing to
  // know the dialog is mounted. The early return above keeps useUsers() from
  // firing on tests that mount ExceptionsPage without mocking it.
  const usersState = useUsers();
  const users: BackendUser[] = open && usersState.state.status === "ready"
    ? usersState.state.rows
    : [];

  // Reset the form every time the dialog opens (Esc / Cancel / success all
  // tear the form down so the next open starts clean).
  React.useEffect(() => {
    if (!open) return;
    setAction("assign_manager");
    setManagerId("");
    setStepId(claim?.routeSteps?.[0]?.id ?? "");
    setNewApproverId("");
    setResolution("");
    setFormError(null);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, claim?.id]);

  // The manager / new-approver pickers only ever offer active approvers (the
  // only role that can actually approve submitted claims), never the submitter
  // themselves (#48 defence in depth — the BE re-checks anyway).
  const approvers = React.useMemo(
    () =>
      users
        .filter(
          (u) =>
            u.role === "approver" &&
            u.status === "active" &&
            u.id !== claim?.employeeId,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users, claim],
  );

  const approverOptions = React.useMemo(
    () => approvers.map((u) => ({ value: u.id, label: u.name })),
    [approvers],
  );

  const stepOptions = React.useMemo(
    () =>
      (claim?.routeSteps ?? []).map((s) => ({
        value: s.id,
        label: `${s.label} · ${APPROVER_TYPE_LABEL[s.approverType]}`,
      })),
    [claim],
  );

  const submitterName = claim?.employeeName ?? "the submitter";

  const canSubmit =
    !submitting &&
    resolution.trim().length >= 10 &&
    (action === "assign_manager"
      ? managerId !== ""
      : stepId !== "" && newApproverId !== "");

  async function submit() {
    if (!claim) return;
    setFormError(null);
    setSubmitting(true);
    const body: UnblockClaimInput = {
      resolution: resolution.trim(),
      action,
      ...(action === "assign_manager"
        ? { managerId }
        : { stepId, newApproverId }),
    };
    try {
      await onSubmit(claim.id, body);
    } catch (err) {
      if (err instanceof UsersApiError && err.code === "still_blocked") {
        // Defense in depth: the reassignment still violates SoD — surface the
        // BE's message verbatim so Finance picks a different approver.
        setFormError(err.message);
      } else {
        setFormError("We couldn't unblock this claim. Please try again.");
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
      size="lg"
      title={
        claim ? `Resolve SoD block on '${claim.title}'?` : ""
      }
      description={
        claim
          ? `${claim.reference} · held by the segregation-of-duties check`
          : undefined
      }
      icon={
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Unlock}
            loading={submitting}
            disabled={!canSubmit}
            onClick={submit}
          >
            Resolve &amp; re-route
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {claim?.blockedReason && (
          <div className="rounded-xl bg-error-container/60 px-4 py-3 text-sm">
            <p className="font-semibold text-on-surface">Block reason</p>
            <p className="mt-0.5 text-on-surface-variant">{claim.blockedReason}</p>
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-on-surface">
            Resolution action
          </legend>
          <div className="space-y-2">
            <ActionCard
              name={`sod-action-${claim?.id ?? "none"}`}
              checked={action === "assign_manager"}
              onChange={() => setAction("assign_manager")}
              label={`Assign manager to ${submitterName}`}
              detail="Gives the submitter a manager so the route's manager step can resolve."
            />
            <ActionCard
              name={`sod-action-${claim?.id ?? "none"}`}
              checked={action === "reassign_step"}
              onChange={() => setAction("reassign_step")}
              label="Reassign this step's approver"
              detail="Repoints one approval step to a different approver."
            />
          </div>
        </fieldset>

        {action === "assign_manager" ? (
          approverOptions.length > 0 ? (
            <Select
              label="New manager"
              required
              options={approverOptions}
              value={managerId}
              onChange={setManagerId}
              placeholder="Select an approver…"
              helper={`Re-routes the claim under ${submitterName}'s new manager.`}
            />
          ) : (
            <div
              role="status"
              className="rounded-xl bg-surface-container-high px-4 py-6 text-center text-sm text-on-surface-variant"
            >
              No active approvers available. Add an Approver user first.
            </div>
          )
        ) : (
          <div className="space-y-4">
            {stepOptions.length > 0 ? (
              <Select
                label="Step to reassign"
                required
                options={stepOptions}
                value={stepId}
                onChange={setStepId}
                placeholder="Select a step…"
                helper="The step's current approver is replaced by the new approver."
              />
            ) : (
              <div
                role="status"
                className="rounded-xl bg-surface-container-high px-4 py-6 text-center text-sm text-on-surface-variant"
              >
                No route steps are available for this claim.
              </div>
            )}
            {approverOptions.length > 0 ? (
              <Select
                label="New approver"
                required
                options={approverOptions}
                value={newApproverId}
                onChange={setNewApproverId}
                placeholder="Select an approver…"
              />
            ) : (
              <div
                role="status"
                className="rounded-xl bg-surface-container-high px-4 py-6 text-center text-sm text-on-surface-variant"
              >
                No active approvers available. Add an Approver user first.
              </div>
            )}
          </div>
        )}

        <TextArea
          label="Resolution reason"
          required
          helper="Required for audit"
          placeholder="e.g. Assigning a manager so the route can resolve — the submitter has none."
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />

        {formError && <FormErrorBanner message={formError} />}
      </div>
    </Dialog>
  );
}

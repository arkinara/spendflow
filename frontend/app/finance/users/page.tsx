"use client";

/* ============================================================================
 * SpendFlow — /finance/users (ticket #30).
 *
 * Finance-Admin user directory: lists every user (name, email, role, manager,
 * department) and supports role changes + manager assignment through typed
 * dialogs. Reads/writes exclusively through `lib/api/users.ts` (BE #14). A BE
 * 403 maps to the same access-denied panel `RouteGuard` shows for a role
 * mismatch (the `denied` state of `useUsers`).
 *
 * #32: adds a checkbox column + top toolbar so a Finance Admin can pick 2+
 * users and bulk-change their role in one action. The bulk action loops
 * `changeUserRole` sequentially (no BE bulk endpoint yet) and surfaces a
 * partial failure inline with the failing user ids.
 *
 * #33: adds a per-row Deactivate/Reactivate action + a status chip (green
 * Active / grey Inactive). Deactivation is a soft flag (`status: "disabled"`)
 * flipped optimistically in the `useUsers` cache — the BE has no deactivate
 * endpoint yet, so the status rides the role PATCH and isn't persisted server
 * side. Self-deactivation and deactivating the last active Finance Admin are
 * blocked client-side (defense in depth; the BE rejects too once it lands).
 * ========================================================================== */

import * as React from "react";
import {
  ShieldCheck,
  UserRound,
  ShieldX,
  AlertTriangle,
  RefreshCw,
  Users as UsersIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { StatusChip } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSnackbar } from "@/components/ui/Snackbar";
import { useRole } from "@/lib/auth/session";
import { useUsers } from "@/lib/hooks/useUsers";
import {
  changeUserRole,
  setUserManager,
  UsersApiError,
  BulkPartialFailureError,
  type BackendUser,
} from "@/lib/api/users";
import type { Role } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee",
  approver: "Approver",
  finance: "Finance Admin",
};

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "employee", label: "Employee" },
  { value: "approver", label: "Approver" },
  { value: "finance", label: "Finance Admin" },
];

/** Target of the deactivate/reactivate confirm dialog (#33). */
export type StatusAction = "deactivate" | "reactivate";
export interface StatusTarget {
  user: BackendUser;
  action: StatusAction;
}

export default function UsersAdminPage() {
  const [roleTarget, setRoleTarget] = React.useState<BackendUser | null>(null);
  const [managerTarget, setManagerTarget] = React.useState<BackendUser | null>(null);
  const [denied, setDenied] = React.useState(false);
  const onForbidden = React.useCallback(() => setDenied(true), []);

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">User directory</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Manage user roles and reporting lines. Changes are read from and written to the live backend.
          </p>
        </div>

        {denied ? (
          <UsersForbidden />
        ) : (
          <>
            <SegmentedTabs<"users">
              value="users"
              onChange={() => {}}
              ariaLabel="Admin section"
              options={[{ value: "users", label: "Users" }]}
            />
            <UsersTab
              onForbidden={onForbidden}
              roleTarget={roleTarget}
              managerTarget={managerTarget}
              setRoleTarget={setRoleTarget}
              setManagerTarget={setManagerTarget}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

/* ============================================================ shared states == */

function UsersForbidden() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container px-6 py-10 text-center"
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
        <ShieldX className="h-6 w-6" strokeWidth={1.75} aria-hidden />
      </span>
      <p className="font-medium text-on-surface">You&apos;re not authorized to manage users.</p>
      <p className="text-sm text-on-surface-variant">
        Your session no longer has Finance Admin access. Reload the page or sign in again.
      </p>
    </div>
  );
}

function UsersError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card padded={false}>
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <div>
          <p className="font-medium text-on-surface">Couldn&apos;t load the user directory</p>
          <p className="mt-1 max-w-sm text-sm text-on-surface-variant">{message}</p>
        </div>
        <Button variant="tonal" icon={RefreshCw} size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

function FormErrorBanner({ message }: { message: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-error-container px-3 py-2 text-sm text-error-container-foreground"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1.5">{message}</div>
    </div>
  );
}

function RolePill({ role }: { role: Role }) {
  const tones: Record<Role, string> = {
    employee: "bg-surface-container-high text-on-surface-variant",
    approver: "bg-secondary-container text-secondary-container-foreground",
    finance: "bg-primary/15 text-primary",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tones[role]}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

/* =================================================================== tab == */

function UsersTab({
  onForbidden,
  roleTarget,
  managerTarget,
  setRoleTarget,
  setManagerTarget,
}: {
  onForbidden: () => void;
  roleTarget: BackendUser | null;
  managerTarget: BackendUser | null;
  setRoleTarget: (u: BackendUser | null) => void;
  setManagerTarget: (u: BackendUser | null) => void;
}) {
  const { show } = useSnackbar();
  const { user: currentUser } = useRole();
  const { state, retry, refresh, bulkChangeRole, deactivate, reactivate } = useUsers();

  React.useEffect(() => {
    if (state.status === "denied") onForbidden();
  }, [state.status, onForbidden]);

  const rows = state.status === "ready" ? state.rows : [];
  const nameById = React.useMemo(
    () => new Map(rows.map((u) => [u.id, u.name])),
    [rows]
  );

  // #33: per-row deactivate/reactivate target + guard rails.
  const [statusTarget, setStatusTarget] = React.useState<StatusTarget | null>(null);

  const activeFinanceCount = React.useMemo(
    () => rows.filter((u) => u.role === "finance" && u.status === "active").length,
    [rows]
  );

  /** True when `u` must keep its Deactivate button disabled: the signed-in
   *  Finance Admin (can't disable yourself) or the last active Finance Admin
   *  (would lock the company out of Finance). */
  const canDeactivate = (u: BackendUser) =>
    u.id !== currentUser.id &&
    !(u.role === "finance" && u.status === "active" && activeFinanceCount <= 1);

  async function handleStatusSaved(target: BackendUser, action: StatusAction) {
    if (action === "deactivate") {
      await deactivate(target.id);
      show(`${target.name} deactivated.`, { tone: "success" });
    } else {
      await reactivate(target.id);
      show(`${target.name} reactivated.`, { tone: "success" });
    }
    setStatusTarget(null);
  }

  /* ---------------------------------------------- bulk selection (select all) */

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const toggleSelected = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = React.useCallback(() => setSelectedIds(new Set()), []);

  // "Select all" only ever selects the currently-filtered rows.
  const allVisibleSelected =
    rows.length > 0 && rows.every((u) => selectedIds.has(u.id));
  const someVisibleSelected =
    rows.some((u) => selectedIds.has(u.id)) && !allVisibleSelected;

  const toggleSelectVisible = React.useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        rows.forEach((u) => next.delete(u.id));
      } else {
        rows.forEach((u) => next.add(u.id));
      }
      return next;
    });
  }, [rows, allVisibleSelected]);

  const selectedCount = selectedIds.size;

  async function handleBulkSaved(newRole: Role) {
    const ids = Array.from(selectedIds);
    await bulkChangeRole(ids, newRole);
    show(`${ids.length} users changed to ${ROLE_LABEL[newRole]}`, { tone: "success" });
    setBulkOpen(false);
    clearSelection();
  }

  async function handleRoleSaved(target: BackendUser, newRole: Role) {
    await changeUserRole(target.id, newRole);
    show(`Role for ${target.name} changed to ${ROLE_LABEL[newRole]}.`, { tone: "success" });
    setRoleTarget(null);
    refresh();
  }

  async function handleManagerSaved(target: BackendUser, managerId: string | null) {
    await setUserManager(target.id, managerId);
    show(
      managerId
        ? `Manager for ${target.name} set to ${nameById.get(managerId) ?? "a user"}.`
        : `Manager for ${target.name} cleared.`,
      { tone: "success" }
    );
    setManagerTarget(null);
    refresh();
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-on-surface-variant">
        Everyone in the company directory, with the role and manager the approval engine uses for routing.
      </p>

      {state.status === "loading" && (
        <Card padded={false}>
          <div className="p-4">
            <Skeleton variant="list" lines={4} />
          </div>
        </Card>
      )}
      {state.status === "error" && <UsersError message={state.message} onRetry={retry} />}
      {state.status === "ready" && rows.length === 0 && (
        <Card padded={false}>
          <EmptyState
            icon={UsersIcon}
            title="No users yet"
            body="The directory is empty. Users appear here once they are provisioned."
          />
        </Card>
      )}
      {state.status === "ready" && rows.length > 0 && (
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant px-5 py-3">
            <p className="text-sm text-on-surface-variant">
              {selectedCount > 0 ? (
                <>
                  <span className="font-medium text-on-surface">{selectedCount}</span> selected
                </>
              ) : (
                "Pick users below to bulk-change their role."
              )}
            </p>
            <Button
              variant="tonal"
              size="sm"
              icon={ShieldCheck}
              disabled={selectedCount < 2}
              onClick={() => setBulkOpen(true)}
            >
              {selectedCount > 0 ? `Bulk change role (${selectedCount})` : "Bulk change role"}
            </Button>
          </div>
          <DataTable
            headerCheckbox={{
              label: "Select all users",
              checked: allVisibleSelected,
              indeterminate: someVisibleSelected,
              onChange: toggleSelectVisible,
            }}
            rowCheckbox={(u) => (
              <input
                type="checkbox"
                aria-label={`Select ${u.name}`}
                checked={selectedIds.has(u.id)}
                onChange={() => toggleSelected(u.id)}
                className="h-4 w-4 cursor-pointer accent-primary"
              />
            )}
            columns={[
              {
                key: "name",
                header: "Name",
                sortable: true,
                sortValue: (u) => u.name,
                render: (u) => <p className="font-medium text-on-surface">{u.name}</p>,
              },
              {
                key: "email",
                header: "Email",
                sortable: true,
                sortValue: (u) => u.email,
                render: (u) => <p className="text-sm text-on-surface-variant">{u.email}</p>,
              },
              {
                key: "role",
                header: "Role",
                sortable: true,
                sortValue: (u) => u.role,
                render: (u) => <RolePill role={u.role} />,
              },
              {
                key: "status",
                header: "Status",
                sortable: true,
                sortValue: (u) => u.status,
                render: (u) => <StatusChip status={u.status} size="sm" />,
              },
              {
                key: "manager",
                header: "Manager",
                sortable: true,
                sortValue: (u) => (u.managerId ? nameById.get(u.managerId) ?? "" : ""),
                render: (u) => (
                  <p className="text-sm text-on-surface">
                    {u.managerId ? nameById.get(u.managerId) ?? "—" : "—"}
                  </p>
                ),
              },
              {
                key: "department",
                header: "Department",
                sortable: true,
                sortValue: (u) => u.department ?? "",
                render: (u) => (
                  <p className="text-sm text-on-surface-variant">{u.department ?? "—"}</p>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (u) => (
                  <div className="flex justify-end gap-2">
                    {u.status === "active" ? (
                      <Button
                        variant="text"
                        size="sm"
                        icon={ShieldX}
                        disabled={!canDeactivate(u)}
                        onClick={() => setStatusTarget({ user: u, action: "deactivate" })}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="text"
                        size="sm"
                        icon={ShieldCheck}
                        onClick={() => setStatusTarget({ user: u, action: "reactivate" })}
                      >
                        Reactivate
                      </Button>
                    )}
                    <Button
                      variant="text"
                      size="sm"
                      icon={ShieldCheck}
                      onClick={() => setRoleTarget(u)}
                    >
                      Change role
                    </Button>
                    <Button
                      variant="text"
                      size="sm"
                      icon={UserRound}
                      onClick={() => setManagerTarget(u)}
                    >
                      Set manager
                    </Button>
                  </div>
                ),
              },
            ]}
            data={rows}
            rowKey={(u) => u.id}
            density="compact"
            caption="User directory"
          />
        </Card>
      )}

      <RoleChangeDialog
        open={roleTarget !== null}
        target={roleTarget}
        onClose={() => setRoleTarget(null)}
        onSaved={handleRoleSaved}
        onForbidden={onForbidden}
      />

      <SetManagerDialog
        open={managerTarget !== null}
        target={managerTarget}
        users={rows}
        onClose={() => setManagerTarget(null)}
        onSaved={handleManagerSaved}
        onForbidden={onForbidden}
      />

      <BulkChangeRoleDialog
        open={bulkOpen}
        count={selectedCount}
        onClose={() => setBulkOpen(false)}
        onSaved={handleBulkSaved}
        onForbidden={onForbidden}
      />

      <StatusChangeDialog
        open={statusTarget !== null}
        target={statusTarget?.user ?? null}
        action={statusTarget?.action ?? "deactivate"}
        onClose={() => setStatusTarget(null)}
        onSaved={handleStatusSaved}
        onForbidden={onForbidden}
      />
    </div>
  );
}

/* ==================================================== deactivate/reactivate == */

function StatusChangeDialog({
  open,
  target,
  action,
  onClose,
  onSaved,
  onForbidden,
}: {
  open: boolean;
  target: BackendUser | null;
  action: StatusAction;
  onClose: () => void;
  onSaved: (target: BackendUser, action: StatusAction) => Promise<void>;
  onForbidden: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setReason("");
      setFormError(null);
      setSubmitting(false);
    }
  }, [open]);

  const verb = action === "deactivate" ? "Deactivate" : "Reactivate";
  const impact = target
    ? action === "deactivate"
      ? `${target.name} can no longer sign in. Their claims and approvals are preserved.`
      : `${target.name} can sign in again. Their claims and approvals are preserved.`
    : "";

  async function submit() {
    if (!target) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await onSaved(target, action);
    } catch (err) {
      if (err instanceof UsersApiError && err.status === 403) {
        onForbidden();
        return;
      }
      setFormError(
        err instanceof Error
          ? err.message
          : `Could not ${verb.toLowerCase()} this user. Check your connection and try again.`
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={target ? `${verb} ${target.name}` : verb}
      description={impact}
      icon={
        <span
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${
            action === "deactivate"
              ? "bg-error-container text-error-container-foreground"
              : "bg-primary/15 text-primary"
          }`}
        >
          {action === "deactivate" ? (
            <ShieldX className="h-6 w-6" strokeWidth={1.75} aria-hidden />
          ) : (
            <ShieldCheck className="h-6 w-6" strokeWidth={1.75} aria-hidden />
          )}
        </span>
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? `${verb}ing…` : target ? `${verb} ${target.name}` : verb}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <FormErrorBanner message={formError} />}
        <TextArea
          label="Reason (optional)"
          placeholder={
            action === "deactivate"
              ? "Why is this user being deactivated?"
              : "Why is this user being reactivated?"
          }
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          helper="Not sent to the backend yet — captured here for the audit trail in a future release."
        />
      </div>
    </Dialog>
  );
}

/* ====================================================== bulk role dialog == */

function BulkChangeRoleDialog({
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

/* ====================================================== role change dialog == */

function RoleChangeDialog({
  open,
  target,
  onClose,
  onSaved,
  onForbidden,
}: {
  open: boolean;
  target: BackendUser | null;
  onClose: () => void;
  onSaved: (target: BackendUser, newRole: Role) => Promise<void>;
  onForbidden: () => void;
}) {
  const [role, setRole] = React.useState<Role>("employee");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open && target) {
      setRole(target.role);
      setFormError(null);
      setSubmitting(false);
    }
  }, [open, target]);

  async function submit() {
    if (!target) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await onSaved(target, role);
    } catch (err) {
      if (err instanceof UsersApiError && err.status === 403) {
        onForbidden();
        return;
      }
      setFormError(
        err instanceof Error ? err.message : "Could not change the role. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change role"
      description={
        target
          ? `Change ${target.name}'s role. Their current role is ${ROLE_LABEL[target.role]}.`
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

/* ====================================================== set manager dialog == */

function SetManagerDialog({
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

  const options = React.useMemo(() => {
    const list = users
      .filter((u) => u.id !== target?.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => ({ value: u.id, label: u.name }));
    return [{ value: "", label: "No manager (clear)" }, ...list];
  }, [users, target]);

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
        <Select
          label="Manager"
          required
          options={options}
          value={managerId}
          onChange={setManagerId}
          placeholder="Select a manager…"
        />
      </div>
    </Dialog>
  );
}

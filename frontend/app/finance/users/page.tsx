"use client";

/* ============================================================================
 * SpendFlow — /finance/users (ticket #30).
 *
 * Finance-Admin user directory: lists every user (name, email, role, manager,
 * department) and supports role changes + manager assignment through typed
 * dialogs. Reads/writes exclusively through `lib/api/users.ts` (BE #14). A BE
 * 403 maps to the same access-denied panel `RouteGuard` shows for a role
 * mismatch (the `denied` state of `useUsers`).
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
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSnackbar } from "@/components/ui/Snackbar";
import { useUsers } from "@/lib/hooks/useUsers";
import {
  changeUserRole,
  setUserManager,
  UsersApiError,
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

function FormErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-xl bg-error-container px-3 py-2 text-sm text-error-container-foreground"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {message}
    </p>
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
  const { state, retry, refresh } = useUsers();

  React.useEffect(() => {
    if (state.status === "denied") onForbidden();
  }, [state.status, onForbidden]);

  const rows = state.status === "ready" ? state.rows : [];
  const nameById = React.useMemo(
    () => new Map(rows.map((u) => [u.id, u.name])),
    [rows]
  );

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
          <DataTable
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
    </div>
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

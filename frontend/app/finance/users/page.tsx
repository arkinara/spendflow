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
 *  #33: adds a per-row Deactivate/Reactivate action + a status chip (green
 *  Active / grey Inactive). Deactivation is a soft flag (`status: "disabled"`)
 *  flipped optimistically in the `useUsers` cache — the BE has no deactivate
 *  endpoint yet, so the status rides the role PATCH and isn't persisted server
 *  side. Self-deactivation and deactivating the last active Finance Admin are
 *  blocked client-side (defense in depth; the BE rejects too once it lands).
 *
 *  #35: adds a debounced name/email search input + role filter chips above the
 *  table. Both compose with AND semantics and mirror the query string
 *  (`?q=...&role=finance`) so a filtered view is shareable. Filtering is
 *  purely client-side after the list loads (no BE round-trip per keystroke).
 *
 *  #43: adds a per-row "Delete permanently" action (pending/disabled rows only)
 *  gated by a password re-auth confirm dialog. Deactivate is now rendered in
 *  the error tone so it reads distinct from Reactivate. The delete is BE-enforced
 *  (POST /api/admin/users/:id/delete); the FE just never offers it on active rows.
 *  ========================================================================== */

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  UserRound,
  UserPlus,
  ShieldX,
  AlertTriangle,
  RefreshCw,
  Users as UsersIcon,
  Search,
  FilterX,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { StatusChip } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { FormErrorBanner } from "@/components/ui/FormErrorBanner";
import { useSnackbar } from "@/components/ui/Snackbar";
import { useRole } from "@/lib/auth/session";
import { useUsers } from "@/lib/hooks/useUsers";
import {
  changeUserRoles,
  setUserManager,
  UsersApiError,
  type BackendUser,
} from "@/lib/api/users";
import type { Role } from "@/lib/types";
import { DeleteUserDialog } from "@/app/finance/users/DeleteUserDialog";
import { AddUserDialog } from "@/app/finance/users/AddUserDialog";
import { SetManagerDialog } from "@/app/finance/users/SetManagerDialog";
import { RoleChangeDialog } from "@/app/finance/users/RoleChangeDialog";
import { BulkRoleChangeDialog } from "@/app/finance/users/BulkRoleChangeDialog";
import { UsersAuditPanel } from "@/app/finance/users/UsersAuditPanel";

const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee",
  approver: "Approver",
  finance: "Finance Admin",
};

/* ---------------------------------------------------------- search/filter (#35) */

/** Role filter value: a concrete role, or `"all"` for no role filter. */
export type RoleFilter = Role | "all";

/** Valid role chip values (the "All" chip is the default). */
const ROLE_FILTER_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "employee", label: "Employee" },
  { value: "approver", label: "Approver" },
  { value: "finance", label: "Finance" },
];

/** Graceful fallback for an invalid `?role=` value → "all" (no filter). */
function parseRole(value: string | null): RoleFilter {
  return value === "employee" || value === "approver" || value === "finance"
    ? value
    : "all";
}

/** Canonical `?q=&role=` query string for a filter state (empty when unset). */
function filterQueryString(q: string, role: RoleFilter): string {
  const params = new URLSearchParams();
  const trimmed = q.trim();
  if (trimmed) params.set("q", trimmed);
  if (role !== "all") params.set("role", role);
  return params.toString();
}

/** Target of the deactivate/reactivate confirm dialog (#33). */
export type StatusAction = "deactivate" | "reactivate";
export interface StatusTarget {
  user: BackendUser;
  action: StatusAction;
}

/**
 * `/finance/users` reads `useSearchParams` for URL-state restoration (#35),
 * which requires a Suspense boundary in the Next 14 app router.
 */
export default function UsersAdminPage() {
  return (
    <React.Suspense fallback={null}>
      <UsersAdminPageInner />
    </React.Suspense>
  );
}

function UsersAdminPageInner() {
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

/** Row display for a user's full role set (#53). `BackendUser.roles` is
 *  optional on the wire type (the BE emits it from #44 onward; older mocks
 *  only carry `role`), so it falls back to the single-role compat field.
 *  Multi-role users render one chip per role; single-role users render the
 *  same pill as before. */
function RolesCell({ user }: { user: BackendUser }) {
  const roles = user.roles ?? [user.role];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {roles.map((r) => (
        <RolePill key={r} role={r} />
      ))}
    </div>
  );
}

/* =============================================== recent activity audit (#34) */
/* UsersAuditPanel + AuditEntryRow extracted to their own file in #61 (#54c). */

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
  const {
    state,
    retry,
    refresh,
    bulkChangeRole,
    deactivate,
    reactivate,
    createUser,
    deleteUser,
  } = useUsers();

  /* --------------------------------------------------------- add user (#36) */

  const [addOpen, setAddOpen] = React.useState(false);

  function handleUserCreated(email: string) {
    setAddOpen(false);
    show(`Invitation sent to ${email}`, { tone: "success" });
  }

  /* ------------------------------------------------ search + role filter (#35) */

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Seed filter state from the URL once on mount (shareable filtered views).
  const [searchInput, setSearchInput] = React.useState(
    () => searchParams.get("q") ?? ""
  );
  const [roleFilter, setRoleFilter] = React.useState<RoleFilter>(() =>
    parseRole(searchParams.get("role"))
  );

  // The input reflects every keystroke; the *filtered list* only catches up
  // after a 200ms pause, so the table doesn't re-render on each key.
  const [debouncedQuery, setDebouncedQuery] = React.useState(searchInput);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(searchInput), 200);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // Canonical query string already in the URL (drives the URL→state no-op and
  // keeps the state→URL effect from firing on unrelated re-renders).
  const urlCanonical = React.useMemo(
    () =>
      filterQueryString(
        searchParams.get("q") ?? "",
        parseRole(searchParams.get("role"))
      ),
    [searchParams]
  );

  // State → URL (debounced 200ms; best-effort mirror, never scrolls).
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      const qs = filterQueryString(searchInput, roleFilter);
      if (qs === urlCanonical) return;
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 200);
    return () => window.clearTimeout(t);
  }, [searchInput, roleFilter, urlCanonical, router, pathname]);

  const clearFilters = React.useCallback(() => {
    setSearchInput("");
    setRoleFilter("all");
  }, []);

  const hasActiveFilters = roleFilter !== "all" || debouncedQuery.trim() !== "";

  React.useEffect(() => {
    if (state.status === "denied") onForbidden();
  }, [state.status, onForbidden]);

  const rows = state.status === "ready" ? state.rows : [];

  // Search (name/email substring, case-insensitive) AND role filter compose.
  const filteredRows = React.useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return rows.filter((u) => {
      const matchesRole = roleFilter === "all" || u.role === roleFilter;
      const matchesQuery =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q);
      return matchesRole && matchesQuery;
    });
  }, [rows, debouncedQuery, roleFilter]);

  const nameById = React.useMemo(
    () => new Map(rows.map((u) => [u.id, u.name])),
    [rows]
  );

  // #33: per-row deactivate/reactivate target + guard rails.
  const [statusTarget, setStatusTarget] = React.useState<StatusTarget | null>(null);

  // #43: per-row hard-delete target (password re-auth confirm dialog).
  const [deleteTarget, setDeleteTarget] = React.useState<BackendUser | null>(null);

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

  async function handleDeleteSaved(target: BackendUser, password: string) {
    await deleteUser(target.id, password);
    show(`${target.name} deleted permanently`, { tone: "success" });
    setDeleteTarget(null);
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
    filteredRows.length > 0 && filteredRows.every((u) => selectedIds.has(u.id));
  const someVisibleSelected =
    filteredRows.some((u) => selectedIds.has(u.id)) && !allVisibleSelected;

  const toggleSelectVisible = React.useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredRows.forEach((u) => next.delete(u.id));
      } else {
        filteredRows.forEach((u) => next.add(u.id));
      }
      return next;
    });
  }, [filteredRows, allVisibleSelected]);

  const selectedCount = selectedIds.size;

  async function handleBulkSaved(newRole: Role) {
    const ids = Array.from(selectedIds);
    await bulkChangeRole(ids, newRole);
    show(`${ids.length} users changed to ${ROLE_LABEL[newRole]}`, { tone: "success" });
    setBulkOpen(false);
    clearSelection();
  }

  async function handleRoleSaved(
    target: BackendUser,
    newRoles: Role[],
    password: string,
  ) {
    // #64: forward the actor's re-auth password so the BE can verify it
    // before the destructive role change.
    await changeUserRoles(target.id, newRoles, "active", password);
    show(
      `Roles for ${target.name} changed to ${newRoles.map((r) => ROLE_LABEL[r]).join(", ")}.`,
      { tone: "success" }
    );
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
          {/* #35: debounced search + role filter chips (client-side). */}
          <div className="space-y-3 border-b border-outline-variant px-5 py-4">
            <TextField
              iconLeft={Search}
              label="Search users"
              placeholder="Search by name or email"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              helper="Filters by name or email. Results update after a short pause."
              containerClassName="max-w-md"
            />
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedTabs<RoleFilter>
                ariaLabel="Filter users by role"
                options={ROLE_FILTER_OPTIONS}
                value={roleFilter}
                onChange={setRoleFilter}
                size="sm"
              />
              {hasActiveFilters && (
                <Button
                  variant="text"
                  size="sm"
                  icon={FilterX}
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              )}
            </div>
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {filteredRows.length === 0
                ? "No users match your filters."
                : `Showing ${filteredRows.length} of ${rows.length} users.`}
            </p>
          </div>

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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="filled"
                size="sm"
                icon={UserPlus}
                onClick={() => setAddOpen(true)}
              >
                Add User
              </Button>
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
          </div>

          {filteredRows.length === 0 ? (
            <EmptyState
              icon={FilterX}
              title="No matching users"
              body="No users match your search or role filter. Try clearing them."
              variant="compact"
              action={
                <Button variant="outlined" icon={FilterX} onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
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
                render: (u) => <RolesCell user={u} />,
              },
              {
                key: "status",
                header: "Status",
                sortable: true,
                sortValue: (u) => u.status,
                render: (u) => <StatusChip userStatus={u.status} size="sm" />,
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
                    {u.status === "disabled" ? (
                      <Button
                        variant="text"
                        size="sm"
                        icon={ShieldCheck}
                        onClick={() => setStatusTarget({ user: u, action: "reactivate" })}
                      >
                        Reactivate
                      </Button>
                    ) : (
                      <Button
                        variant="text"
                        size="sm"
                        icon={ShieldX}
                        className="text-error hover:bg-error/10"
                        aria-label={`Deactivate ${u.name} (soft disable)`}
                        disabled={!canDeactivate(u)}
                        onClick={() => setStatusTarget({ user: u, action: "deactivate" })}
                      >
                        Deactivate
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
                    {u.role === "employee" && (
                      <Button
                        variant="text"
                        size="sm"
                        icon={UserRound}
                        onClick={() => setManagerTarget(u)}
                      >
                        Set manager
                      </Button>
                    )}
                    {u.status === "active" ? (
                      <span title="Activate the user first to use this">
                        <Button
                          variant="danger"
                          size="sm"
                          icon={Trash2}
                          aria-label={`Delete ${u.name} permanently`}
                          disabled
                        >
                          Delete
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="danger"
                        size="sm"
                        icon={Trash2}
                        aria-label={`Delete ${u.name} permanently`}
                        onClick={() => setDeleteTarget(u)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
            data={filteredRows}
            rowKey={(u) => u.id}
            density="compact"
            caption="User directory"
          />
          )}
        </Card>
      )}

      {state.status === "ready" && (
        <UsersAuditPanel users={rows} onForbidden={onForbidden} />
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

      <BulkRoleChangeDialog
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

      <DeleteUserDialog
        open={deleteTarget !== null}
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onSaved={handleDeleteSaved}
        onForbidden={onForbidden}
      />

      <AddUserDialog
        open={addOpen}
        users={rows}
        currentUserId={currentUser.id}
        createUser={createUser}
        onClose={() => setAddOpen(false)}
        onCreated={handleUserCreated}
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
/* BulkRoleChangeDialog extracted to its own file in #61 (#54c). */



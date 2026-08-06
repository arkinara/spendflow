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
 *  ========================================================================== */

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  UserRound,
  ShieldX,
  AlertTriangle,
  RefreshCw,
  Users as UsersIcon,
  History,
  ChevronDown,
  Search,
  FilterX,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { StatusChip } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSnackbar } from "@/components/ui/Snackbar";
import { useRole } from "@/lib/auth/session";
import { useUsers, useUserAudit } from "@/lib/hooks/useUsers";
import {
  changeUserRole,
  setUserManager,
  UsersApiError,
  BulkPartialFailureError,
  type BackendUser,
} from "@/lib/api/users";
import type { Role, UserAuditEntry } from "@/lib/types";
import { formatRelativeTime } from "@/lib/format";

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

/* =============================================== recent activity audit (#34) */

/** Humanized labels for the admin actions the BE records (#34). */
const ACTION_LABEL: Record<string, string> = {
  "role.change": "Role change",
  "manager.change": "Manager change",
  "status.change": "Status change",
};

/** Fallback humanizer for action codes without a known label, e.g.
 *  `"manager.clear"` → "Manager clear". */
function humanizeAction(action: string): string {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  return action
    .split(".")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Collapsible "Recent activity" section (#34). Collapsed by default — the
 *  audit fan-out is deferred until the Finance Admin expands it, so the common
 *  path makes no extra network calls. Read-only: no edit, no delete, no
 *  rollback. `users` is the currently-rendered directory (used to resolve
 *  actor + target names and to derive the userIds fan-out set). */
function RecentActivitySection({
  users,
  onForbidden,
}: {
  users: BackendUser[];
  onForbidden: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const userIds = React.useMemo(() => users.map((u) => u.id), [users]);
  const filters = expanded ? { userIds, limit: 50 } : null;
  const { state, refresh } = useUserAudit(filters);

  const userById = React.useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );

  // A BE 403 on the audit fan-out flips the whole page to the denied panel,
  // matching how `useUsers` handles a lost Finance-Admin session.
  React.useEffect(() => {
    if (state.status === "denied") onForbidden();
  }, [state.status, onForbidden]);

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant px-5 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="recent-activity-panel"
          className="flex items-center gap-2 text-sm font-semibold text-on-surface transition-colors hover:text-primary"
        >
          <History className="h-4 w-4 text-on-surface-variant" strokeWidth={1.75} aria-hidden />
          Recent activity
          <ChevronDown
            className={`h-4 w-4 text-on-surface-variant transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
        {expanded && (
          <Button variant="text" size="sm" icon={RefreshCw} onClick={refresh}>
            Refresh
          </Button>
        )}
      </div>

      {expanded && (
        <div id="recent-activity-panel" role="region" aria-label="Recent activity" className="p-5">
          {state.status === "loading" && (
            <div aria-busy="true" role="status" aria-label="Loading recent activity">
              <Skeleton variant="list" lines={3} />
            </div>
          )}
          {state.status === "error" && (
            <div
              role="alert"
              className="flex flex-col items-center gap-3 px-4 py-10 text-center sm:flex-row sm:gap-6 sm:text-left"
            >
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error-container text-error-container-foreground">
                <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-on-surface">Couldn&apos;t load recent activity</p>
                <p className="mt-1 text-sm text-on-surface-variant">{state.message}</p>
              </div>
              <Button variant="tonal" size="sm" icon={RefreshCw} onClick={refresh}>
                Retry
              </Button>
            </div>
          )}
          {state.status === "ready" && state.entries.length === 0 && (
            <EmptyState
              icon={History}
              title="No admin activity yet"
              body="Role, manager, and status changes on the user directory will be recorded here."
              variant="compact"
            />
          )}
          {state.status === "ready" && state.entries.length > 0 && (
            <ul className="space-y-2">
              {state.entries.map((entry) => (
                <AuditEntryRow key={entry.id} entry={entry} userById={userById} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

/** One audit entry: action label, actor (name · email), target user, a
 *  before → after JSON toggle, and a relative timestamp. Read-only. */
function AuditEntryRow({
  entry,
  userById,
}: {
  entry: UserAuditEntry;
  userById: Map<string, BackendUser>;
}) {
  const [showChanges, setShowChanges] = React.useState(false);

  const actor = userById.get(entry.actorId);
  const target = userById.get(entry.entityId);
  const hasChanges = entry.before != null || entry.after != null;

  return (
    <li className="rounded-xl border border-outline-variant bg-surface-container px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-on-surface">{humanizeAction(entry.action)}</p>
        <time className="text-xs text-on-surface-variant">
          {formatRelativeTime(entry.createdAt)}
        </time>
      </div>
      <p className="mt-0.5 text-xs text-on-surface-variant">
        {actor ? (
          <>
            <span className="font-medium text-on-surface">{actor.name}</span> · {actor.email}
          </>
        ) : (
          <span className="font-mono">{entry.actorId}</span>
        )}
        {" on "}
        <span className="font-medium text-on-surface">{target?.name ?? entry.entityId}</span>
      </p>
      {hasChanges && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowChanges((v) => !v)}
            aria-expanded={showChanges}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                showChanges ? "rotate-180" : ""
              }`}
              strokeWidth={1.75}
              aria-hidden
            />
            {showChanges ? "Hide changes" : "Show changes"}
          </button>
          {showChanges && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <ChangeBlock label="Before" value={entry.before} />
              <ChangeBlock label="After" value={entry.after} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ChangeBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg bg-surface-container-high px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
        {label}
      </p>
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-on-surface">
        {value === null || value === undefined ? "null" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
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
            data={filteredRows}
            rowKey={(u) => u.id}
            density="compact"
            caption="User directory"
          />
          )}
        </Card>
      )}

      {state.status === "ready" && (
        <RecentActivitySection users={rows} onForbidden={onForbidden} />
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

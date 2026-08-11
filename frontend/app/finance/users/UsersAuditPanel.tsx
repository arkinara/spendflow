"use client";

/* ============================================================================
 * SpendFlow — UsersAuditPanel (#61, extracted from page.tsx in #54c).
 *
 * Collapsible "Recent activity" section on `/finance/users`. Renders the
 * directory-wide admin audit timeline (role / manager / status changes) by
 * fanning out `GET /api/admin/users/:id/audit` per user via `useUserAudit`
 * (#34). Read-only: no edit, no delete, no rollback.
 *
 * Collapsed by default — the audit fan-out is deferred until the Finance
 * Admin expands it, so the common path makes no extra network calls. A BE
 * 403 on the fan-out flips the whole page to the access-denied panel via
 * `onForbidden` (matches how `useUsers` handles a lost Finance-Admin session).
 * ========================================================================== */

import * as React from "react";
import { AlertTriangle, ChevronDown, History, RefreshCw, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useUserAudit } from "@/lib/hooks/useUsers";
import type { BackendUser } from "@/lib/api/users";
import { AuditEntryRow } from "@/components/admin/AuditEntryRow";

/**
 * Collapsible "Recent activity" panel. Collapsed by default — the audit
 * fan-out is deferred until the Finance Admin expands it, so the common path
 * makes no extra network calls. Read-only: no edit, no delete, no rollback.
 * `users` is the currently-rendered directory (used to resolve actor +
 * target names and to derive the userIds fan-out set).
 */
export function UsersAuditPanel({
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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="text" size="sm" icon={RefreshCw} onClick={refresh}>
              Refresh
            </Button>
            {/* #71: deep-link to the system-wide audit viewer. */}
            <Link
              href="/finance/audit"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
            >
              See all
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </Link>
          </div>
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

export default UsersAuditPanel;

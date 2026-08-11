"use client";

/* ============================================================================
 * SpendFlow — AuditEntryRow (#61 originally, extracted in #71).
 *
 * One audit entry rendered as a list-row: action label, actor (name · email),
 * target user, an optional before → after JSON toggle, and a relative
 * timestamp. Read-only — never mutates state. Shared between the per-user
 * `UsersAuditPanel` (#61) and the global `/finance/audit` page (#71).
 *
 * `userById` resolves both `actorId` and `entityId` to a `BackendUser`. The
 * caller is expected to assemble the map from the directory it already has
 * loaded (the per-user panel reuses the directory list; the global page loads
 * its own via `useUsers`). A missing id falls back to the raw id so a departed
 * admin or deleted user still renders something useful.
 * ========================================================================== */

import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { BackendUser } from "@/lib/api/users";
import type { UserAuditEntry } from "@/lib/types";
import { formatRelativeTime } from "@/lib/format";

/** Humanized labels for the admin actions the BE records (#34, extended #71). */
export const ACTION_LABEL: Record<string, string> = {
  "role.change": "Role change",
  "manager.change": "Manager change",
  "manager.clear": "Manager clear",
  "status.change": "Status change",
  "claim.unblock": "Claim unblock",
  "user.delete": "User delete",
  "user.create": "User create",
  "override": "Override",
  "reject": "Reject",
  "payment.processed": "Payment processed",
  "payment.paid": "Payment paid",
};

/** Fallback humanizer for action codes without a known label, e.g.
 *  `"some_action"` → "Some action". */
export function humanizeAction(action: string): string {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  return action
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** All known action codes for the `/finance/audit` filter dropdown (#71). */
export const ALL_AUDIT_ACTIONS: string[] = [
  "role.change",
  "manager.change",
  "manager.clear",
  "status.change",
  "claim.unblock",
  "user.delete",
  "user.create",
  "payment.processed",
  "payment.paid",
];

/**
 * One audit entry: action label, actor (name · email), target user, a
 * before → after JSON toggle, and a relative timestamp. Read-only.
 */
export function AuditEntryRow({
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

export default AuditEntryRow;

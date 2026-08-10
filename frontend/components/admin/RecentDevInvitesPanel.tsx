"use client";

/* ============================================================================
 * SpendFlow — RecentDevInvitesPanel (#66/#57b).
 *
 * Dev-only panel: renders the last 5 sandbox invites read from
 * `backend/logs/invites.log` (via `GET /api/admin/dev/recent-invites`) so a
 * dev can copy an invite URL without opening the log file by hand. Never
 * renders unless `NEXT_PUBLIC_SPENDFLOW_DEV_MODE === "true"` — in production
 * the whole subtree is skipped (both here and at the host page).
 * ========================================================================== */

import * as React from "react";
import { Copy, Check, Inbox, RefreshCw, Mail } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { getRecentDevInvites, type DevInviteEntry } from "@/lib/api/admin";

type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: DevInviteEntry[] };

export function RecentDevInvitesPanel() {
  if (process.env.NEXT_PUBLIC_SPENDFLOW_DEV_MODE !== "true") return null;

  const [state, setState] = React.useState<PanelState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [copiedEmail, setCopiedEmail] = React.useState<string | null>(null);
  const [copyError, setCopyError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const entries = await getRecentDevInvites();
        if (!cancelled) setState({ status: "ready", entries });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Could not load recent invites.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function copyInviteUrl(entry: DevInviteEntry) {
    try {
      await navigator.clipboard.writeText(entry.inviteUrl);
      setCopiedEmail(entry.email);
      setCopyError(null);
      window.setTimeout(() => setCopiedEmail((cur) => (cur === entry.email ? null : cur)), 2000);
    } catch {
      // #57b caveat: clipboard needs a secure context — fall back to a hint.
      setCopyError("Clipboard unavailable — select the link text to copy it manually.");
    }
  }

  return (
    <Card
      title="Recent dev emails"
      subtitle="Last 5 sandbox invites from backend/logs/invites.log — paste the URL straight into a browser."
      action={
        <Button
          variant="outlined"
          size="sm"
          icon={RefreshCw}
          onClick={() => setAttempt((n) => n + 1)}
          aria-label="Refresh recent dev invites"
        >
          Refresh
        </Button>
      }
    >
      {copyError && (
        <p role="alert" className="mb-3 rounded-xl bg-error-container px-3 py-2 text-sm text-error-container-foreground">
          {copyError}
        </p>
      )}

      {state.status === "loading" && (
        <div aria-busy="true" role="status" aria-label="Loading recent dev invites" className="space-y-3">
          <Skeleton variant="list" lines={3} />
        </div>
      )}

      {state.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-error/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-on-surface-variant">
            {state.message || "Couldn&rsquo;t load recent dev invites."}
          </p>
          <Button variant="outlined" size="sm" icon={RefreshCw} onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        </div>
      )}

      {state.status === "ready" && state.entries.length === 0 && (
        <EmptyState
          icon={Inbox}
          title="No sandbox invites yet"
          body="Invite URLs will appear here after the first dev invite is created."
          variant="compact"
        />
      )}

      {state.status === "ready" && state.entries.length > 0 && (
        <ul className="divide-y divide-outline-variant">
          {state.entries.map((entry) => (
            <li key={entry.email + entry.sentAt} className="flex items-center gap-3 py-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
                <Mail className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-on-surface">{entry.email}</p>
                <p className="truncate text-xs text-on-surface-variant">
                  {new Date(entry.sentAt).toLocaleString()} · {entry.inviteUrl}
                </p>
              </div>
              <Button
                variant="tonal"
                size="sm"
                icon={copiedEmail === entry.email ? Check : Copy}
                onClick={() => void copyInviteUrl(entry)}
                aria-label={`Copy link for ${entry.email}`}
              >
                {copiedEmail === entry.email ? "Copied" : "Copy link"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

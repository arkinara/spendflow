"use client";

/* ============================================================================
 * SpendFlow — RecentWebhookEventsPanel (#75).
 *
 * Dev-only panel: renders the most recent webhook dispatch attempts read from
 * `backend/logs/webhook-history.log` (via `GET /api/admin/dev/webhook-recent`)
 * so a dev can spot a failing Slack/Teams delivery without opening the log
 * file by hand. Mirrors `RecentDevInvitesPanel` (#66/#57b). Never renders
 * unless `NEXT_PUBLIC_SPENDFLOW_DEV_MODE === "true"` — in production the whole
 * subtree is skipped (both here and at the host page).
 * ========================================================================== */

import * as React from "react";
import { Copy, Check, Inbox, RefreshCw, Send, ShieldCheck, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { getRecentWebhookEvents, type WebhookEvent } from "@/lib/api/admin";

type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: WebhookEvent[] };

export function RecentWebhookEventsPanel() {
  if (process.env.NEXT_PUBLIC_SPENDFLOW_DEV_MODE !== "true") return null;

  const [state, setState] = React.useState<PanelState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [copyError, setCopyError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const entries = await getRecentWebhookEvents();
        if (!cancelled) setState({ status: "ready", entries });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Could not load recent webhook events.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function copyClaimId(entry: WebhookEvent) {
    try {
      await navigator.clipboard.writeText(entry.claimId);
      setCopiedId(entry.id);
      setCopyError(null);
      window.setTimeout(() => setCopiedId((cur) => (cur === entry.id ? null : cur)), 2000);
    } catch {
      // #57b caveat: clipboard needs a secure context — fall back to a hint.
      setCopyError("Clipboard unavailable — select the claim id text to copy it manually.");
    }
  }

  return (
    <Card
      title="Recent webhook events"
      subtitle="Last 20 dispatch attempts from backend/logs/webhook-history.log — check whether Slack/Teams deliveries are failing."
      action={
        <Button
          variant="outlined"
          size="sm"
          icon={RefreshCw}
          onClick={() => setAttempt((n) => n + 1)}
          aria-label="Refresh recent webhook events"
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
        <div aria-busy="true" role="status" aria-label="Loading recent webhook events" className="space-y-3">
          <Skeleton variant="list" lines={3} />
        </div>
      )}

      {state.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-error/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-on-surface-variant">
            {state.message || "Couldn&rsquo;t load recent webhook events."}
          </p>
          <Button variant="outlined" size="sm" icon={RefreshCw} onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </Button>
        </div>
      )}

      {state.status === "ready" && state.entries.length === 0 && (
        <EmptyState
          icon={Inbox}
          title="No webhook events yet"
          body="Dispatch attempts will appear here after the first claim event fans out to Slack or Teams."
          variant="compact"
        />
      )}

      {state.status === "ready" && state.entries.length > 0 && (
        <ul className="divide-y divide-outline-variant">
          {state.entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
                <Send className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-on-surface">
                  {entry.kind}
                  {entry.delivered ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-container px-2 py-0.5 text-[11px] font-medium text-success-container-foreground">
                      <ShieldCheck className="h-3 w-3" strokeWidth={2} aria-hidden />
                      Delivered
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-error-container px-2 py-0.5 text-[11px] font-medium text-error-container-foreground">
                      <ShieldAlert className="h-3 w-3" strokeWidth={2} aria-hidden />
                      Failed
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-on-surface-variant">
                  {new Date(entry.createdAt).toLocaleString()} · {entry.claimId}
                  {!entry.delivered && entry.lastError ? ` · ${entry.lastError}` : ""}
                  {entry.attempts > 1 ? ` · ${entry.attempts} attempts` : ""}
                </p>
              </div>
              <Button
                variant="tonal"
                size="sm"
                icon={copiedId === entry.id ? Check : Copy}
                onClick={() => void copyClaimId(entry)}
                aria-label={`Copy claim id for ${entry.claimId}`}
              >
                {copiedId === entry.id ? "Copied" : "Copy claim id"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

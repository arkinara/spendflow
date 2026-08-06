"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellOff,
  CheckCheck,
  ClipboardCheck,
  AlertTriangle,
  Wallet,
  Info,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSnackbar } from "@/components/ui/Snackbar";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { claimDetailRoute } from "@/lib/seed-data";
import type { Notification } from "@/lib/types";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "all" | "unread" | "read";

const CATEGORY_ICON: Record<Notification["category"], LucideIcon> = {
  approval: ClipboardCheck,
  action: AlertTriangle,
  payment: Wallet,
  system: Info,
};

const CATEGORY_TONE: Record<Notification["category"], string> = {
  approval: "bg-info-container text-info-container-foreground",
  action: "bg-error-container text-error-container-foreground",
  payment: "bg-success-container text-success-container-foreground",
  system: "bg-surface-container-high text-on-surface-variant",
};

export default function NotificationsPage() {
  const { role } = useRole();
  const router = useRouter();
  const { show } = useSnackbar();
  const { state, reload, markRead } = useNotifications(role);

  const [filter, setFilter] = React.useState<Filter>("all");

  // Unread first (so unread surfaces at the top), then newest first within
  // each group — per the DoD "unread first, newest first".
  const sorted = React.useMemo(() => {
    return [...state.items].sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      return b.at.localeCompare(a.at);
    });
  }, [state.items]);

  const unreadTotal = sorted.filter((n) => !n.read).length;
  const readTotal = sorted.length - unreadTotal;

  const filtered = sorted.filter((n) => {
    if (filter === "unread") return !n.read;
    if (filter === "read") return n.read;
    return true;
  });

  function open(n: Notification) {
    // Mark as read on click (BE POST /read, best-effort) and navigate to the
    // claim detail regardless of whether that call succeeds.
    if (!n.read) markRead(n.id);
    if (n.claimId) {
      router.push(claimDetailRoute(role, n.claimId));
    }
  }

  function markAllRead() {
    // No BE mark-all endpoint — mark every currently-unread row individually.
    for (const n of sorted) {
      if (!n.read) markRead(n.id);
    }
    show("All notifications marked as read.", { tone: "success" });
  }

  return (
    <AppShell
      action={
        unreadTotal > 0 ? (
          <Button size="sm" variant="text" icon={CheckCheck} onClick={markAllRead}>
            Mark all read
          </Button>
        ) : undefined
      }
    >
      <div className="mx-0 max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Notifications</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            {state.status === "ready" && sorted.length > 0
              ? unreadTotal > 0
                ? `${unreadTotal} unread notification${unreadTotal === 1 ? "" : "s"}`
                : "You're all caught up."
              : "Updates about your claims and approvals."}
          </p>
        </div>

        <div className="overflow-x-auto pb-1">
          <SegmentedTabs<Filter>
            value={filter}
            onChange={setFilter}
            ariaLabel="Filter notifications"
            options={[
              { value: "all", label: "All", count: sorted.length },
              { value: "unread", label: "Unread", count: unreadTotal },
              { value: "read", label: "Read", count: readTotal },
            ]}
          />
        </div>

        {state.status === "loading" ? (
          <NotificationsSkeleton />
        ) : state.status === "error" ? (
          <Card className="border-error/40" role="alert">
            <div className="flex flex-col items-center gap-4 px-4 py-10 text-center sm:flex-row sm:text-left">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
                <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-on-surface">
                  Couldn&rsquo;t load notifications
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {state.message || "Something went wrong."} Try again.
                </p>
              </div>
              <Button variant="outlined" icon={RefreshCw} onClick={reload}>
                Retry
              </Button>
            </div>
          </Card>
        ) : filtered.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              icon={filter === "unread" ? BellOff : Bell}
              title={
                sorted.length === 0
                  ? "No notifications yet"
                  : filter === "unread"
                  ? "No unread notifications"
                  : "Nothing here"
              }
              body={
                sorted.length === 0
                  ? "Notifications about your claims will show up here."
                  : filter === "unread"
                  ? "You've read everything in this view."
                  : "Notifications you've read will appear here."
              }
            />
          </Card>
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-outline-variant">
              {filtered.map((n) => (
                <NotificationRow key={n.id} notification={n} onOpen={() => open(n)} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function NotificationRow({
  notification: n,
  onOpen,
}: {
  notification: Notification;
  onOpen: () => void;
}) {
  const Icon = CATEGORY_ICON[n.category];
  const label = `${n.title}. ${n.body}. ${n.read ? "Read" : "Unread"}${n.claimId ? ". Open claim." : ""}`;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
          !n.read && "bg-primary/[0.04]"
        )}
      >
        <span
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            CATEGORY_TONE[n.category]
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-on-surface">{n.title}</p>
            <div className="flex shrink-0 items-center gap-2">
              {!n.read && (
                <span
                  className="h-2 w-2 rounded-full bg-primary"
                  aria-label="Unread"
                />
              )}
              <time className="text-xs text-on-surface-variant">
                {formatRelativeTime(n.at)}
              </time>
            </div>
          </div>
          <p className="mt-0.5 text-sm text-on-surface-variant">{n.body}</p>
          {n.claimId && (
            <p className="mt-1.5 text-xs font-medium text-primary">
              {n.read ? "View claim" : "Mark as read & open claim"}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

function NotificationsSkeleton() {
  return (
    <div
      aria-busy="true"
      role="status"
      aria-label="Loading notifications"
      className="space-y-3"
    >
      <Skeleton variant="list" lines={4} />
    </div>
  );
}

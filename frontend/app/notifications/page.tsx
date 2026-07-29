"use client";

import * as React from "react";
import {
  Bell,
  BellOff,
  CheckCheck,
  ClipboardCheck,
  AlertTriangle,
  Wallet,
  Info,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSnackbar } from "@/components/ui/Snackbar";
import { notificationsFor, type Notification } from "@/lib/mock/mock_data";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "all" | "unread" | Notification["category"];

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
  const { show } = useSnackbar();
  const base = React.useMemo(() => notificationsFor(role), [role]);

  const [readIds, setReadIds] = React.useState<Set<string>>(new Set());
  const [filter, setFilter] = React.useState<Filter>("all");

  const items = base.map((n) => ({ ...n, read: n.read || readIds.has(n.id) }));
  const unreadTotal = items.filter((n) => !n.read).length;

  const filtered = items.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    return n.category === filter;
  });

  function markRead(id: string) {
    setReadIds((s) => new Set(s).add(id));
  }
  function markAllRead() {
    setReadIds(new Set(items.map((n) => n.id)));
    show("All notifications marked as read.", { tone: "success" });
  }

  const counts = {
    all: items.length,
    unread: unreadTotal,
    approval: items.filter((n) => n.category === "approval").length,
    action: items.filter((n) => n.category === "action").length,
    payment: items.filter((n) => n.category === "payment").length,
  };

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
            {unreadTotal > 0
              ? `${unreadTotal} unread notification${unreadTotal === 1 ? "" : "s"}`
              : "You're all caught up."}
          </p>
        </div>

        <div className="overflow-x-auto pb-1">
          <SegmentedTabs<Filter>
            value={filter}
            onChange={setFilter}
            ariaLabel="Filter notifications"
            options={[
              { value: "all", label: "All", count: counts.all },
              { value: "unread", label: "Unread", count: counts.unread },
              { value: "approval", label: "Approvals", count: counts.approval },
              { value: "action", label: "Actions", count: counts.action },
              { value: "payment", label: "Payments", count: counts.payment },
            ]}
          />
        </div>

        <Card padded={false}>
          {filtered.length === 0 ? (
            <EmptyState
              icon={filter === "unread" ? BellOff : Bell}
              title={filter === "unread" ? "No unread notifications" : "Nothing here"
              }
              body={
                filter === "unread"
                  ? "You've read everything in this view."
                  : "Notifications about your claims will show up here."
              }
            />
          ) : (
            <ul className="divide-y divide-outline-variant">
              {filtered.map((n) => (
                <NotificationRow key={n.id} notification={n} onRead={() => markRead(n.id)} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function NotificationRow({
  notification: n,
  onRead,
}: {
  notification: Notification;
  onRead: () => void;
}) {
  const Icon = CATEGORY_ICON[n.category];
  return (
    <li
      className={cn(
        "flex items-start gap-3 px-4 py-3.5 transition-colors",
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
              <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />
            )}
            <time className="text-xs text-on-surface-variant">{formatRelativeTime(n.at)}</time>
          </div>
        </div>
        <p className="mt-0.5 text-sm text-on-surface-variant">{n.body}</p>
        <div className="mt-2 flex items-center gap-3">
          {n.claimId && (
            <Button
              href={`/claims/${n.claimId}/audit`}
              variant="text"
              size="sm"
              iconRight={ArrowRight}
              className="h-8 px-2"
            >
              View claim
            </Button>
          )}
          {!n.read && (
            <button
              type="button"
              onClick={onRead}
              className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Mark as read
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

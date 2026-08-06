"use client";

import * as React from "react";
import {
  list as listNotifications,
  markRead as apiMarkRead,
  NotificationApiError,
  type BackendNotification,
} from "@/lib/api/notifications";
import { refreshUnreadCount } from "@/lib/mock/notifyStore";
import type { Notification, Role } from "@/lib/types";

/* ============================================================================
   SpendFlow — useNotifications (ticket #22, FE wiring).
   HTTP-backed: reads `GET /api/notifications` (BE scopes the list to the
   caller's session, so `role` is only used to stamp the FE `audience` field
   for type compatibility — it does not gate the request). `markRead(id)`
   optimistically flips the row locally, POSTs `/api/notifications/:id/read`,
   and forces an immediate AppBar badge refresh via `notifyStore` so the
   header doesn't wait up to 30s to catch up.

   The hook's public interface keeps `{ state, reload }` from the mock version
   and adds `markRead`, which the page calls instead of the old mock-store
   mutation.
   ========================================================================== */

export type NotificationsStatus = "loading" | "ready" | "error";

export interface NotificationsState {
  status: NotificationsStatus;
  items: Notification[];
  message?: string;
}

export interface UseNotifications {
  state: NotificationsState;
  reload: () => void;
  markRead: (id: string) => void;
}

function toFENotification(b: BackendNotification, role: Role): Notification {
  return {
    id: b.id,
    audience: role,
    category: b.category,
    title: b.title,
    body: b.body,
    at: b.createdAt,
    read: b.readAt !== null,
    claimId: b.claimId ?? undefined,
  };
}

export function useNotifications(role: Role): UseNotifications {
  const [reloadToken, setReloadToken] = React.useState(0);
  const [state, setState] = React.useState<NotificationsState>({
    status: "loading",
    items: [],
  });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", items: [] });

    (async () => {
      try {
        const rows = await listNotifications();
        if (cancelled) return;
        setState({ status: "ready", items: rows.map((r) => toFENotification(r, role)) });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          items: [],
          message:
            err instanceof NotificationApiError || err instanceof Error
              ? err.message
              : "Failed to load notifications.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role, reloadToken]);

  const reload = React.useCallback(() => setReloadToken((v) => v + 1), []);

  const markRead = React.useCallback((id: string) => {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        ...prev,
        items: prev.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
      };
    });
    // Best-effort: the caller (click-to-navigate) proceeds regardless of
    // whether the mark-read round trip succeeds.
    void apiMarkRead(id)
      .catch(() => {})
      .finally(() => {
        void refreshUnreadCount();
      });
  }, []);

  return { state, reload, markRead };
}

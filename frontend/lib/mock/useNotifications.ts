"use client";

import * as React from "react";
import { notificationsFor, type Notification, type Role } from "@/lib/mock/mock_data";
import { useNotificationVersion } from "@/lib/mock/notifyStore";

/**
 * Simulated async fetch of the current user's notifications, plus a live
 * re-read whenever a mark-read mutation bumps the shared notification version
 * (so the list and the header badge stay in sync without a manual reload).
 *
 * The initial fetch runs on a short timer to surface a loading skeleton and
 * error state (matching {@link useClaimDetail}); subsequent mark-read version
 * bumps re-read the live array synchronously to avoid a loading flash, since
 * only a `read` flag has flipped (the rows themselves are unchanged).
 */
export type NotificationsStatus = "loading" | "ready" | "error";

export interface NotificationsState {
  status: NotificationsStatus;
  items: Notification[];
  message?: string;
}

export interface UseNotifications {
  state: NotificationsState;
  reload: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useNotifications(role: Role): UseNotifications {
  // Subscribe to mark-read mutations so the list reflects them immediately.
  const version = useNotificationVersion();
  const [reloadToken, setReloadToken] = React.useState(0);
  const [state, setState] = React.useState<NotificationsState>({
    status: "loading",
    items: [],
  });
  // Tracks whether the initial async fetch has completed for the current role,
  // so version bumps (mark-read) only re-read once we actually have data.
  const readyForRole = React.useRef<Role | null>(null);

  // Initial / role-change / manual-reload fetch with a loading skeleton.
  React.useEffect(() => {
    let cancelled = false;
    readyForRole.current = null;
    setState({ status: "loading", items: [] });
    const timer = window.setTimeout(() => {
      try {
        const items = notificationsFor(role);
        if (cancelled) return;
        readyForRole.current = role;
        setState({ status: "ready", items });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            items: [],
            message:
              err instanceof Error ? err.message : "Failed to load notifications.",
          });
        }
      }
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [role, reloadToken]);

  // Synchronous re-read on a mark-read version bump (no loading flash).
  React.useEffect(() => {
    if (readyForRole.current !== role) return;
    setState((prev) =>
      prev.status === "ready"
        ? { ...prev, items: notificationsFor(role) }
        : prev
    );
  }, [version, role]);

  const reload = React.useCallback(() => setReloadToken((v) => v + 1), []);
  return { state, reload };
}

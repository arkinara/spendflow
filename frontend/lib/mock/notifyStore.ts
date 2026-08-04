"use client";

import * as React from "react";
import { unreadCount as fetchUnreadCount } from "@/lib/api/notifications";

/* ============================================================================
   SpendFlow — HTTP-backed unread-notification badge store (ticket #22).

   The AppBar badge needs a live unread count without websockets, so this
   module polls `GET /api/notifications/unread-count` every 30s and exposes
   it through a tiny pub/sub + useSyncExternalStore hook (replacing the #8
   mock-array version bump this module used to expose). Polling pauses while
   the tab is hidden and resumes — with an immediate refresh — on visibility,
   per the ticket's negative AC. A failed poll keeps the last known count
   rather than flickering to zero or throwing.
   ========================================================================== */

const POLL_INTERVAL_MS = 30_000;

let count = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return count;
}

function getServerSnapshot(): number {
  return 0;
}

function setCount(n: number) {
  if (n === count) return;
  count = n;
  emit();
}

/**
 * Force an immediate unread-count refresh (e.g. right after a mark-read
 * action, so the badge doesn't wait up to 30s to catch up). Swallows network
 * errors — the last known count stands, matching the "no flicker / no crash"
 * negative AC.
 */
export async function refreshUnreadCount(): Promise<void> {
  try {
    const n = await fetchUnreadCount();
    setCount(n);
  } catch {
    // transient/network failure — keep the last known count
  }
}

/**
 * Badge value for the AppBar. Owns the 30s poll lifecycle: active while
 * mounted and the tab is visible, paused while hidden (`document
 * .visibilityState !== "visible"`), and resumed with an immediate refresh
 * when the tab regains visibility.
 */
export function useUnreadCount(): number {
  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    function stopInterval() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    }

    function startInterval() {
      stopInterval();
      timer = setInterval(() => {
        void refreshUnreadCount();
      }, POLL_INTERVAL_MS);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshUnreadCount();
        startInterval();
      } else {
        stopInterval();
      }
    }

    void refreshUnreadCount();
    if (document.visibilityState === "visible") startInterval();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return value;
}

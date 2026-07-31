"use client";

import * as React from "react";
import { notifications, type Role } from "@/lib/mock/mock_data";

/* ============================================================================
   SpendFlow — reactive notification read-state store (Phase 1, mock).
   The mock `notifications` array is the source of truth, but it is a plain
   array: mutating a row's `read` flag does not, on its own, re-render any
   component. The AppBar badge (rendered by AppShell) and the Notifications
   page both need to reflect a mark-read action immediately, so this module
   exposes a tiny pub/sub + useSyncExternalStore hook. Any mark-read mutation
   flips the row in the live array AND bumps a version that every subscriber
   re-reads, keeping the header badge and the list in lockstep.
   ========================================================================== */

let version = 0;
const listeners = new Set<() => void>();

function notifyVersion(): number {
  return version;
}

function emit() {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reactive subscription to notification mutations. Returns the current
 * version number; components re-read the live `notifications` array (via the
   pure selectors in mock_data) whenever it changes.
 */
export function useNotificationVersion(): number {
  return React.useSyncExternalStore(subscribe, notifyVersion, notifyVersion);
}

/**
 * Mark a single notification as read in the live store. No-ops if the
 * notification is missing or already read (so it never spuriously bumps the
 * version / re-renders the tree).
 */
export function markNotificationRead(id: string): void {
  const row = notifications.find((n) => n.id === id);
  if (!row || row.read) return;
  row.read = true;
  emit();
}

/**
 * Mark every notification addressed to a role as read. Used by the "mark all
 * read" action on the Notifications page header.
 */
export function markAllNotificationsRead(role: Role): void {
  let changed = false;
  for (const n of notifications) {
    if (n.audience === role && !n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) emit();
}

"use client";

import * as React from "react";
import { getExceptions } from "@/lib/api/finance";

/* ============================================================================
   SpendFlow — live open-exception badge store (ticket #37, FE wiring).

   Drives the "Exceptions" nav badge on the Finance rail / bottom nav so it
   reflects the LIVE open-flag count instead of the hardcoded seeded value.

   SOURCE ENDPOINT: `GET /api/finance/exceptions` — the same BE list the
   dashboard's `openExceptionCount` is composed from (see `useFinanceDashboard`
   + `lib/api/finance.ts` `composeDashboard`). Only fully-approved claims that
   still carry at least one OPEN line-item policy flag appear in that list, so
   `items.length` IS the open-flag count (resolved flags and action_required
   claims are already excluded by the BE).

   TRIM POLICY (when the badge must NOT render):
     - count === 0                      -> badge hidden (nothing to act on)
     - load failure (network / 403/5xx) -> count set to `null`, badge hidden —
       never show a stale count from a previous successful load
     - role is not Finance              -> hook disabled, count `null`

   Refetch triggers: immediate on mount, on a 30s poll (paused while the tab
   is hidden, resumed with an immediate refresh on visibility, mirroring
   `notifyStore`), and via `refreshOpenExceptionCount()` which the exception
   queue page fires right after a resolve decision so the badge decrements
   without waiting for the poll.
   ========================================================================== */

const POLL_INTERVAL_MS = 30_000;

/** `null` = no valid count (loading / error / disabled) -> badge hidden. */
let count: number | null = null;
let loadSeq = 0;
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

function getSnapshot(): number | null {
  return count;
}

function getServerSnapshot(): number | null {
  return null;
}

function setCount(n: number | null) {
  if (n === count) return;
  count = n;
  emit();
}

/**
 * Re-read `GET /api/finance/exceptions` and publish `items.length` (the live
 * open-flag count). Any failure sets the count to `null` so the badge hides
 * instead of showing stale data. Call this right after a resolve decision so
 * the badge decrements without waiting up to 30s for the poll.
 */
export async function refreshOpenExceptionCount(): Promise<void> {
  const seq = ++loadSeq;
  try {
    const items = await getExceptions();
    if (seq !== loadSeq) return; // a newer refresh superseded this one
    setCount(items.length);
  } catch {
    if (seq !== loadSeq) return;
    setCount(null);
  }
}

/**
 * Badge value for the Exceptions nav entry: the live open-flag count, or
 * `null` while loading / on error / for non-Finance roles (badge hidden).
 * Owns the 30s poll lifecycle while mounted: paused while the tab is hidden
 * and resumed — with an immediate refresh — when the tab regains visibility.
 */
export function useOpenExceptionCount(enabled: boolean): number | null {
  const value = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  React.useEffect(() => {
    if (!enabled) {
      // Non-Finance shell: never fetch, never show a leftover count.
      setCount(null);
      return;
    }

    let timer: ReturnType<typeof setInterval> | undefined;

    function stopInterval() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    }

    function startInterval() {
      stopInterval();
      timer = setInterval(() => {
        void refreshOpenExceptionCount();
      }, POLL_INTERVAL_MS);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshOpenExceptionCount();
        startInterval();
      } else {
        stopInterval();
      }
    }

    void refreshOpenExceptionCount();
    if (document.visibilityState === "visible") startInterval();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled]);

  return value;
}

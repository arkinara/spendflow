"use client";

import * as React from "react";
import {
  categories,
  policies,
  routingRules,
  type ExpenseCategory,
  type Policy,
  type RoutingRule,
} from "@/lib/mock/mock_data";
import { getActiveCategories } from "@/lib/mock/adminStore";

/**
 * Shared async hook for the Finance Admin console. Mirrors the finance-list
 * hook: mock data is synchronous but the UI still shows a brief loading
 * skeleton and an explicit, retry-capable error state (never a blank section,
 * never an infinite spinner). Selectors read the live admin collections on
 * every (re)load, so an admin action that mutates the store is reflected on
 * the next `refresh()` without keeping a duplicate local copy.
 */
export type AdminListState<T> =
  | { status: "loading" }
  | { status: "ready"; rows: T[] }
  | { status: "error"; message: string };

export interface UseAdminCollection<T> {
  state: AdminListState<T>;
  retry: () => void;
  /** Force a fresh read of the live store (e.g. after a CRUD action). */
  refresh: () => void;
}

const SIMULATED_LATENCY_MS = 180;

function useAdminCollection<T>(load: () => T[]): UseAdminCollection<T> {
  const [state, setState] = React.useState<AdminListState<T>>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        const rows = load();
        if (!cancelled) setState({ status: "ready", rows });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to load admin data.",
          });
        }
      }
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = React.useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry, refresh };
}

/** Every expense category (active + inactive) — the Category admin list. */
export function useCategories(): UseAdminCollection<ExpenseCategory> {
  return useAdminCollection(() => [...categories]);
}

/** Every spend policy (active + inactive) — the Policy admin list. */
export function usePolicies(): UseAdminCollection<Policy> {
  return useAdminCollection(() => [...policies]);
}

/** Every approval route (active + inactive, incl. fallback) — the Routing list. */
export function useRoutes(): UseAdminCollection<RoutingRule> {
  return useAdminCollection(() => [...routingRules]);
}

/**
 * Live preview of the categories surfaced in the employee claim builder.
 * Reflects create/deactivate mutations immediately so the Finance Admin can
 * see the employee-facing impact without leaving the console (DoD).
 */
export function useActiveCategoriesPreview(): UseAdminCollection<ExpenseCategory> {
  return useAdminCollection(() => [...getActiveCategories()]);
}

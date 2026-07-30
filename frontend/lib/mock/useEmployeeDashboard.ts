"use client";

import * as React from "react";
import { loadEmployeeDashboard, type EmployeeDashboardData } from "@/lib/mock/dashboard";

/**
 * Simulated async fetch of the employee dashboard payload.
 *
 * Mock data is synchronous, but the dashboard still shows a brief loading
 * skeleton and an explicit, retry-capable error state — matching the #2 ticket's
 * negative acceptance criteria (no silent blank dashboard, no infinite spinner).
 */
export type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: EmployeeDashboardData }
  | { status: "error"; message: string };

export interface UseEmployeeDashboard {
  state: DashboardState;
  retry: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useEmployeeDashboard(employeeId: string): UseEmployeeDashboard {
  const [state, setState] = React.useState<DashboardState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        const data = loadEmployeeDashboard(employeeId);
        if (!cancelled) setState({ status: "ready", data });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load dashboard.",
          });
        }
      }
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [employeeId, attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}

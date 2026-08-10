"use client";

/* ============================================================================
 * SpendFlow — useFinanceLists (ticket #20, FE wiring).
 * HTTP-backed: reads the exception queue + payment board from the BE (#13).
 * The mock data source is gone for the Finance vertical; the hooks keep their
 * `{ state, retry, refresh }` state-machine contract so the exception + payment
 * pages keep their loading / error / ready branching shape.
 *
 * `useFinancePayments` makes a single `GET /api/finance/payments` call and
 * returns all three columns (Approved / Processing / Paid) so the payment
 * board doesn't triplicate the request. The legacy single-column hooks are
 * retained as thin slices for any out-of-vertical consumer; they each delegate
 * to the unified hook.
 * ========================================================================== */

import * as React from "react";
import { toFEClaim } from "@/lib/api/claims";
import {
  getExceptions,
  getPayments,
  unblockClaim as unblockClaimApi,
  FinanceApiError,
  type FinanceExceptionItem,
  type FinancePaymentItem,
  type UnblockClaimInput,
} from "@/lib/api/finance";
import type { Claim } from "@/lib/types";

/* --------------------------------------------------------------- shared core */

export type FinanceListState<T> =
  | { status: "loading" }
  | { status: "ready"; items: T[] }
  | { status: "error"; message: string; code?: string };

export interface UseFinanceList<T> {
  state: FinanceListState<T>;
  retry: () => void;
  /** Force a fresh read of the BE (e.g. after a decision action). */
  refresh: () => void;
}

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof FinanceApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function codeOf(err: unknown): string | undefined {
  return err instanceof FinanceApiError ? err.code : undefined;
}

/**
 * Generic async-list hook. Re-runs on every `attempt` bump (initial mount,
 * `retry`, `refresh`); a stale attempt's resolved value is ignored once the
 * effect is cleaned up so a slow response can't overwrite a fresh one.
 *
 * `mutate` is the internal cache seam the exception hook uses to drop a row
 * after an unblock without forcing a refetch (#48). It is intentionally not
 * part of the public `UseFinanceList<T>` contract.
 */
interface InternalAsyncList<T> extends UseFinanceList<T> {
  mutate: (updater: (items: T[]) => T[]) => void;
}

function useAsyncList<T>(load: () => Promise<T[]>): InternalAsyncList<T> {
  const [state, setState] = React.useState<FinanceListState<T>>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const items = await load();
        if (!cancelled) setState({ status: "ready", items });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: messageOf(err, "Failed to load finance data."),
          code: codeOf(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = React.useCallback(() => setAttempt((n) => n + 1), []);

  const mutate = React.useCallback(
    (updater: (items: T[]) => T[]) => {
      setState((prev) =>
        prev.status === "ready"
          ? { status: "ready", items: updater(prev.items) }
          : prev,
      );
    },
    [],
  );

  return { state, retry, refresh, mutate };
}

/* --------------------------------------------------------------- exceptions */

/** `useFinanceExceptions` surface — adds the unblock mutator (#48). */
export interface UseFinanceExceptions extends UseFinanceList<FinanceExceptionItem> {
  /**
   * Unblock a `blocked_sod` claim (#48). On success the row is removed from
   * the local cache so the table re-renders without a refetch; on failure the
   * typed error rethrows untouched so the dialog can surface the BE's
   * message inline (e.g. a 409 `still_blocked`). `password` (#64) is the
   * actor's own password forwarded to the BE for step-up re-auth.
   */
  unblockClaim: (
    claimId: string,
    body: UnblockClaimInput,
    password?: string,
  ) => Promise<Claim>;
}

/** Claims with an open policy flag that are in Finance's hands to resolve. */
export function useFinanceExceptions(): UseFinanceExceptions {
  const { state, retry, refresh, mutate } = useAsyncList(
    React.useCallback(() => getExceptions(), []),
  );

  const unblockClaim = React.useCallback(
    async (
      claimId: string,
      body: UnblockClaimInput,
      password?: string,
    ): Promise<Claim> => {
      const { claim } = await unblockClaimApi(claimId, body, password);
      mutate((items) => items.filter((i) => i.id !== claimId));
      return toFEClaim(claim);
    },
    [mutate],
  );

  return { state, retry, refresh, unblockClaim };
}

/* --------------------------------------------------------------- payments board */

export type FinancePaymentsState =
  | { status: "loading" }
  | {
      status: "ready";
      approved: FinancePaymentItem[];
      processing: FinancePaymentItem[];
      paid: FinancePaymentItem[];
    }
  | { status: "error"; message: string; code?: string };

export interface UseFinancePayments {
  state: FinancePaymentsState;
  retry: () => void;
  refresh: () => void;
}

/**
 * Single `GET /api/finance/payments` call returning all three board columns.
 * The payment board reads this once instead of triplicating the request across
 * three independent column hooks.
 */
export function useFinancePayments(): UseFinancePayments {
  const [state, setState] = React.useState<FinancePaymentsState>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const groups = await getPayments();
        if (!cancelled) setState({ status: "ready", ...groups });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: messageOf(err, "Failed to load the payment board."),
          code: codeOf(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = React.useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = React.useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry, refresh };
}

/* ----------------------------------------- legacy single-column hooks */

/**
 * Legacy: returns the Approved column as a flat list. Kept for any out-of-
 * vertical consumer; the payment board itself uses `useFinancePayments` so it
 * only makes one BE round trip. Reads the same endpoint and slices.
 */
export function useFinanceReadyToPay(): UseFinanceList<FinancePaymentItem> {
  return useAsyncList(
    React.useCallback(async () => (await getPayments()).approved, []),
  );
}

/** Legacy: returns the Processing column as a flat list. */
export function useFinanceInFlight(): UseFinanceList<FinancePaymentItem> {
  return useAsyncList(
    React.useCallback(async () => (await getPayments()).processing, []),
  );
}

/** Legacy: returns the Paid column as a flat list. */
export function useFinancePaid(): UseFinanceList<FinancePaymentItem> {
  return useAsyncList(
    React.useCallback(async () => (await getPayments()).paid, []),
  );
}

"use client";

/* ============================================================================
 * SpendFlow — useApproverInbox (ticket #19, FE wiring).
 * HTTP-backed: reads `GET /api/approver/inbox`. The caller's identity is
 * inferred from the session, so the legacy `approverId` argument is accepted
 * for signature compatibility and ignored. A BE 401 is handled globally by
 * `apiFetch`; other failures surface as a retry-capable `error` state.
 *
 * The hook's state-machine interface (`{ state, retry, refresh }`) is
 * unchanged from the mock version so the inbox page keeps its loading /
 * error / ready branching shape — only the row data type moves from the FE
 * mock `Claim` to the BE-owned `ApproverInboxItem`.
 * ========================================================================== */

import * as React from "react";
import {
  listInbox,
  ApprovalApiError,
  type BackendInboxItem,
} from "@/lib/api/approvals";

export type ApproverInboxState =
  | { status: "loading" }
  | { status: "ready"; items: BackendInboxItem[] }
  | { status: "error"; message: string };

export interface UseApproverInbox {
  state: ApproverInboxState;
  retry: () => void;
  /** Force a fresh read (e.g. after navigating back from a decision). */
  refresh: () => void;
}

export function useApproverInbox(_approverId: string): UseApproverInbox {
  const [state, setState] = React.useState<ApproverInboxState>({
    status: "loading",
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const items = await listInbox();
        if (!cancelled) setState({ status: "ready", items });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApprovalApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load your inbox.";
        setState({ status: "error", message });
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

  const refresh = React.useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry, refresh };
}

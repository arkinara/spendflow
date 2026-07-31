"use client";

import * as React from "react";
import { commentsForClaim, type Comment } from "@/lib/mock/mock_data";

/**
 * Simulated async fetch of a claim's comment thread, with a `reload()` that
 * re-reads the live `comments` array so a freshly-posted comment renders at
 * the end of the thread without a full page refresh. The thread is always
 * sorted ascending by timestamp (oldest first) by {@link commentsForClaim}.
 *
 * Mirrors {@link useClaimDetail}: a brief loading skeleton, an explicit error
 * state with retry, and a not-found signal surfaced via the page (the page
 * resolves the claim separately and renders its own not-found shell).
 */
export type CommentsStatus = "loading" | "ready" | "error";

export interface CommentsState {
  status: CommentsStatus;
  items: Comment[];
  message?: string;
}

export interface UseClaimComments {
  state: CommentsState;
  reload: () => void;
}

const SIMULATED_LATENCY_MS = 200;

export function useClaimComments(claimId: string): UseClaimComments {
  const [version, setVersion] = React.useState(0);
  const [state, setState] = React.useState<CommentsState>({
    status: "loading",
    items: [],
  });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", items: [] });
    const timer = window.setTimeout(() => {
      try {
        const items = commentsForClaim(claimId);
        if (cancelled) return;
        setState({ status: "ready", items });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            items: [],
            message: err instanceof Error ? err.message : "Failed to load comments.",
          });
        }
      }
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [claimId, version]);

  const reload = React.useCallback(() => setVersion((v) => v + 1), []);
  return { state, reload };
}

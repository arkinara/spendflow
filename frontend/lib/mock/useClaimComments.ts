"use client";

/* ============================================================================
 * SpendFlow — useClaimComments (ticket #22, FE wiring).
 * HTTP-backed: reads `GET /api/claims/:id/comments`. The BE gates the route to
 * claim participants (submitter, current/former approver, finance admin) and
 * rejects everyone else with 403 `forbidden`; a nonexistent claim 404s. Those
 * map to `denied` / `notfound` respectively — the page trusts the BE's
 * participant decision rather than recomputing it from mock data. Comments
 * are always ascending by timestamp (oldest first), per the BE's ordering.
 *
 * The hook's public interface (`{ state, reload }`) is unchanged from the
 * mock version so the page keeps its shape; the composer posts directly
 * through `@/lib/api/comments` and calls `reload()` on success.
 * ========================================================================== */

import * as React from "react";
import {
  listComments,
  CommentApiError,
  type BackendComment,
} from "@/lib/api/comments";

export type CommentsStatus = "loading" | "ready" | "notfound" | "denied" | "error";

/** A comment enriched with the BE's `authorName` (mock fixtures may not cover every seeded user). */
export interface CommentItem {
  id: string;
  claimId: string;
  authorId: string;
  authorName: string;
  body: string;
  at: string;
}

export interface CommentsState {
  status: CommentsStatus;
  items: CommentItem[];
  message?: string;
}

export interface UseClaimComments {
  state: CommentsState;
  reload: () => void;
}

function toItem(b: BackendComment): CommentItem {
  return {
    id: b.id,
    claimId: b.claimId,
    authorId: b.authorId,
    authorName: b.authorName,
    body: b.body,
    at: b.createdAt,
  };
}

export function useClaimComments(claimId: string): UseClaimComments {
  const [version, setVersion] = React.useState(0);
  const [state, setState] = React.useState<CommentsState>({
    status: "loading",
    items: [],
  });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", items: [] });

    (async () => {
      try {
        const rows = await listComments(claimId);
        if (cancelled) return;
        setState({ status: "ready", items: rows.map(toItem) });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CommentApiError) {
          if (err.status === 404) {
            setState({ status: "notfound", items: [] });
          } else if (err.status === 403) {
            setState({ status: "denied", items: [] });
          } else {
            setState({ status: "error", items: [], message: err.message });
          }
        } else {
          setState({
            status: "error",
            items: [],
            message: err instanceof Error ? err.message : "Failed to load comments.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [claimId, version]);

  const reload = React.useCallback(() => setVersion((v) => v + 1), []);
  return { state, reload };
}

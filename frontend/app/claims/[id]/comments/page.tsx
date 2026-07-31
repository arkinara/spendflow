"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Send,
  MessagesSquare,
  AlertTriangle,
  RefreshCw,
  Ban,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { useSnackbar } from "@/components/ui/Snackbar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { TextArea } from "@/components/ui/TextArea";
import { StatusChip } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useClaimComments } from "@/lib/mock/useClaimComments";
import { addClaimComment } from "@/lib/mock/claimStore";
import {
  getClaim,
  getUser,
  isClaimParticipant,
  claimDetailRoute,
  type Comment,
} from "@/lib/mock/mock_data";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const MIN_COMMENT_LENGTH = 1;

export default function CommentsPage() {
  const params = useParams<{ id: string }>();
  const { role, user } = useRole();
  const { show } = useSnackbar();
  const claim = getClaim(params.id);
  const { state, reload } = useClaimComments(params.id);

  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string>();

  if (!claim) {
    return (
      <AppShell>
        <EmptyState
          icon={AlertTriangle}
          title="Claim not found"
          body="This claim may have been removed or the link is incorrect."
          action={
            <Button href="/employee/claims" icon={ArrowLeft}>
              Back
            </Button>
          }
        />
      </AppShell>
    );
  }

  // Participant gate: only the submitter, approvers in the routing, and
  // Finance Admin may read/post. Anyone else gets an access-denied shell.
  if (!isClaimParticipant(claim, user)) {
    return (
      <AppShell>
        <EmptyState
          icon={Ban}
          title="Access denied"
          body="Only participants in this claim — the submitter, its approvers, and Finance — can view the conversation."
          action={
            <Button href={claimDetailRoute(role, claim.id)} icon={ArrowLeft}>
              Back to claim
            </Button>
          }
        />
      </AppShell>
    );
  }

  function send() {
    const body = draft.trim();
    if (body.length < MIN_COMMENT_LENGTH) {
      setError("Comment cannot be empty.");
      return;
    }
    try {
      addClaimComment({ claimId: claim!.id, authorId: user.id, body });
      setDraft("");
      setError(undefined);
      reload(); // re-read live store → new comment renders at the end
      show("Comment posted.", { tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that comment.");
    }
  }

  return (
    <AppShell>
      <div className="mx-0 max-w-3xl space-y-5">
        <Button href={claimDetailRoute(role, claim.id)} variant="text" size="sm" icon={ArrowLeft}>
          Back to claim
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">Comments</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              {claim.title} · {claim.reference}
            </p>
          </div>
          <StatusChip status={claim.status} />
        </div>

        <Card padded={false}>
          {state.status === "loading" ? (
            <CommentsSkeleton />
          ) : state.status === "error" ? (
            <div className="flex flex-col items-center gap-4 px-4 py-10 text-center sm:flex-row sm:text-left">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/15 text-error">
                <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-on-surface">
                  Couldn&rsquo;t load comments
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {state.message || "Something went wrong."} Try again.
                </p>
              </div>
              <Button variant="outlined" icon={RefreshCw} onClick={reload}>
                Retry
              </Button>
            </div>
          ) : state.items.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              title="No comments yet"
              body="Start the conversation about this claim below."
              variant="compact"
            />
          ) : (
            <ul className="space-y-4 p-5">
              {state.items.map((c) => (
                <CommentBubble key={c.id} comment={c} mine={c.authorId === user.id} />
              ))}
            </ul>
          )}

          {/* Composer lives at the bottom; always rendered once the user may post. */}
          <div className="border-t border-outline-variant p-4">
            <div className="flex items-end gap-3">
              <Avatar name={user.name} size="sm" color={user.avatarColor as never} />
              <div className="flex-1">
                <TextArea
                  aria-label="Add a comment"
                  rows={2}
                  placeholder="Write a comment…"
                  value={draft}
                  error={error}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (error) setError(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
              </div>
              <Button
                icon={Send}
                onClick={send}
                aria-label="Post comment"
              >
                Post
              </Button>
            </div>
            <p className="mt-1.5 pl-11 text-xs text-on-surface-variant">
              Press ⌘/Ctrl + Enter to post. Posting a comment does not change the claim status.
            </p>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function CommentBubble({ comment, mine }: { comment: Comment; mine: boolean }) {
  const author = getUser(comment.authorId);
  return (
    <li className={cn("flex gap-3", mine && "flex-row-reverse")}>
      <Avatar
        name={author?.name ?? "Unknown"}
        size="sm"
        color={(author?.avatarColor as never) ?? "primary"}
      />
      <div className={cn("min-w-0 max-w-[80%]", mine && "text-right")}>
        <div className={cn("flex items-baseline gap-2", mine && "flex-row-reverse")}>
          <span className="text-sm font-medium text-on-surface">
            {mine ? "You" : author?.name}
          </span>
          <time className="text-xs text-on-surface-variant" title={formatDateTime(comment.at)}>
            {formatRelativeTime(comment.at)}
          </time>
        </div>
        <div
          className={cn(
            "mt-1 inline-block rounded-2xl px-4 py-2.5 text-left text-sm",
            mine ? "bg-primary text-primary-foreground" : "bg-surface-container text-on-surface"
          )}
        >
          {comment.body}
        </div>
      </div>
    </li>
  );
}

function CommentsSkeleton() {
  return (
    <div
      aria-busy="true"
      role="status"
      aria-label="Loading comments"
      className="space-y-4 p-5"
    >
      <Skeleton variant="list" lines={3} />
    </div>
  );
}

"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Send, MessagesSquare, AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useRole } from "@/components/shell/RoleSwitcher";
import { useSnackbar } from "@/components/ui/Snackbar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { TextArea } from "@/components/ui/TextArea";
import { StatusChip } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getClaim,
  getUser,
  commentsForClaim,
  type Comment,
} from "@/lib/mock/mock_data";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function CommentsPage() {
  const params = useParams<{ id: string }>();
  const { user } = useRole();
  const { show } = useSnackbar();
  const claim = getClaim(params.id);

  const [extra, setExtra] = React.useState<Comment[]>([]);
  const [draft, setDraft] = React.useState("");
  const counter = React.useRef(0);

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

  const thread = [...commentsForClaim(claim.id), ...extra];

  function send() {
    const body = draft.trim();
    if (!body) return;
    const comment: Comment = {
      id: `cm-new-${++counter.current}`,
      claimId: claim!.id,
      authorId: user.id,
      body,
      at: new Date("2026-07-29T09:00:00+07:00").toISOString(),
    };
    setExtra((c) => [...c, comment]);
    setDraft("");
    show("Comment posted.", { tone: "success" });
  }

  return (
    <AppShell>
      <div className="mx-0 max-w-3xl space-y-5">
        <Button href={`/employee/claims/${claim.id}`} variant="text" size="sm" icon={ArrowLeft}>
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
          {thread.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              title="No comments yet"
              body="Start the conversation about this claim below."
              variant="compact"
            />
          ) : (
            <ul className="space-y-4 p-5">
              {thread.map((c) => (
                <CommentBubble key={c.id} comment={c} mine={c.authorId === user.id} />
              ))}
            </ul>
          )}
          <div className="border-t border-outline-variant p-4">
            <div className="flex items-end gap-3">
              <Avatar name={user.name} size="sm" color={user.avatarColor as never} />
              <div className="flex-1">
                <TextArea
                  aria-label="Add a comment"
                  rows={2}
                  placeholder="Write a comment…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                  }}
                />
              </div>
              <Button icon={Send} onClick={send} disabled={!draft.trim()}>
                Send
              </Button>
            </div>
            <p className="mt-1.5 pl-11 text-xs text-on-surface-variant">
              Press ⌘/Ctrl + Enter to send.
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
        <div
          className={cn(
            "flex items-baseline gap-2",
            mine && "flex-row-reverse"
          )}
        >
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
            mine
              ? "bg-primary text-primary-foreground"
              : "bg-surface-container text-on-surface"
          )}
        >
          {comment.body}
        </div>
      </div>
    </li>
  );
}

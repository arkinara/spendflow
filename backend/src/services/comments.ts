/* ============================================================================
 * SpendFlow — claim comments service (ticket #15).
 *
 * Contextual discussion on a claim, separate from formal approval decisions.
 * Visible to and postable by any claim participant (submitter, current/former
 * approver, finance admin). Never mutates claim status.
 * ========================================================================== */

import { asc, eq, inArray } from "drizzle-orm";
import { commentsTable, usersTable } from "../db/schema.js";
import type { DB } from "../db/index.js";
import type { Role } from "../types.js";
import { loadClaimOrThrow } from "./claims.js";
import { claimParticipantIds, isClaimParticipant } from "./participants.js";

export class CommentError extends Error {
  constructor(
    public status: number,
    public code: "not_found" | "forbidden" | "invalid_body",
    message: string
  ) {
    super(message);
    this.name = "CommentError";
  }
}

export interface CommentRow {
  id: string;
  claimId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: Date;
}

export interface ParticipantSummary {
  id: string;
  name: string;
  role: Role;
}

function loadClaimAndAssertParticipant(db: DB, claimId: string, userId: string) {
  const claim = loadClaimOrThrow(db, claimId);
  if (!isClaimParticipant(db, claim, userId)) {
    throw new CommentError(403, "forbidden", "You do not have access to this claim");
  }
  return claim;
}

/** Add a comment. Requires a non-empty body and claim-participant access. */
export function addComment(
  db: DB,
  claimId: string,
  authorId: string,
  authorName: string,
  body: string
): CommentRow {
  loadClaimAndAssertParticipant(db, claimId, authorId);
  const trimmed = body?.trim();
  if (!trimmed) {
    throw new CommentError(400, "invalid_body", "Comment body is required");
  }
  const now = new Date();
  const id = `cmt-${crypto.randomUUID()}`;
  db.insert(commentsTable)
    .values({ id, claimId, authorId, body: trimmed, createdAt: now })
    .run();
  return { id, claimId, authorId, authorName, body: trimmed, createdAt: now };
}

/** Comments on a claim, ordered ascending by creation time. */
export function listComments(db: DB, claimId: string, userId: string): CommentRow[] {
  loadClaimAndAssertParticipant(db, claimId, userId);
  return db
    .select({
      id: commentsTable.id,
      claimId: commentsTable.claimId,
      authorId: commentsTable.authorId,
      authorName: usersTable.name,
      body: commentsTable.body,
      createdAt: commentsTable.createdAt,
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
    .where(eq(commentsTable.claimId, claimId))
    .orderBy(asc(commentsTable.createdAt))
    .all();
}

/**
 * Every current participant of the claim (not just users who have commented),
 * so the FE comment composer can disable the input for non-participants.
 */
export function listCommentAuthors(
  db: DB,
  claimId: string,
  userId: string
): ParticipantSummary[] {
  const claim = loadClaimAndAssertParticipant(db, claimId, userId);
  const ids = claimParticipantIds(db, claim);
  if (ids.length === 0) return [];
  return db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.primaryRole })
    .from(usersTable)
    .where(inArray(usersTable.id, ids))
    .all();
}

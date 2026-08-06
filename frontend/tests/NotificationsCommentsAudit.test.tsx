import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/notifications",
  id: "clm-1001",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navMocks.push,
    replace: navMocks.replace,
    refresh: vi.fn(),
  }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({ id: navMocks.id }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** Resolve the seeded session (role + userId) the same way `SessionProvider`
 *  reads it, so the mocked HTTP clients below can honour the BE's
 *  session-scoped (not role-param) contracts. */
async function currentSession(): Promise<{
  userId: string;
  role: "employee" | "approver" | "finance";
}> {
  const { SESSION_STORAGE_KEY } = await import("@/lib/auth/session");
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return { userId: "u-emp-1", role: "employee" };
    const parsed = JSON.parse(raw);
    return { userId: parsed.userId ?? "u-emp-1", role: parsed.role ?? "employee" };
  } catch {
    return { userId: "u-emp-1", role: "employee" };
  }
}

/**
 * #22: the notification center reads through `@/lib/api/notifications`.
 * Mock the client to serve the session-scoped slice of the live
 * `notifications` mock fixture, mirroring the BE's contract.
 */
vi.mock("@/lib/api/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/notifications")>();
  const {
    notifications: liveNotifications,
  } = await import("@/lib/fixtures");
  const {
    notificationsFor,
    unreadCount: unreadCountForRole,
  } = await import("@/lib/seed-data");

  return {
    ...actual,
    list: vi.fn(async () => {
      const { role } = await currentSession();
      return notificationsFor(role).map((n) => ({
        id: n.id,
        recipientId: n.audience,
        category: n.category,
        title: n.title,
        body: n.body,
        claimId: n.claimId ?? null,
        readAt: n.read ? n.at : null,
        createdAt: n.at,
      }));
    }),
    markRead: vi.fn(async (id: string) => {
      const row = liveNotifications.find((n) => n.id === id);
      if (row) row.read = true;
      return {
        id: row?.id ?? id,
        recipientId: row?.audience ?? "employee",
        category: row?.category ?? "system",
        title: row?.title ?? "",
        body: row?.body ?? "",
        claimId: row?.claimId ?? null,
        readAt: new Date().toISOString(),
        createdAt: row?.at ?? new Date().toISOString(),
      };
    }),
    unreadCount: vi.fn(async () => {
      const { role } = await currentSession();
      return unreadCountForRole(role);
    }),
  };
});

/**
 * #22: the comment thread reads/writes through `@/lib/api/comments`. Mock the
 * client to enforce the BE's participant gate (403) and empty-body
 * validation (400) against the live `comments` fixture.
 */
vi.mock("@/lib/api/comments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/comments")>();
  const {
    comments: liveComments,
  } = await import("@/lib/fixtures");
  const {
    commentsForClaim,
    getClaim,
    getUser,
    isClaimParticipant,
    getUserName,
  } = await import("@/lib/seed-data");

  let seq = 9900;

  async function assertParticipant(claimId: string) {
    const claim = getClaim(claimId);
    if (!claim) throw new actual.CommentApiError(404, "not_found", "Claim not found.");
    const { userId } = await currentSession();
    const user = getUser(userId);
    if (!user || !isClaimParticipant(claim, user)) {
      throw new actual.CommentApiError(
        403,
        "forbidden",
        "You are not a participant in this claim."
      );
    }
    return claim;
  }

  return {
    ...actual,
    listComments: vi.fn(async (claimId: string) => {
      await assertParticipant(claimId);
      return commentsForClaim(claimId).map((c) => ({
        id: c.id,
        claimId: c.claimId,
        authorId: c.authorId,
        authorName: getUserName(c.authorId),
        body: c.body,
        createdAt: c.at,
      }));
    }),
    addComment: vi.fn(async (claimId: string, body: string) => {
      await assertParticipant(claimId);
      const trimmed = body.trim();
      if (!trimmed) {
        throw new actual.CommentApiError(400, "invalid_body", "Comment body is required");
      }
      const { userId } = await currentSession();
      const now = new Date().toISOString();
      const entry = { id: `cm-${++seq}`, claimId, authorId: userId, body: trimmed, at: now };
      liveComments.push(entry);
      return {
        id: entry.id,
        claimId: entry.claimId,
        authorId: entry.authorId,
        authorName: getUserName(entry.authorId),
        body: entry.body,
        createdAt: entry.at,
      };
    }),
  };
});

/**
 * #22: the audit viewer reads through `@/lib/api/audit`. Mock the client to
 * serve the live `auditLog` fixture (chronological, participant-gated),
 * shaped as the BE's `BackendAuditEntry`.
 */
vi.mock("@/lib/api/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/audit")>();
  const { auditForClaim, getClaim, getUser, isClaimParticipant } = await import(
    "@/lib/seed-data"
  );

  return {
    ...actual,
    getAudit: vi.fn(async (claimId: string) => {
      const claim = getClaim(claimId);
      if (!claim) throw new actual.AuditApiError(404, "not_found", "Claim not found.");
      const { userId } = await currentSession();
      const user = getUser(userId);
      if (!user || !isClaimParticipant(claim, user)) {
        throw new actual.AuditApiError(
          403,
          "forbidden",
          "You do not have access to this claim's audit trail."
        );
      }
      return auditForClaim(claimId).map((a) => ({
        id: a.id,
        actorId: a.actorId,
        action: a.action,
        entityType: "claim",
        entityId: claimId,
        before: null,
        after: null,
        createdAt: a.at,
      }));
    }),
  };
});

import NotificationsPage from "@/app/notifications/page";
import CommentsPage from "@/app/claims/[id]/comments/page";
import AuditPage from "@/app/claims/[id]/audit/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import {
  notifications,
  comments,
} from "@/lib/fixtures";
import type { Notification, Comment } from "@/lib/types";

/* ----------------------------------------------------------------- helpers */

function seedSession(role: "employee" | "approver" | "finance") {
  const userId =
    role === "employee" ? "u-emp-1" : role === "approver" ? "u-mgr-1" : "u-fin-1";
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId, role, issuedAt: Date.now() })
  );
}

/**
 * Pristine snapshot of the live mock notifications/comments, captured at module
 * load. These suites mutate the shared arrays (mark-read, post-comment) and
 * vitest runs every file in a single fork, so we restore this baseline between
 * tests to keep them — and neighbouring suites — isolated.
 */
const PRISTINE_NOTIFICATIONS: Notification[] = notifications.map((n) => ({
  ...n,
}));
const PRISTINE_COMMENTS: Comment[] = comments.map((c) => ({ ...c }));

function restoreStore() {
  notifications.splice(
    0,
    notifications.length,
    ...PRISTINE_NOTIFICATIONS.map((n) => ({ ...n }))
  );
  comments.splice(0, comments.length, ...PRISTINE_COMMENTS.map((c) => ({ ...c })));
}

/**
 * Render a page behind a RouteGuard so the mock session resolves to
 * "authenticated" before the page's own useRole() runs (the production layouts
 * provide this guard; tests render the page directly so we add it here).
 */
function renderGuarded(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["employee", "approver", "finance"]}>
            {ui}
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  restoreStore();
  localStorage.clear();
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
});

afterEach(() => {
  restoreStore();
});

/* ====================================================================== */
/* In-App Notification Center                                              */
/* ====================================================================== */

describe("Notification center — badge, filter & click navigation", () => {
  it("unread badge count decrements reactively after a notification is marked read", async () => {
    seedSession("approver"); // 2 unread (nt-4, nt-5)
    renderGuarded(<NotificationsPage />);

    // AppBar bell exposes the live unread count in its aria-label.
    const bell = await screen.findByRole("link", {
      name: /notifications, 2 unread/i,
    });
    expect(bell).toBeInTheDocument();

    // Click one notification → marks it read (and would navigate).
    fireEvent.click(
      await screen.findByRole("button", { name: /aulia pratiwi submitted/i })
    );

    // Badge re-renders with the decremented count.
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /notifications, 1 unread/i })
      ).toBeInTheDocument();
    });
  });

  it("All / Unread / Read filters show the correct subsets", async () => {
    seedSession("finance"); // 3 notifications: 2 unread, 1 read
    renderGuarded(<NotificationsPage />);

    // All three are present by default.
    expect(await screen.findByText(/exception flagged/i)).toBeInTheDocument();
    expect(screen.getByText(/payment failed/i)).toBeInTheDocument();
    expect(screen.getByText(/claim ready to pay/i)).toBeInTheDocument();

    // Unread tab → only the two unread rows.
    fireEvent.click(screen.getByRole("tab", { name: /^unread/i }));
    await waitFor(() => expect(screen.queryByText(/claim ready to pay/i)).toBeNull());
    expect(screen.getByText(/exception flagged/i)).toBeInTheDocument();
    expect(screen.getByText(/payment failed/i)).toBeInTheDocument();

    // Read tab → only the read row.
    fireEvent.click(screen.getByRole("tab", { name: /^read/i }));
    await waitFor(() => expect(screen.queryByText(/exception flagged/i)).toBeNull());
    expect(screen.getByText(/claim ready to pay/i)).toBeInTheDocument();
  });

  it("clicking a notification marks it read and navigates to the claim detail view", async () => {
    seedSession("employee");
    renderGuarded(<NotificationsPage />);

    // nt-1 references clm-1003.
    fireEvent.click(
      await screen.findByRole("button", { name: /action required on exp-2026-1003/i })
    );

    expect(navMocks.push).toHaveBeenCalledWith("/employee/claims/clm-1003");
    // And the row is now read (badge cleared for the employee's single unread).
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /^notifications$/i })
      ).toBeInTheDocument();
    });
  });

  it("renders a clear empty state when there are no notifications for the role", async () => {
    // Drain every employee notification by marking, then re-render. The
    // employee still has notifications in the fixture, so instead mutate the
    // live array to empty for the employee audience.
    seedSession("employee");
    const original = notifications.splice(
      0,
      notifications.length,
      ...notifications
        .filter((n) => n.audience !== "employee")
        .map((n) => ({ ...n }))
    );
    try {
      renderGuarded(<NotificationsPage />);
      expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
    } finally {
      notifications.splice(0, notifications.length, ...original);
    }
  });
});

/* ====================================================================== */
/* Claim Comments                                                          */
/* ====================================================================== */

describe("Claim comments — validation, append, ordering & participant gate", () => {
  it("blocks an empty comment with a validation message, then appends a valid comment", async () => {
    seedSession("employee");
    navMocks.id = "clm-1001"; // u-emp-1 is the submitter → participant
    renderGuarded(<CommentsPage />);

    // Wait for the thread to load (has seeded cm-3).
    await screen.findByText(/flagged the taxi rides/i);

    // Empty submit → validation message, nothing appended.
    fireEvent.click(screen.getByRole("button", { name: /post comment/i }));
    expect(await screen.findByText(/comment body is required/i)).toBeInTheDocument();

    // Type and post → new comment appears at the end of the thread.
    fireEvent.change(screen.getByLabelText(/add a comment/i), {
      target: { value: "Heads up — expensing the airport taxi." },
    });
    fireEvent.click(screen.getByRole("button", { name: /post comment/i }));

    await screen.findByText("Heads up — expensing the airport taxi.");
    // Persisted to the live store.
    expect(
      comments.some(
        (c) =>
          c.claimId === "clm-1001" &&
          c.body === "Heads up — expensing the airport taxi."
      )
    ).toBe(true);
  });

  it("renders the thread sorted ascending by timestamp", async () => {
    seedSession("employee");
    navMocks.id = "clm-1003"; // cm-1 (14:22) then cm-2 (15:05)
    renderGuarded(<CommentsPage />);

    const first = await screen.findByText(/could you attach the hotel invoice/i);
    const second = await screen.findByText(/sure, i'll dig it out/i);
    // cm-1 precedes cm-2 in document order (ascending).
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("blocks a non-participant employee from viewing another employee's claim comments", async () => {
    seedSession("employee"); // u-emp-1
    navMocks.id = "clm-1004"; // belongs to u-emp-3
    renderGuarded(<CommentsPage />);

    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
    // Composer is not rendered for blocked sessions.
    expect(screen.queryByLabelText(/add a comment/i)).toBeNull();
  });

  it("shows an empty conversation state for a claim with no comments", async () => {
    seedSession("employee");
    navMocks.id = "clm-1002"; // submitter u-emp-1, no seeded comments
    renderGuarded(<CommentsPage />);
    expect(await screen.findByText(/no comments yet/i)).toBeInTheDocument();
  });
});

/* ====================================================================== */
/* Audit Trail Viewer                                                      */
/* ====================================================================== */

describe("Audit trail viewer — read-only, role-gated & chronological", () => {
  it("renders every audit entry with actor and timestamp in chronological order (Finance)", async () => {
    seedSession("finance");
    navMocks.id = "clm-1001"; // au-1..au-4
    renderGuarded(<AuditPage />);

    // Wait for the viewer to finish loading (first entry appears after the
    // simulated fetch latency).
    await screen.findByText("Submitted for approval");
    // Entries appear in chronological order (oldest first).
    const titles = [
      "Claim created",
      "Line items added",
      "Attachments uploaded",
      "Submitted for approval",
    ];
    const nodes = titles.map((t) => screen.getByText(t));
    for (let i = 0; i < nodes.length - 1; i++) {
      expect(
        nodes[i].compareDocumentPosition(nodes[i + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    // Actor is surfaced on each entry.
    expect(screen.getAllByText(/aulia pratiwi/i).length).toBeGreaterThan(0);
  });

  it("is strictly read-only: no edit / delete / modify controls are present", async () => {
    seedSession("finance");
    navMocks.id = "clm-1001";
    renderGuarded(<AuditPage />);

    await screen.findByText("Audit trail");
    // No destructive or mutative affordances anywhere in the viewer.
    const editable = screen.queryByRole("button", { name: /edit|delete|remove|modify|update/i });
    expect(editable).toBeNull();
  });

  it("blocks a non-Finance session with an access-denied message", async () => {
    seedSession("employee");
    navMocks.id = "clm-1001";
    renderGuarded(<AuditPage />);

    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
    expect(
      screen.getByText(/only available to finance admin/i)
    ).toBeInTheDocument();
  });

  it("renders correctly with a single lifecycle event (no error)", async () => {
    seedSession("finance");
    navMocks.id = "clm-1003"; // only au-5
    renderGuarded(<AuditPage />);

    expect(await screen.findByText("Returned for changes")).toBeInTheDocument();
    // Exactly one recorded event.
    expect(screen.getByText(/1 recorded event/i)).toBeInTheDocument();
  });
});

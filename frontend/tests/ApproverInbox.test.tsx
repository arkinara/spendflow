import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";

const navMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/approver",
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

import ApproverInboxPage from "@/app/approver/page";
import ApproverReviewPage from "@/app/approver/claims/[id]/page";
import { RouteGuard } from "@/components/shell/RouteGuard";
import { SessionProvider, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { SnackbarProvider } from "@/components/ui/Snackbar";
import { ThemeProvider } from "@/components/ui/ThemeToggle";
import {
  claims,
  comments,
  notifications,
  claimsForApprover,
  getClaim,
  computeClaimTotal,
  type Claim,
} from "@/lib/mock/mock_data";
import { decideOnClaim, addClaimComment } from "@/lib/mock/claimStore";

/* ----------------------------------------------------------------- helpers */

function seedApprover() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ userId: "u-mgr-1", role: "approver", issuedAt: Date.now() })
  );
}

/**
 * Pristine deep snapshot of the live mock store, captured at module load
 * (before any test in any suite runs). The approver suite mutates the shared
 * store heavily — deciding claims, pushing notifications, posting comments —
 * and vitest runs every file in a single fork, so we restore this baseline in
 * beforeEach/afterEach to keep each test (and neighbouring suites) isolated
 * from cross-test contamination.
 */
const PRISTINE_CLAIMS: Claim[] = claims.map((c) => JSON.parse(JSON.stringify(c)));
const PRISTINE_COMMENTS = comments.map((c) => ({ ...c }));
const PRISTINE_NOTIFICATIONS = notifications.map((n) => ({ ...n }));

function restoreStore() {
  claims.splice(
    0,
    claims.length,
    ...PRISTINE_CLAIMS.map((c) => JSON.parse(JSON.stringify(c)))
  );
  comments.splice(0, comments.length, ...PRISTINE_COMMENTS.map((c) => ({ ...c })));
  notifications.splice(
    0,
    notifications.length,
    ...PRISTINE_NOTIFICATIONS.map((n) => ({ ...n }))
  );
}

function renderInbox() {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["approver"]}>
            <ApproverInboxPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

function renderReview(id = "clm-1001") {
  navMocks.id = id;
  return render(
    <ThemeProvider>
      <SessionProvider>
        <SnackbarProvider>
          <RouteGuard allowedRoles={["approver"]}>
            <ApproverReviewPage />
          </RouteGuard>
        </SnackbarProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

/** Claim titles in rendered inbox order (one entry per row). */
function inboxClaimTitlesInOrder(): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const link of screen.getAllByRole("link")) {
    const href = link.getAttribute("href") ?? "";
    if (!/\/approver\/claims\/clm-/.test(href)) continue;
    const text = link.textContent ?? "";
    // The row link embeds the claim title; skip the short "Back to inbox" etc.
    if (text.length < 12 || seen.has(href)) continue;
    seen.add(href);
    titles.push(text);
  }
  return titles;
}

beforeEach(() => {
  restoreStore();
  localStorage.clear();
  seedApprover();
  navMocks.push.mockClear();
  navMocks.replace.mockClear();
});

afterEach(() => {
  restoreStore();
});

/* ----------------------------------------------------- Inbox Queue (sub-feature) */

describe("Approver inbox — queue filtering & empty state", () => {
  it("lists only claims pending at the approver's step, excluding decided/returned/other-status claims", async () => {
    renderInbox();

    // The two pending step-0 claims appear.
    expect(await screen.findByText("Q2 Client Visit – Jakarta")).toBeInTheDocument();
    expect(screen.getByText("Partner Meeting – Makassar")).toBeInTheDocument();

    // Decided / returned / draft claims do NOT appear in the inbox.
    expect(screen.queryByText("Vendor Workshop – Bandung")).toBeNull(); // action_required
    expect(screen.queryByText("Warehouse Audit – Surabaya")).toBeNull(); // draft
    expect(screen.queryByText("Regional Sales Sync – Medan")).toBeNull(); // approved

    // Sanity: store selector agrees with the rendered row count.
    expect(claimsForApprover()).toHaveLength(2);
    expect(inboxClaimTitlesInOrder()).toHaveLength(2);
  });

  it("shows a clear empty state when there are no pending decisions", async () => {
    // Decide every pending claim so the queue drains.
    decideOnClaim({
      claimId: "clm-1001",
      approverId: "u-mgr-1",
      action: "approve",
    });
    decideOnClaim({
      claimId: "clm-1008",
      approverId: "u-mgr-1",
      action: "reject",
      note: "Out of policy.",
    });

    renderInbox();
    expect(await screen.findByText(/inbox zero/i)).toBeInTheDocument();
    expect(inboxClaimTitlesInOrder()).toHaveLength(0);
  });

  it("removes a claim from the inbox immediately after a decision action", async () => {
    const view = renderInbox();
    await screen.findByText("Q2 Client Visit – Jakarta");
    expect(
      inboxClaimTitlesInOrder().some((t) => t.includes("Q2 Client Visit"))
    ).toBe(true);

    // Mutate the store (as the review page would) and force a fresh read.
    decideOnClaim({
      claimId: "clm-1001",
      approverId: "u-mgr-1",
      action: "approve",
    });

    // Unmount the stale view and re-render against the now-updated store.
    view.unmount();
    renderInbox();
    await waitFor(() =>
      expect(claimsForApprover().some((c) => c.id === "clm-1001")).toBe(false)
    );
    // The decided claim is gone; the other pending claim still renders.
    expect(await screen.findByText("Partner Meeting – Makassar")).toBeInTheDocument();
    expect(screen.queryByText("Q2 Client Visit – Jakarta")).toBeNull();
  });
});

describe("Approver inbox — sorting", () => {
  it("sorts by submission date (default newest first) and by amount in both directions", async () => {
    renderInbox();
    await screen.findByText("Q2 Client Visit – Jakarta");

    const date1001 = "2026-07-21T09:32:00+07:00"; // older
    const date1008 = "2026-07-25T14:00:00+07:00"; // newer
    expect(date1008 > date1001).toBe(true);

    // Default date_desc → Makassar (newer) first.
    expect(inboxClaimTitlesInOrder()[0]).toContain("Partner Meeting – Makassar");

    // Amount asc → Q2 (4,787,000) before Makassar (5,115,000).
    chooseSort("Amount (low → high)");
    await waitFor(() =>
      expect(inboxClaimTitlesInOrder()[0]).toContain("Q2 Client Visit – Jakarta")
    );

    // Amount desc → Makassar first.
    chooseSort("Amount (high → low)");
    await waitFor(() =>
      expect(inboxClaimTitlesInOrder()[0]).toContain("Partner Meeting – Makassar")
    );

    // Date asc → Q2 (older) first.
    chooseSort("Oldest first");
    await waitFor(() =>
      expect(inboxClaimTitlesInOrder()[0]).toContain("Q2 Client Visit – Jakarta")
    );
  });

  function chooseSort(label: string) {
    // Open the custom Select and pick the option. The trigger is the only
    // button exposing aria-haspopup="listbox".
    const trigger = screen.getByRole("button", {
      name: /newest first|oldest first|amount/i,
    });
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole("listbox")).getByText(label)
    );
  }
});

/* ------------------------------------------------- Claim Review Detail (sub-feature) */

describe("Approver review detail — line items, receipts, comments & policy flags", () => {
  it("renders every line item, receipt, currency total and an actionable decision panel", async () => {
    renderReview("clm-1001");
    const claim = getClaim("clm-1001")!;

    expect(await screen.findByText(claim.title)).toBeInTheDocument();

    // Every line item description is listed.
    for (const line of claim.lineItems) {
      expect(screen.getByText(line.description)).toBeInTheDocument();
    }

    // Total appears in the expense-lines footer.
    const totalCell = screen.getByText("Total claimed").parentElement!;
    expect(totalCell.querySelector("span:last-child")?.textContent).toBe(
      new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
      }).format(computeClaimTotal(claim))
    );

    // Decision actions are offered (claim is actionable).
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /request changes/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();

    // Attachments render with download affordances.
    expect(screen.getByText("flight-eticket.pdf")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /download /i }).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders cleanly for a claim with no comments and no policy flags (empty comments section)", async () => {
    // clm-1008 has no seeded comments and no exception.
    renderReview("clm-1008");
    expect(await screen.findByText("Partner Meeting – Makassar")).toBeInTheDocument();
    expect(
      screen.getByText(/no comments yet/i)
    ).toBeInTheDocument();
  });

  it("adds a comment without changing the claim status", async () => {
    renderReview("clm-1001");
    expect(await screen.findByText("Q2 Client Visit – Jakarta")).toBeInTheDocument();

    const before = getClaim("clm-1001")!.status;
    const field = screen.getByLabelText(/add a comment/i);
    fireEvent.change(field, { target: { value: "Looks good — approving shortly." } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(screen.getByText("Looks good — approving shortly.")).toBeInTheDocument()
    );
    // Status is untouched by the comment.
    expect(getClaim("clm-1001")!.status).toBe(before);
  });
});

/* ------------------------------------- Decision Dialogs (approve/return/reject) */

describe("Decision dialogs — approve advances / finalises, validation, conflict", () => {
  it("approves a single-step claim, marks it Approved, and removes it from the inbox", async () => {
    renderReview("clm-1001"); // 4.78M, single "Line manager" step
    expect(await screen.findByText("Q2 Client Visit – Jakarta")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    const dialog = await screen.findByRole("dialog");
    // Approve note is optional → confirm is enabled immediately.
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    await waitFor(() =>
      expect(getClaim("clm-1001")!.status).toBe("approved")
    );
    expect(getClaim("clm-1001")!.decidedAt).toBeTruthy();
    // Final approval notifies finance the claim is ready to pay.
    expect(
      notifications.some(
        (n) => n.claimId === "clm-1001" && /ready to pay/i.test(n.title)
      )
    ).toBe(true);
    // And leaves the approver inbox.
    expect(claimsForApprover().some((c) => c.id === "clm-1001")).toBe(false);
    expect(navMocks.push).toHaveBeenCalledWith("/approver");
  });

  it("approves a multi-step claim by advancing it to the next step (still pending, leaves inbox)", async () => {
    renderReview("clm-1008"); // 5.11M → "Line manager" → "Finance review"
    expect(await screen.findByText("Partner Meeting – Makassar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    await waitFor(() =>
      expect((getClaim("clm-1008")!.currentStepIndex ?? 0)).toBe(1)
    );
    // Advanced, not finalised.
    expect(getClaim("clm-1008")!.status).toBe("pending");
    // Finance is told the claim advanced.
    expect(
      notifications.some(
        (n) =>
          n.claimId === "clm-1008" &&
          /advanced to finance review/i.test(n.title)
      )
    ).toBe(true);
    // Leaves the approver's inbox even though still pending.
    expect(claimsForApprover().some((c) => c.id === "clm-1008")).toBe(false);
  });

  it("blocks Reject without a comment, then rejects with the recorded comment", async () => {
    renderReview("clm-1001");
    expect(await screen.findByText("Q2 Client Visit – Jakarta")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    const dialog = await screen.findByRole("dialog");

    // Confirm with an empty note → validation message, no state change.
    fireEvent.click(within(dialog).getByRole("button", { name: /^reject$/i }));
    expect(await within(dialog).findByText(/comment is required/i)).toBeInTheDocument();
    expect(getClaim("clm-1001")!.status).toBe("pending");

    // Provide a reason and confirm → rejected, comment recorded.
    fireEvent.change(within(dialog).getByLabelText(/reason for rejection/i), {
      target: { value: "Hotel upgrade is out of policy." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^reject$/i }));

    await waitFor(() =>
      expect(getClaim("clm-1001")!.status).toBe("rejected")
    );
    const last = getClaim("clm-1001")!.approvals.at(-1)!;
    expect(last.action).toBe("rejected");
    expect(last.note).toBe("Hotel upgrade is out of policy.");
    // Employee notified of the rejection.
    expect(
      notifications.some(
        (n) =>
          n.audience === "employee" &&
          n.claimId === "clm-1001" &&
          /rejected/i.test(n.title)
      )
    ).toBe(true);
  });

  it("blocks Request Changes without a comment, then returns the claim to the employee", async () => {
    renderReview("clm-1001");
    expect(await screen.findByText("Q2 Client Visit – Jakarta")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    const dialog = await screen.findByRole("dialog");

    // Empty confirm → blocked.
    fireEvent.click(within(dialog).getByRole("button", { name: /send back/i }));
    expect(await within(dialog).findByText(/comment is required/i)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/note to the employee/i), {
      target: { value: "Please attach the flight e-ticket PDF." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /send back/i }));

    await waitFor(() =>
      expect(getClaim("clm-1001")!.status).toBe("action_required")
    );
    const last = getClaim("clm-1001")!.approvals.at(-1)!;
    expect(last.action).toBe("returned");
    expect(last.note).toBe("Please attach the flight e-ticket PDF.");
    // Employee notified of the requested changes.
    expect(
      notifications.some(
        (n) =>
          n.audience === "employee" &&
          n.claimId === "clm-1001" &&
          /changes requested/i.test(n.title)
      )
    ).toBe(true);
  });

  it("shows a conflict message instead of silently succeeding on an already-decided (stale) claim", async () => {
    renderReview("clm-1001");
    expect(await screen.findByText("Q2 Client Visit – Jakarta")).toBeInTheDocument();

    // Simulate a stale UI: the claim is decided out-of-band while the review
    // page is still showing the actionable panel.
    decideOnClaim({
      claimId: "clm-1001",
      approverId: "u-mgr-1",
      action: "approve",
    });
    expect(getClaim("clm-1001")!.status).toBe("approved");

    // Now attempt to approve from the stale UI.
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    // Conflict dialog surfaces instead of a double-approval.
    expect(
      await screen.findByText(/this claim has changed/i)
    ).toBeInTheDocument();
    // No second approval event was appended.
    const approvals = getClaim("clm-1001")!.approvals.filter(
      (a) => a.action === "approved"
    );
    expect(approvals).toHaveLength(1);
  });
});

/* ------------------------------------------------------ direct store unit checks */

describe("Mock decision store — required-comment enforcement at the source", () => {
  it("rejects a decision request missing a required comment without mutating state", () => {
    expect(() =>
      decideOnClaim({
        claimId: "clm-1001",
        approverId: "u-mgr-1",
        action: "request_changes",
        note: "   ",
      })
    ).toThrow(/comment/i);
    expect(getClaim("clm-1001")!.status).toBe("pending");
  });

  it("posts a comment to the live comments store independently of status", () => {
    const before = comments.filter((c) => c.claimId === "clm-1001").length;
    const entry = addClaimComment({
      claimId: "clm-1001",
      authorId: "u-mgr-1",
      body: "Quick question on the taxi line.",
    });
    expect(entry.body).toBe("Quick question on the taxi line.");
    expect(comments.filter((c) => c.claimId === "clm-1001").length).toBe(
      before + 1
    );
    expect(getClaim("clm-1001")!.status).toBe("pending");
  });
});

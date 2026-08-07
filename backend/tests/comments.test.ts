/* ============================================================================
 * SpendFlow — claim comments + audit history API tests (ticket #15).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO,
  authedGet,
  authedPost,
  authedPatch,
  authedDelete,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";
import { provisionUser } from "../src/services/provision.js";
import { writeAudit, listAuditForClaim } from "../src/services/audit.js";
import * as auditService from "../src/services/audit.js";

let h: Harness;
let employeeCookie: string;
let approverCookie: string;
let financeCookie: string;
let outsiderCookie: string;
let claimId: string;

const OUTSIDER = {
  id: "u-outsider-1",
  email: "outsider@spendflow.example",
  name: "Outsider Person",
};

beforeEach(async () => {
  h = await bootstrap();
  employeeCookie = (await login(h.app, DEMO.employee.email)).cookie!;
  approverCookie = (await login(h.app, DEMO.approver.email)).cookie!;
  financeCookie = (await login(h.app, DEMO.finance.email)).cookie!;

  await provisionUser(h.db, {
    id: OUTSIDER.id,
    name: OUTSIDER.name,
    email: OUTSIDER.email,
    password: DEMO.password,
    role: "employee",
    roles: ["employee"],
    managerId: null,
    department: "Unrelated",
  });
  outsiderCookie = (await login(h.app, OUTSIDER.email)).cookie!;

  const createRes = await authedPost(h.app, "/api/claims", employeeCookie, {
    title: "Comments test claim",
    lineItems: [{ categoryId: "taxi", date: "2026-07-15", amount: 50_000 }],
  });
  const created = await createRes.json();
  claimId = created.claim.id;
  const submitRes = await authedPost(h.app, `/api/claims/${claimId}/submit`, employeeCookie, {});
  expect(submitRes.status).toBe(200);
  const decideRes = await authedPost(
    h.app,
    `/api/approver/claims/${claimId}/decisions`,
    approverCookie,
    { action: "approve" }
  );
  expect(decideRes.status).toBe(200);
  expect((await decideRes.json()).claim.status).toBe("approved");
});
afterEach(() => h.cleanup());

describe("POST /api/claims/:id/comments", () => {
  // (a) requires a non-empty body.
  it("rejects an empty comment body", async () => {
    const res = await authedPost(h.app, `/api/claims/${claimId}/comments`, employeeCookie, {
      body: "",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_body");
  });

  it("rejects a missing comment body", async () => {
    const res = await authedPost(h.app, `/api/claims/${claimId}/comments`, employeeCookie, {});
    expect(res.status).toBe(400);
  });

  // (b) scoped to claim participants — an outsider is rejected.
  it("rejects a comment from a user with no access to the claim", async () => {
    const res = await authedPost(h.app, `/api/claims/${claimId}/comments`, outsiderCookie, {
      body: "I shouldn't be able to post this",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  // Attribution + timestamp, and no claim-status mutation.
  it("attributes the comment to its author with a timestamp and leaves claim status untouched", async () => {
    const res = await authedPost(h.app, `/api/claims/${claimId}/comments`, approverCookie, {
      body: "Looks good to me.",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.comment.authorId).toBe(DEMO.approver.id);
    expect(body.comment.authorName).toBe(DEMO.approver.name);
    expect(body.comment.body).toBe("Looks good to me.");
    expect(new Date(body.comment.createdAt).getTime()).not.toBeNaN();

    const claimRes = await authedGet(h.app, `/api/claims/${claimId}`, financeCookie);
    expect((await claimRes.json()).claim.status).toBe("approved");
  });
});

describe("GET /api/claims/:id/comments", () => {
  // (c) ordered ascending by creation time.
  it("returns comments ordered ascending by creation time", async () => {
    await authedPost(h.app, `/api/claims/${claimId}/comments`, employeeCookie, { body: "first" });
    await authedPost(h.app, `/api/claims/${claimId}/comments`, approverCookie, { body: "second" });
    await authedPost(h.app, `/api/claims/${claimId}/comments`, financeCookie, { body: "third" });

    const res = await authedGet(h.app, `/api/claims/${claimId}/comments`, employeeCookie);
    expect(res.status).toBe(200);
    const bodies = (await res.json()).comments.map((c: { body: string }) => c.body);
    expect(bodies).toEqual(["first", "second", "third"]);
  });

  it("rejects a caller with no access to the claim", async () => {
    const res = await authedGet(h.app, `/api/claims/${claimId}/comments`, outsiderCookie);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/claims/:id/comment-authors", () => {
  // (d) participant set includes submitter, former approver, finance; excludes outsider.
  it("returns the claim's participants", async () => {
    const res = await authedGet(h.app, `/api/claims/${claimId}/comment-authors`, financeCookie);
    expect(res.status).toBe(200);
    const ids = (await res.json()).participants.map((p: { id: string }) => p.id);
    expect(ids).toContain(DEMO.employee.id);
    expect(ids).toContain(DEMO.approver.id);
    expect(ids).toContain(DEMO.finance.id);
    expect(ids).not.toContain(OUTSIDER.id);
  });

  it("rejects a caller with no access to the claim", async () => {
    const res = await authedGet(h.app, `/api/claims/${claimId}/comment-authors`, outsiderCookie);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/claims/:id/audit", () => {
  // (e) full lifecycle timeline in chronological order.
  it("returns the claim's audit history in chronological order", async () => {
    const res = await authedGet(h.app, `/api/claims/${claimId}/audit`, financeCookie);
    expect(res.status).toBe(200);
    const entries = (await res.json()).entries as Array<{ action: string; createdAt: string }>;
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const times = entries.map((e) => new Date(e.createdAt).getTime());
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
    expect(entries.some((e) => e.action.includes("submitted"))).toBe(true);
    expect(entries.some((e) => e.action.includes("approved"))).toBe(true);
  });

  // Submitter (a participant) can also read the claim's audit history.
  it("allows the submitter to read the claim's audit history", async () => {
    const res = await authedGet(h.app, `/api/claims/${claimId}/audit`, employeeCookie);
    expect(res.status).toBe(200);
  });

  // (f) a user with no access to the claim is rejected.
  it("rejects a caller with no access to the claim", async () => {
    const res = await authedGet(h.app, `/api/claims/${claimId}/audit`, outsiderCookie);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });
});

describe("audit log immutability", () => {
  // (g) listAuditForClaim is a pure read: repeated calls return identical
  // entries (no mutation path exists on the read side).
  it("returns identical entries on repeated reads", () => {
    writeAudit(h.db, {
      actorId: DEMO.finance.id,
      action: "manual_note",
      entityType: "claim",
      entityId: claimId,
      after: { note: "immutable snapshot" },
    });
    const first = listAuditForClaim(h.db, claimId);
    const second = listAuditForClaim(h.db, claimId);
    expect(second).toEqual(first);
    expect(first.some((e) => e.action === "manual_note")).toBe(true);
  });

  // The audit service exports no update/delete entry point — the only write is
  // append-only writeAudit, matching the "no update/delete path exists" rule.
  it("exposes no update or delete function on the audit service", () => {
    const mutators = Object.keys(auditService).filter((k) =>
      /(^|_)(update|delete|patch|remove|edit)(_|$)/i.test(k)
    );
    expect(mutators).toEqual([]);
    expect(typeof auditService.writeAudit).toBe("function");
    expect(typeof auditService.listAuditForClaim).toBe("function");
  });

  // No HTTP route mutates the audit log: PATCH/DELETE on the audit endpoint
  // are unhandled (404), proving no mutation surface is exposed over the API.
  it("rejects PATCH and DELETE on the audit endpoint (no mutation route)", async () => {
    const patchRes = await authedPatch(h.app, `/api/claims/${claimId}/audit`, financeCookie, {
      action: "tampered",
    });
    expect(patchRes.status).toBe(404);
    const deleteRes = await authedDelete(h.app, `/api/claims/${claimId}/audit`, financeCookie);
    expect(deleteRes.status).toBe(404);
  });
});

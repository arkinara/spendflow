/* ============================================================================
 * SpendFlow — notification query/mark-read API tests (ticket #15).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO,
  authedGet,
  authedPost,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";
import { writeNotification, unreadCount } from "../src/services/notifications.js";

let h: Harness;
let employeeCookie: string;
let approverCookie: string;

beforeEach(async () => {
  h = await bootstrap();
  employeeCookie = (await login(h.app, DEMO.employee.email)).cookie!;
  approverCookie = (await login(h.app, DEMO.approver.email)).cookie!;
});
afterEach(() => h.cleanup());

describe("GET /api/notifications", () => {
  // (a) newest-first ordering.
  it("returns the caller's notifications newest first", async () => {
    writeNotification(h.db, {
      recipientId: DEMO.employee.id,
      category: "system",
      title: "First",
      body: "oldest",
    });
    writeNotification(h.db, {
      recipientId: DEMO.employee.id,
      category: "system",
      title: "Second",
      body: "newest",
    });
    const res = await authedGet(h.app, "/api/notifications", employeeCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0].title).toBe("Second");
    expect(body.notifications[1].title).toBe("First");
  });

  // (b) a user only ever sees their own notifications, never another user's.
  it("never returns another user's notifications", async () => {
    writeNotification(h.db, {
      recipientId: DEMO.approver.id,
      category: "system",
      title: "Not yours",
      body: "belongs to the approver",
    });
    const res = await authedGet(h.app, "/api/notifications", employeeCookie);
    const body = await res.json();
    expect(body.notifications).toHaveLength(0);
  });

  // (c) unread=true filters to unread only.
  it("filters to unread notifications when unread=true", async () => {
    const n1 = writeNotification(h.db, {
      recipientId: DEMO.employee.id,
      category: "system",
      title: "Will be read",
      body: "b1",
    });
    writeNotification(h.db, {
      recipientId: DEMO.employee.id,
      category: "system",
      title: "Still unread",
      body: "b2",
    });
    await authedPost(h.app, `/api/notifications/${n1.id}/read`, employeeCookie, {});

    const res = await authedGet(h.app, "/api/notifications?unread=true", employeeCookie);
    const body = await res.json();
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].title).toBe("Still unread");
  });
});

describe("GET /api/notifications/unread-count", () => {
  // (d) accurate count, decremented by markRead.
  it("counts unread notifications and decrements after marking one read", async () => {
    const n1 = writeNotification(h.db, {
      recipientId: DEMO.employee.id,
      category: "system",
      title: "A",
      body: "a",
    });
    writeNotification(h.db, {
      recipientId: DEMO.employee.id,
      category: "system",
      title: "B",
      body: "b",
    });
    expect(unreadCount(h.db, DEMO.employee.id)).toBe(2);

    const before = await authedGet(h.app, "/api/notifications/unread-count", employeeCookie);
    expect((await before.json()).count).toBe(2);

    await authedPost(h.app, `/api/notifications/${n1.id}/read`, employeeCookie, {});

    const after = await authedGet(h.app, "/api/notifications/unread-count", employeeCookie);
    expect((await after.json()).count).toBe(1);
  });
});

describe("POST /api/notifications/:id/read", () => {
  // (e) marking read stamps readAt and is idempotent.
  it("marks a notification read", async () => {
    const n = writeNotification(h.db, {
      recipientId: DEMO.employee.id,
      category: "system",
      title: "Mark me",
      body: "body",
    });
    const res = await authedPost(h.app, `/api/notifications/${n.id}/read`, employeeCookie, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notification.readAt).not.toBeNull();
  });

  // (f) nonexistent id → clear not-found error, not a silent success.
  it("rejects marking a nonexistent notification as read", async () => {
    const res = await authedPost(h.app, "/api/notifications/does-not-exist/read", employeeCookie, {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  // (g) a user marking another user's notification is rejected as forbidden.
  it("rejects marking another user's notification as read", async () => {
    const n = writeNotification(h.db, {
      recipientId: DEMO.approver.id,
      category: "system",
      title: "Belongs to approver",
      body: "body",
    });
    const res = await authedPost(h.app, `/api/notifications/${n.id}/read`, employeeCookie, {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });
});

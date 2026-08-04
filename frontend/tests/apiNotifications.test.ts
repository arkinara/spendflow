import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  list,
  markRead,
  unreadCount,
  NotificationApiError,
  type BackendNotification,
} from "@/lib/api/notifications";
import { BE_URL } from "@/lib/auth/apiClient";

/**
 * Unit tests for the Notification HTTP client (ticket #22). The global
 * `fetch` is mocked per-test so nothing hits a real backend.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notification(overrides: Partial<BackendNotification> = {}): BackendNotification {
  return {
    id: "ntf-1",
    recipientId: "u-emp-1",
    category: "approval",
    title: "Claim approved",
    body: "Your claim was approved.",
    claimId: "clm-1",
    readAt: null,
    createdAt: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

describe("list", () => {
  it("GETs /api/notifications with credentials and returns the array", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { notifications: [notification()] }));

    const result = await list();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/notifications`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Claim approved");
  });

  it("appends ?unread=true when filtering to unread only", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { notifications: [] }));
    await list({ unreadOnly: true });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/notifications?unread=true`);
  });

  it("throws a NotificationApiError on a 401 (session expired)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorized", message: "Session expired." } }),
    );
    await expect(list()).rejects.toMatchObject({
      name: "NotificationApiError",
      status: 401,
      code: "unauthorized",
    });
  });
});

describe("markRead", () => {
  it("POSTs /api/notifications/:id/read and returns the updated row", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { notification: notification({ readAt: "2026-08-01T11:00:00Z" }) }),
    );
    const result = await markRead("ntf-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/notifications/ntf-1/read`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(result.readAt).toBe("2026-08-01T11:00:00Z");
  });

  it("throws a 403 NotificationApiError when marking another user's notification", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: { code: "forbidden", message: "This notification does not belong to you" },
      }),
    );
    const err = await markRead("ntf-x").catch((e) => e);
    expect(err).toBeInstanceOf(NotificationApiError);
    expect((err as NotificationApiError).status).toBe(403);
    expect((err as NotificationApiError).code).toBe("forbidden");
  });

  it("throws a 404 NotificationApiError for an unknown notification id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "Notification missing." } }),
    );
    await expect(markRead("ntf-missing")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
});

describe("unreadCount", () => {
  it("GETs /api/notifications/unread-count and returns the count", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { count: 3 }));
    const result = await unreadCount();
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/notifications/unread-count`);
    expect(result).toBe(3);
  });

  it("throws a NotificationApiError on a 401 (session expired)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorized", message: "Session expired." } }),
    );
    await expect(unreadCount()).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
  });
});

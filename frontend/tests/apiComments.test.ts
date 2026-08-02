import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  listComments,
  addComment,
  CommentApiError,
  type BackendComment,
} from "@/lib/api/comments";
import { BE_URL } from "@/lib/auth/apiClient";

/**
 * Unit tests for the Comment HTTP client (ticket #19). The global `fetch` is
 * mocked per-test so nothing hits a real backend.
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

function comment(overrides: Partial<BackendComment> = {}): BackendComment {
  return {
    id: "cmt-1",
    claimId: "clm-1",
    authorId: "u-mgr-1",
    authorName: "Dewi Anggraeni",
    body: "Looks good — approving shortly.",
    createdAt: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

describe("listComments", () => {
  it("GETs /api/claims/:id/comments with credentials and returns the array", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { comments: [comment()] }));

    const result = await listComments("clm-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/claims/clm-1/comments`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe("Looks good — approving shortly.");
    expect(result[0].authorName).toBe("Dewi Anggraeni");
  });

  it("encodes the id into the path segment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { comments: [] }));
    await listComments("clm/slash");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BE_URL}/api/claims/clm%2Fslash/comments`,
    );
  });

  it("throws a CommentApiError on a 403 (non-participant)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: { code: "forbidden", message: "You do not have access to this claim" },
      }),
    );
    await expect(listComments("clm-x")).rejects.toMatchObject({
      name: "CommentApiError",
      status: 403,
      code: "forbidden",
      message: "You do not have access to this claim",
    });
  });

  it("throws a CommentApiError on a 404 (unknown claim)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "Claim missing." } }),
    );
    await expect(listComments("clm-missing")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
});

describe("addComment", () => {
  it("POSTs the body JSON and returns the stored comment row", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { comment: comment() }));

    const result = await addComment("clm-1", "Looks good — approving shortly.");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/claims/clm-1/comments`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      body: "Looks good — approving shortly.",
    });
    expect(result.id).toBe("cmt-1");
  });

  it("throws a 400 CommentApiError carrying invalid_body when the BE rejects an empty body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "invalid_body", message: "Comment body is required" },
      }),
    );
    const err = await addComment("clm-1", " ").catch((e) => e);
    expect(err).toBeInstanceOf(CommentApiError);
    expect((err as CommentApiError).status).toBe(400);
    expect((err as CommentApiError).code).toBe("invalid_body");
    expect((err as CommentApiError).message).toBe("Comment body is required");
  });

  it("throws a 403 CommentApiError on a non-participant POST", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: { code: "forbidden", message: "You do not have access to this claim" },
      }),
    );
    await expect(addComment("clm-x", "hi")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

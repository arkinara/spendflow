import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  listUsers,
  changeUserRole,
  setUserManager,
  bulkChangeRole,
  deactivate,
  reactivate,
  getUserAudit,
  UsersApiError,
  BulkPartialFailureError,
  type BackendUser,
  type UserAuditEntry,
} from "@/lib/api/users";
import { BE_URL } from "@/lib/auth/apiClient";

/**
 * Unit tests for the user-directory HTTP client (ticket #30). `fetch` is
 * stubbed per test so nothing hits a real backend. Error envelopes use the
 * same `{ error: { code, message } }` shape `jsonError` (routes/claims.ts)
 * emits and `app.ts` applies to `UserServiceError`.
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

function backendUser(overrides: Partial<BackendUser> = {}): BackendUser {
  return {
    id: "u-emp-1",
    name: "Aulia Pratiwi",
    email: "aulia.pratiwi@spendflow.example",
    emailVerified: true,
    image: null,
    role: "employee",
    managerId: "u-mgr-1",
    department: "Operations",
    costCenter: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function auditEntry(overrides: Partial<UserAuditEntry> = {}): UserAuditEntry {
  return {
    id: "audit-1",
    actorId: "u-fin-1",
    action: "role.change",
    entityType: "user",
    entityId: "u-emp-1",
    before: { role: "employee" },
    after: { role: "approver" },
    createdAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("listUsers", () => {
  it("GETs /api/admin/users with credentials and returns the directory", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        users: [
          backendUser(),
          backendUser({ id: "u-fin-1", name: "Ridwan Saputra", email: "ridwan.saputra@spendflow.example", role: "finance", managerId: null, department: "Finance" }),
        ],
      }),
    );
    const result = await listUsers();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/users`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(result).toHaveLength(2);
    expect(result[0].email).toBe("aulia.pratiwi@spendflow.example");
    expect(result[1].role).toBe("finance");
  });

  it("throws UsersApiError 403 forbidden for a non-Finance-Admin session", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } }),
    );
    const err = await listUsers().catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("throws a typed error on a non-JSON success body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>broken</html>", { status: 200 }));
    const err = await listUsers().catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect((err as UsersApiError).code).toBe("internal");
  });
});

describe("changeUserRole", () => {
  it("PATCHes the role body and returns the updated user", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { user: backendUser({ role: "approver" }), audit: {} }),
    );
    const result = await changeUserRole("u-emp-1", "approver");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/users/u-emp-1/role`);
    expect(init).toMatchObject({ method: "PATCH", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      role: "approver",
      status: "active",
    });
    expect(result.role).toBe("approver");
  });

  it("encodes the user id into the path segment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: backendUser() }));
    await changeUserRole("u/slash", "finance");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/admin/users/u%2Fslash/role`);
  });

  it("throws a 400 invalid_role typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "invalid_role", message: "Role must be one of: employee, approver, finance" },
      }),
    );
    const err = await changeUserRole("u-emp-1", "finance").catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect((err as UsersApiError).status).toBe(400);
    expect((err as UsersApiError).code).toBe("invalid_role");
  });

  it("throws a 404 not_found typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "User nope not found" } }),
    );
    await expect(changeUserRole("nope", "approver")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
});

describe("setUserManager", () => {
  it("PATCHes a manager id and returns the updated user", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { user: backendUser({ managerId: "u-fin-1" }), audit: {} }),
    );
    const result = await setUserManager("u-emp-1", "u-fin-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/users/u-emp-1/manager`);
    expect(init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ managerId: "u-fin-1" });
    expect(result.managerId).toBe("u-fin-1");
  });

  it("clears the manager by sending null", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user: backendUser({ managerId: null }) }));
    const result = await setUserManager("u-emp-1", null);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      managerId: null,
    });
    expect(result.managerId).toBeNull();
  });

  it("throws a 400 self_manager typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { code: "self_manager", message: "A user cannot be their own manager" } }),
    );
    const err = await setUserManager("u-emp-1", "u-emp-1").catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect((err as UsersApiError).status).toBe(400);
    expect((err as UsersApiError).code).toBe("self_manager");
  });

  it("throws a 400 cycle typed error for a circular reporting line", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "cycle", message: "Setting that manager would create a circular reporting line" },
      }),
    );
    await expect(setUserManager("u-b", "u-a")).rejects.toMatchObject({
      status: 400,
      code: "cycle",
      message: /circular/,
    });
  });

  it("throws a 403 forbidden typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } }),
    );
    await expect(setUserManager("u-emp-1", "u-mgr-1")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

describe("bulkChangeRole", () => {
  it("loops changeUserRole and returns every updated user on a clean run", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { user: backendUser({ id: "u-emp-1", role: "approver" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { user: backendUser({ id: "u-mgr-1", role: "approver" }) }));

    const result = await bulkChangeRole(["u-emp-1", "u-mgr-1"], "approver");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result.every((u) => u.role === "approver")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/admin/users/u-emp-1/role`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${BE_URL}/api/admin/users/u-mgr-1/role`);
  });

  it("throws BulkPartialFailureError with details when some users fail", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { user: backendUser({ id: "u-emp-1", role: "finance" }) }))
      .mockResolvedValueOnce(
        jsonResponse(404, { error: { code: "not_found", message: "User gone" } }),
      );

    const err = await bulkChangeRole(["u-emp-1", "nope"], "finance").catch((e) => e);

    expect(err).toBeInstanceOf(BulkPartialFailureError);
    expect(err).toBeInstanceOf(UsersApiError);
    expect((err as BulkPartialFailureError).code).toBe("partial_failure");
    expect((err as BulkPartialFailureError).details).toHaveLength(1);
    expect((err as BulkPartialFailureError).details[0]).toMatchObject({
      userId: "nope",
    });
    expect((err as BulkPartialFailureError).details[0].error).toMatchObject({
      status: 404,
      code: "not_found",
      message: "User gone",
    });
  });

  it("returns an empty array without any network calls for empty input", async () => {
    const result = await bulkChangeRole([], "approver");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deactivate / reactivate (#33)", () => {
  it("deactivate reads the role, PATCHes status disabled, and returns an inactive row", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { users: [backendUser()] }))
      .mockResolvedValueOnce(jsonResponse(200, { user: backendUser(), audit: {} }));

    const result = await deactivate("u-emp-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First the directory is read to learn the user's current role…
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/admin/users`);
    // …then the role PATCH carries the status placeholder.
    const [patchUrl, init] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe(`${BE_URL}/api/admin/users/u-emp-1/role`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      role: "employee",
      status: "disabled",
    });
    expect(result.status).toBe("disabled");
  });

  it("reactivate PATCHes status active and returns an active row", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { users: [backendUser({ status: "disabled" })] }))
      .mockResolvedValueOnce(jsonResponse(200, { user: backendUser({ status: "disabled" }) }));

    const result = await reactivate("u-emp-1");

    const [patchUrl, init] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe(`${BE_URL}/api/admin/users/u-emp-1/role`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      role: "employee",
      status: "active",
    });
    // The BE doesn't persist the flag; the client reconciles the response.
    expect(result.status).toBe("active");
  });

  it("deactivate keeps a finance user's role in the body", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          users: [backendUser({ id: "u-fin-1", role: "finance", managerId: null })],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { user: backendUser({ id: "u-fin-1", role: "finance" }) })
      );

    const result = await deactivate("u-fin-1");

    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      role: "finance",
      status: "disabled",
    });
    expect(result.role).toBe("finance");
    expect(result.status).toBe("disabled");
  });

  it("throws cannot_deactivate_self when the BE rejects a self-deactivation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { users: [backendUser()] }))
      .mockResolvedValueOnce(
        jsonResponse(400, {
          error: { code: "cannot_deactivate_self", message: "You cannot deactivate your own account" },
        })
      );

    const err = await deactivate("u-emp-1").catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect((err as UsersApiError)).toMatchObject({ status: 400, code: "cannot_deactivate_self" });
  });

  it("throws cannot_deactivate_last_finance when deactivating the only finance user", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { users: [backendUser({ id: "u-fin-1", role: "finance" })] })
      )
      .mockResolvedValueOnce(
        jsonResponse(400, {
          error: { code: "cannot_deactivate_last_finance", message: "Cannot deactivate the last Finance Admin" },
        })
      );

    const err = await deactivate("u-fin-1").catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect((err as UsersApiError).code).toBe("cannot_deactivate_last_finance");
  });

  it("throws a 404 not_found without any PATCH when the target is missing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { users: [] }));

    const err = await deactivate("nope").catch((e) => e);

    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 404, code: "not_found" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getUserAudit (#34)", () => {
  it("fans out one GET per user, merges, sorts newest-first, and caps at limit", async () => {
    fetchMock
      // u-emp-1 → two entries (older)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          entries: [
            auditEntry({ id: "a1", createdAt: "2026-01-02T00:00:00Z" }),
            auditEntry({ id: "a2", actorId: "u-mgr-1", action: "manager.change", createdAt: "2026-01-01T00:00:00Z" }),
          ],
        })
      )
      // u-fin-1 → one newer entry
      .mockResolvedValueOnce(
        jsonResponse(200, {
          entries: [
            auditEntry({ id: "a3", entityId: "u-fin-1", action: "status.change", createdAt: "2026-01-03T00:00:00Z" }),
          ],
        })
      );

    const result = await getUserAudit({ userIds: ["u-emp-1", "u-fin-1"], limit: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/admin/users/u-emp-1/audit`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${BE_URL}/api/admin/users/u-fin-1/audit`);
    // Merged + sorted newest-first + capped at 2.
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["a3", "a1"]);
  });

  it("returns an empty array without any network calls for empty userIds", async () => {
    const result = await getUserAudit({ userIds: [] });
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a typed audit_unavailable error when a single user's fetch fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { entries: [auditEntry()] })
      )
      .mockResolvedValueOnce(
        jsonResponse(500, { error: { code: "internal", message: "Backend exploded." } })
      );

    const err = await getUserAudit({ userIds: ["u-emp-1", "u-fin-1"] }).catch((e) => e);

    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 0, code: "audit_unavailable" });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  listUsers,
  changeUserRole,
  setUserManager,
  bulkChangeRole,
  deactivate,
  reactivate,
  deleteUser,
  getUserAudit,
  createUser,
  getInvite,
  acceptInvite,
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

function jsonResponse(status: number, body: unknown, setCookie?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(setCookie ? { "set-cookie": setCookie } : {}),
    },
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

describe("deleteUser (#43)", () => {
  it("POSTs the password to /delete, uses credentials, and resolves on 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteUser("u-emp-1", "s3cret");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/users/u-emp-1/delete`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      password: "s3cret",
    });
  });

  it("encodes the user id into the path segment", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteUser("u/slash", "s3cret");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BE_URL}/api/admin/users/u%2Fslash/delete`
    );
  });

  it("throws a 401 invalid_password typed error for a wrong actor password", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        error: { code: "invalid_password", message: "Invalid password" },
      })
    );

    const err = await deleteUser("u-emp-1", "wrong").catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 401, code: "invalid_password" });
  });

  it("throws a 403 forbidden typed error for a non-Finance-Admin caller", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } })
    );

    const err = await deleteUser("u-emp-1", "s3cret").catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("throws a 404 not_found typed error for an unknown user id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "User nope not found" } })
    );

    const err = await deleteUser("nope", "s3cret").catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 404, code: "not_found" });
  });

  it("throws a 409 cannot_delete_active_user typed error for an active target", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: {
          code: "cannot_delete_active_user",
          message: "Active users cannot be deleted",
        },
      })
    );

    const err = await deleteUser("u-emp-1", "s3cret").catch((e) => e);
    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 409, code: "cannot_delete_active_user" });
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

/* ------------------------------------------------------ invite flow (#36) == */

describe("createUser (#36)", () => {
  const PENDING = backendUser({
    id: "u-new-1",
    name: "Citra Lestari",
    email: "citra.lestari@spendflow.example",
    role: "approver",
    managerId: null,
    department: "Operations",
    status: "pending",
  });
  const INVITE = {
    token: "tok_secret",
    sentAt: "2026-01-05T00:00:00Z",
    expiresAt: "2026-01-12T00:00:00Z",
  };

  it("POSTs the create payload with credentials and returns the pending user + invite", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { user: PENDING, invite: INVITE }));

    const result = await createUser({
      email: "citra.lestari@spendflow.example",
      name: "Citra Lestari",
      role: "approver",
      managerId: "u-mgr-1",
      department: "Operations",
      jobTitle: "Finance Analyst",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/users`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: "citra.lestari@spendflow.example",
      name: "Citra Lestari",
      role: "approver",
      managerId: "u-mgr-1",
      department: "Operations",
      jobTitle: "Finance Analyst",
    });
    expect(result.user).toMatchObject({ id: "u-new-1", status: "pending" });
    expect(result.invite.token).toBe("tok_secret");
  });

  it("omits optional fields entirely when not provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { user: PENDING, invite: INVITE }));
    await createUser({ email: "citra@spendflow.example", name: "Citra Lestari", role: "employee" });

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      email: "citra@spendflow.example",
      name: "Citra Lestari",
      role: "employee",
    });
  });

  it("throws a 409 email_exists typed error for a duplicate email", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: {
          code: "email_exists",
          message: "A user with email citra@spendflow.example already exists",
        },
      }),
    );

    const err = await createUser({
      email: "citra@spendflow.example",
      name: "Citra Lestari",
      role: "employee",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 409, code: "email_exists" });
  });

  it("throws a 400 invalid_email typed error for a malformed address", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { code: "invalid_email", message: "Invalid email format" } }),
    );

    const err = await createUser({
      email: "not-an-email",
      name: "Citra Lestari",
      role: "employee",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 400, code: "invalid_email" });
  });

  it("throws a 403 forbidden typed error for a non-Finance-Admin caller", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "forbidden", message: "Finance admins only." } }),
    );

    const err = await createUser({
      email: "citra@spendflow.example",
      name: "Citra Lestari",
      role: "employee",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("throws a 400 validation typed error for other body errors", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: { code: "invalid_role", message: "Invalid role" } }),
    );

    const err = await createUser({
      email: "citra@spendflow.example",
      name: "Citra Lestari",
      role: "admin" as never,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UsersApiError);
    expect(err).toMatchObject({ status: 400, code: "invalid_role" });
  });
});

describe("getInvite (#36)", () => {
  const DETAILS = {
    email: "citra.lestari@spendflow.example",
    name: "Citra Lestari",
    role: "approver" as const,
    managerId: null,
    department: "Operations",
    jobTitle: null,
    costCenter: null,
  };

  it("GETs the public invite endpoint and returns the invitee details", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, DETAILS));

    const result = await getInvite("tok_secret");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/invites/tok_secret`);
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
    expect(result).toEqual(DETAILS);
  });

  it("encodes the token into the path segment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, DETAILS));
    await getInvite("to/k");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BE_URL}/api/admin/invites/to%2Fk`);
  });

  it("throws a 404 invite_invalid typed error for an unknown token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, {
        error: { code: "invite_invalid", message: "Invitation not found. Please request a new invite." },
      }),
    );

    await expect(getInvite("nope")).rejects.toMatchObject({
      status: 404,
      code: "invite_invalid",
    });
  });

  it("throws a 410 invite_expired typed error for an expired token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(410, {
        error: { code: "invite_expired", message: "This invitation has expired. Please request a new invite." },
      }),
    );

    await expect(getInvite("expired")).rejects.toMatchObject({
      status: 410,
      code: "invite_expired",
    });
  });

  it("throws a 410 invite_consumed typed error for a used token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(410, {
        error: { code: "invite_consumed", message: "This invitation has already been used." },
      }),
    );

    await expect(getInvite("used")).rejects.toMatchObject({
      status: 410,
      code: "invite_consumed",
    });
  });
});

describe("acceptInvite (#36)", () => {
  const ACTIVE = backendUser({
    id: "u-new-1",
    name: "Citra Lestari",
    email: "citra.lestari@spendflow.example",
    role: "approver",
    status: "active",
  });

  it("POSTs the password and returns the activated user", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { user: ACTIVE }, "session_token=abc; HttpOnly; Path=/"),
    );

    const result = await acceptInvite("tok_secret", "supersecret1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BE_URL}/api/admin/invites/tok_secret/accept`);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      password: "supersecret1",
    });
    expect(result.user).toMatchObject({ id: "u-new-1", status: "active" });
  });

  it("throws a 400 invalid_password typed error when the BE rejects the password", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "invalid_password", message: "Password must be at least 8 characters" },
      }),
    );

    await expect(acceptInvite("tok_secret", "short")).rejects.toMatchObject({
      status: 400,
      code: "invalid_password",
    });
  });

  it("throws a 410 invite_consumed typed error for a used token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(410, {
        error: { code: "invite_consumed", message: "This invitation has already been used." },
      }),
    );

    await expect(acceptInvite("used", "supersecret1")).rejects.toMatchObject({
      status: 410,
      code: "invite_consumed",
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useUsers, useUserAudit } from "@/lib/hooks/useUsers";
import { UsersApiError, type BackendUser, type UserAuditEntry } from "@/lib/api/users";

/**
 * State-machine tests for `useUsers` (ticket #30). `@/lib/api/users` is mocked
 * so the hook's transitions (loading → ready | error | denied, plus retry /
 * refresh) are exercised without a real backend.
 */

const usersMocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  deactivate: vi.fn(),
  reactivate: vi.fn(),
  deleteUser: vi.fn(),
  getUserAudit: vi.fn(),
}));

vi.mock("@/lib/api/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/users")>();
  return {
    ...actual,
    listUsers: usersMocks.listUsers,
    deactivate: usersMocks.deactivate,
    reactivate: usersMocks.reactivate,
    deleteUser: usersMocks.deleteUser,
    getUserAudit: usersMocks.getUserAudit,
  };
});

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

beforeEach(() => {
  usersMocks.listUsers.mockReset();
  usersMocks.deactivate.mockReset();
  usersMocks.reactivate.mockReset();
  usersMocks.deleteUser.mockReset();
  usersMocks.getUserAudit.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUsers", () => {
  it("starts loading then resolves to a ready list", async () => {
    usersMocks.listUsers.mockResolvedValue([backendUser()]);
    const { result } = renderHook(() => useUsers());

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    if (result.current.state.status === "ready") {
      expect(result.current.state.rows).toHaveLength(1);
      expect(result.current.state.rows[0].email).toBe("aulia.pratiwi@spendflow.example");
    }
  });

  it("maps a 403 to the denied state", async () => {
    usersMocks.listUsers.mockRejectedValue(
      new UsersApiError(403, "forbidden", "Finance admins only."),
    );
    const { result } = renderHook(() => useUsers());

    await waitFor(() => expect(result.current.state.status).toBe("denied"));
  });

  it("maps other errors to the error state with the BE message", async () => {
    usersMocks.listUsers.mockRejectedValue(
      new UsersApiError(500, "internal", "Backend exploded."),
    );
    const { result } = renderHook(() => useUsers());

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status === "error") {
      expect(result.current.state.message).toMatch(/Backend exploded/);
    }
  });

  it("carries a non-UsersApiError message into the error state", async () => {
    usersMocks.listUsers.mockRejectedValue(new Error("Network is down."));
    const { result } = renderHook(() => useUsers());

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status === "error") {
      expect(result.current.state.message).toMatch(/Network is down/);
    }
  });

  it("retry re-runs the load and transitions back to ready on success", async () => {
    usersMocks.listUsers
      .mockRejectedValueOnce(new UsersApiError(500, "internal", "First attempt failed."))
      .mockResolvedValueOnce([backendUser({ id: "u-fin-1", role: "finance" })]);
    const { result } = renderHook(() => useUsers());

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    act(() => {
      result.current.retry();
    });

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it("refresh re-runs the load after a mutation", async () => {
    usersMocks.listUsers.mockResolvedValue([backendUser()]);
    const { result } = renderHook(() => useUsers());

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(usersMocks.listUsers).toHaveBeenCalledTimes(1);

    usersMocks.listUsers.mockResolvedValue([
      backendUser(),
      backendUser({ id: "u-fin-1", name: "Ridwan Saputra", role: "finance" }),
    ]);
    result.current.refresh();

    await waitFor(() => expect(usersMocks.listUsers).toHaveBeenCalledTimes(2));
    if (result.current.state.status === "ready") {
      expect(result.current.state.rows).toHaveLength(2);
    }
  });

  it("deactivate flips the row to disabled optimistically and keeps it on success", async () => {
    usersMocks.listUsers.mockResolvedValue([backendUser()]);
    usersMocks.deactivate.mockResolvedValue(backendUser({ status: "disabled" }));
    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    let promise: Promise<BackendUser>;
    act(() => {
      promise = result.current.deactivate("u-emp-1");
    });

    // Chip flips immediately — before the API resolves (no refetch).
    if (result.current.state.status === "ready") {
      expect(result.current.state.rows[0].status).toBe("disabled");
    }
    expect(usersMocks.deactivate).toHaveBeenCalledWith("u-emp-1");

    await act(() => promise!);

    // Success keeps the optimistic update and reconciles with the response.
    if (result.current.state.status === "ready") {
      expect(result.current.state.rows[0].status).toBe("disabled");
    }
    // No directory re-read — the flip is purely client-side.
    expect(usersMocks.listUsers).toHaveBeenCalledTimes(1);
  });

  it("reactivate flips the row back to active optimistically on success", async () => {
    usersMocks.listUsers.mockResolvedValue([backendUser({ status: "disabled" })]);
    usersMocks.reactivate.mockResolvedValue(backendUser({ status: "active" }));
    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    let promise: Promise<BackendUser>;
    act(() => {
      promise = result.current.reactivate("u-emp-1");
    });

    if (result.current.state.status === "ready") {
      expect(result.current.state.rows[0].status).toBe("active");
    }
    await act(() => promise!);
    if (result.current.state.status === "ready") {
      expect(result.current.state.rows[0].status).toBe("active");
    }
  });

  it("rolls the row back to its prior status and rethrows on failure", async () => {
    usersMocks.listUsers.mockResolvedValue([backendUser()]);
    usersMocks.deactivate.mockRejectedValue(
      new UsersApiError(500, "internal", "Backend exploded."),
    );
    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.deactivate("u-emp-1");
      } catch (err) {
        caught = err;
      }
    });

    // Rolled back to "active", error rethrown for the dialog to surface.
    if (result.current.state.status === "ready") {
      expect(result.current.state.rows[0].status).toBe("active");
    }
    expect(caught).toBeInstanceOf(UsersApiError);
    expect((caught as UsersApiError).message).toMatch(/Backend exploded/);
  });

  it("deleteUser removes the row from the cache on success (no refetch)", async () => {
    usersMocks.listUsers.mockResolvedValue([
      backendUser(),
      backendUser({ id: "u-pend-1", name: "Budi Santoso", status: "pending" }),
    ]);
    usersMocks.deleteUser.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    if (result.current.state.status === "ready") {
      expect(result.current.state.rows).toHaveLength(2);
    }

    await act(async () => {
      await result.current.deleteUser("u-pend-1", "s3cret");
    });

    expect(usersMocks.deleteUser).toHaveBeenCalledWith("u-pend-1", "s3cret");
    if (result.current.state.status === "ready") {
      expect(result.current.state.rows).toHaveLength(1);
      expect(result.current.state.rows[0].id).toBe("u-emp-1");
    }
    // No directory re-read — the removal is purely client-side.
    expect(usersMocks.listUsers).toHaveBeenCalledTimes(1);
  });

  it("deleteUser rethrows on failure and leaves the cache untouched", async () => {
    usersMocks.listUsers.mockResolvedValue([backendUser()]);
    usersMocks.deleteUser.mockRejectedValue(
      new UsersApiError(401, "invalid_password", "Invalid password"),
    );
    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.deleteUser("u-emp-1", "wrong");
      } catch (err) {
        caught = err;
      }
    });

    // Row still present — a failed delete never blanks the cache.
    if (result.current.state.status === "ready") {
      expect(result.current.state.rows).toHaveLength(1);
    }
    expect(caught).toBeInstanceOf(UsersApiError);
    expect((caught as UsersApiError)).toMatchObject({
      status: 401,
      code: "invalid_password",
    });
  });
});

describe("useUserAudit (#34)", () => {
  it("with null filters transitions straight to ready with empty entries (no network)", async () => {
    const { result } = renderHook(() => useUserAudit(null));

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    if (result.current.state.status === "ready") {
      expect(result.current.state.entries).toEqual([]);
    }
    expect(usersMocks.getUserAudit).not.toHaveBeenCalled();
  });

  it("starts loading then resolves to a ready entry list", async () => {
    usersMocks.getUserAudit.mockResolvedValue([auditEntry()]);
    const { result } = renderHook(() =>
      useUserAudit({ userIds: ["u-emp-1"], limit: 50 })
    );

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(usersMocks.getUserAudit).toHaveBeenCalledWith({
      userIds: ["u-emp-1"],
      limit: 50,
    });
    if (result.current.state.status === "ready") {
      expect(result.current.state.entries).toHaveLength(1);
    }
  });

  it("maps a 403 to the denied state", async () => {
    usersMocks.getUserAudit.mockRejectedValue(
      new UsersApiError(403, "forbidden", "Finance admins only."),
    );
    const { result } = renderHook(() => useUserAudit({ userIds: ["u-emp-1"] }));

    await waitFor(() => expect(result.current.state.status).toBe("denied"));
  });

  it("maps other errors to the error state and refresh retries", async () => {
    usersMocks.getUserAudit
      .mockRejectedValueOnce(new UsersApiError(500, "internal", "Backend exploded."))
      .mockResolvedValueOnce([auditEntry()]);
    const { result } = renderHook(() => useUserAudit({ userIds: ["u-emp-1"] }));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status === "error") {
      expect(result.current.state.message).toMatch(/Backend exploded/);
    }

    act(() => {
      result.current.refresh();
    });

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(usersMocks.getUserAudit).toHaveBeenCalledTimes(2);
  });

  it("re-reads when the userIds array reference changes", async () => {
    usersMocks.getUserAudit.mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ userIds }: { userIds: string[] }) =>
        useUserAudit({ userIds, limit: 50 }),
      { initialProps: { userIds: ["u-emp-1"] } },
    );

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(usersMocks.getUserAudit).toHaveBeenCalledTimes(1);

    rerender({ userIds: ["u-emp-1", "u-fin-1"] });

    await waitFor(() => expect(usersMocks.getUserAudit).toHaveBeenCalledTimes(2));
    expect(usersMocks.getUserAudit).toHaveBeenLastCalledWith({
      userIds: ["u-emp-1", "u-fin-1"],
      limit: 50,
    });
  });

  it("carries a non-UsersApiError message into the error state", async () => {
    usersMocks.getUserAudit.mockRejectedValue(new Error("Network is down."));
    const { result } = renderHook(() => useUserAudit({ userIds: ["u-emp-1"] }));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status === "error") {
      expect(result.current.state.message).toMatch(/Network is down/);
    }
  });
});

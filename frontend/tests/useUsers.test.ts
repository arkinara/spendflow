import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useUsers } from "@/lib/hooks/useUsers";
import { UsersApiError, type BackendUser } from "@/lib/api/users";

/**
 * State-machine tests for `useUsers` (ticket #30). `@/lib/api/users` is mocked
 * so the hook's transitions (loading → ready | error | denied, plus retry /
 * refresh) are exercised without a real backend.
 */

const usersMocks = vi.hoisted(() => ({ listUsers: vi.fn() }));

vi.mock("@/lib/api/users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/users")>();
  return { ...actual, listUsers: usersMocks.listUsers };
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

beforeEach(() => {
  usersMocks.listUsers.mockReset();
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
});

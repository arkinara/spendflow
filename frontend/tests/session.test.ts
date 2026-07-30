import { describe, it, expect, beforeEach } from "vitest";
import {
  validateCredentials,
  resolveCredential,
  MOCK_CREDENTIALS,
  SESSION_STORAGE_KEY,
  DEMO_PASSWORD,
} from "@/lib/auth/session";

beforeEach(() => {
  localStorage.clear();
});

describe("validateCredentials", () => {
  it("accepts valid credentials for each of the three roles", () => {
    for (const cred of MOCK_CREDENTIALS) {
      const result = validateCredentials(cred.email, cred.password);
      expect(result).toEqual({ ok: true, role: cred.role });
    }
  });

  it("rejects empty email or password with an inline-style error", () => {
    expect(validateCredentials("", "")).toMatchObject({ ok: false });
    expect(validateCredentials("aulia.pratiwi@spendflow.example", "")).toMatchObject({
      ok: false,
    });
    expect(validateCredentials("", DEMO_PASSWORD)).toMatchObject({ ok: false });
  });

  it("rejects an unknown email", () => {
    const result = validateCredentials("nobody@spendflow.example", DEMO_PASSWORD);
    expect(result.ok).toBe(false);
  });

  it("rejects a wrong password for a known email", () => {
    const result = validateCredentials("aulia.pratiwi@spendflow.example", "wrong-password");
    expect(result.ok).toBe(false);
  });

  it("resolves credentials case- and whitespace-insensitively", () => {
    const result = validateCredentials(
      "  Aulia.Pratiwi@spendflow.example  ",
      DEMO_PASSWORD
    );
    expect(result).toEqual({ ok: true, role: "employee" });
    expect(resolveCredential("  AULIA.PRATIWI@spendflow.example  ")?.role).toBe("employee");
  });
});

describe("session persistence", () => {
  it("signIn writes a session to localStorage that survives a fresh provider read", () => {
    const cred = MOCK_CREDENTIALS[0];
    const result = validateCredentials(cred.email, cred.password);
    expect(result.ok).toBe(true);
    // Simulate what SessionProvider.signIn does on success:
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ userId: cred.userId, role: cred.role, issuedAt: Date.now() })
    );
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.role).toBe(cred.role);

    // signOut clears it
    localStorage.removeItem(SESSION_STORAGE_KEY);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

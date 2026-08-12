import { eq } from "drizzle-orm";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { DEMO, bootstrap, type Harness } from "./helpers.js";
import { auditLogsTable } from "../src/db/schema.js";
import { PII_FIELDS, REDACTED, redactPII, redactSnapshot } from "../src/services/audit-redaction.js";
import { auditAll, auditForEntity, writeAudit } from "../src/services/audit.js";

/**
 * #77 — PII redaction in audit snapshots. Covers:
 *   1. writeAudit scrubs passwordHash on insert (top-level field).
 *   2. writeAudit walks nested objects/arrays and only redacts the PII keys.
 *   3. read paths (auditAll / auditForEntity) redact legacy rows on the way
 *      out (defense-in-depth) — bypassing writeAudit and seeding raw rows
 *      directly via the table.
 *   4. CSV export renders the redacted form (covered indirectly by the JSON
 *      assertion here; the dedicated CSV test already verifies the CSV column
 *      uses `auditAll`).
 */

let h: Harness;

beforeEach(async () => {
  h = await bootstrap();
});

afterEach(() => {
  h.cleanup();
});

describe("audit-redaction helpers", () => {
  it("PII_FIELDS is non-empty and includes passwordHash variants", () => {
    expect(PII_FIELDS.size).toBeGreaterThan(0);
    expect(PII_FIELDS.has("passwordhash")).toBe(true);
    expect(PII_FIELDS.has("password_hash")).toBe(true);
    expect(PII_FIELDS.has("token")).toBe(true);
    expect(PII_FIELDS.has("secret")).toBe(true);
  });

  it("REDACTED is the [REDACTED] sentinel", () => {
    expect(REDACTED).toBe("[REDACTED]");
  });

  it("redactPII passes through null / undefined / numbers / booleans / Dates", () => {
    expect(redactPII(null)).toBeNull();
    expect(redactPII(undefined)).toBeUndefined();
    expect(redactPII(42)).toBe(42);
    expect(redactPII(true)).toBe(true);
    const d = new Date("2026-08-12T00:00:00Z");
    expect(redactPII(d)).toBe(d);
  });

  it("redactPII redacts a PII-keyed string at the root key", () => {
    expect(redactPII("hunter2", "password")).toBe(REDACTED);
    expect(redactPII("hashed-bytes", "passwordHash")).toBe(REDACTED);
    expect(redactPII("keep", "email")).toBe("keep");
  });

  it("redactSnapshot normalises Date → ISO string", () => {
    const d = new Date("2026-08-12T00:00:00Z");
    const out = redactSnapshot({ createdAt: d, name: "x" }) as {
      createdAt: string;
      name: string;
    };
    expect(out.createdAt).toBe(d.toISOString());
    expect(out.name).toBe("x");
  });
});

describe("writeAudit redaction (#77)", () => {
  it("redacts passwordHash on insert while preserving email", () => {
    const entry = writeAudit(h.db, {
      actorId: DEMO.finance.id,
      action: "user.create",
      entityType: "user",
      entityId: DEMO.employee.id,
      before: {
        email: "x@y.com",
        passwordHash: "argon2id$abc",
      },
    });

    // Returned entry already redacted (same shape as DB row).
    const before = entry.before as { email: string; passwordHash: string };
    expect(before.email).toBe("x@y.com");
    expect(before.passwordHash).toBe(REDACTED);

    // DB row serialised the redacted form.
    const row = h.db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.id, entry.id))
      .all()[0];
    const dbBefore = JSON.parse(row.before as string) as {
      email: string;
      passwordHash: string;
    };
    expect(dbBefore.email).toBe("x@y.com");
    expect(dbBefore.passwordHash).toBe(REDACTED);
  });

  it("redacts nested PII fields but leaves siblings untouched", () => {
    const entry = writeAudit(h.db, {
      actorId: DEMO.finance.id,
      action: "user.update",
      entityType: "user",
      entityId: DEMO.employee.id,
      before: {
        user: { password: "abc", name: "John" },
        tokens: ["t1", "t2"],
      },
      after: {
        user: { password: "xyz", name: "John" },
        tokens: ["t3"],
      },
    });

    const before = entry.before as {
      user: { password: string; name: string };
      tokens: string[];
    };
    expect(before.user.password).toBe(REDACTED);
    expect(before.user.name).toBe("John");
    // tokens is not a PII key — array contents untouched.
    expect(before.tokens).toEqual(["t1", "t2"]);

    const after = entry.after as {
      user: { password: string; name: string };
      tokens: string[];
    };
    expect(after.user.password).toBe(REDACTED);
    expect(after.user.name).toBe("John");
    expect(after.tokens).toEqual(["t3"]);
  });

  it("does not mutate the caller's input snapshot", () => {
    const input = {
      email: "keep@y.com",
      passwordHash: "secret-bytes",
      nested: { token: "t" },
    };
    writeAudit(h.db, {
      actorId: DEMO.finance.id,
      action: "user.update",
      entityType: "user",
      entityId: DEMO.employee.id,
      before: input,
    });
    expect(input.email).toBe("keep@y.com");
    expect(input.passwordHash).toBe("secret-bytes");
    expect(input.nested.token).toBe("t");
  });
});

describe("read-path defense-in-depth (#77)", () => {
  // Bypass writeAudit (which now redacts on write) by inserting a raw,
  // pre-redaction-style row directly — then assert the read paths redact on
  // the way out so a legacy unredacted row never leaks.
  function seedRawLegacyAudit(args: {
    id: string;
    action: string;
    before?: unknown;
    after?: unknown;
  }) {
    h.db
      .insert(auditLogsTable)
      .values({
        id: args.id,
        actorId: DEMO.finance.id,
        action: args.action,
        entityType: "user",
        entityId: DEMO.employee.id,
        before:
          args.before === undefined ? null : JSON.stringify(args.before),
        after: args.after === undefined ? null : JSON.stringify(args.after),
        createdAt: new Date(),
      })
      .run();
  }

  it("auditAll redacts legacy unredacted rows on read", () => {
    seedRawLegacyAudit({
      id: "legacy-1",
      action: "role.change",
      before: { email: "leak@y.com", passwordHash: "raw-hash" },
      after: { email: "leak@y.com", passwordHash: "raw-hash", role: "approver" },
    });

    const rows = auditAll(h.db, {});
    expect(rows).toHaveLength(1);
    const before = rows[0].before as { email: string; passwordHash: string };
    const after = rows[0].after as { email: string; passwordHash: string; role: string };
    expect(before.email).toBe("leak@y.com");
    expect(before.passwordHash).toBe(REDACTED);
    expect(after.passwordHash).toBe(REDACTED);
    expect(after.role).toBe("approver");
  });

  it("auditForEntity redacts legacy unredacted rows on read", () => {
    seedRawLegacyAudit({
      id: "legacy-2",
      action: "status.change",
      before: { password: "plaintext", name: "Aulia" },
    });

    const rows = auditForEntity(h.db, "user", DEMO.employee.id);
    expect(rows).toHaveLength(1);
    const before = rows[0].before as { password: string; name: string };
    expect(before.password).toBe(REDACTED);
    expect(before.name).toBe("Aulia");
  });
});

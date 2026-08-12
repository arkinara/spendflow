/**
 * #77 — PII redaction for audit-log `before`/`after` JSON snapshots.
 *
 * Audit snapshots are JSON-stringified before insert, and legacy rows written
 * before this ticket may carry raw PII (e.g. `passwordHash`). Redaction runs
 * at both write time (so new rows are clean) and read time (defense-in-depth:
 * a legacy unredacted row still never leaks through `auditAll` /
 * `auditForEntity` / `listAuditForClaim`).
 *
 * `email` and `name` are intentionally NOT redacted — the audit trail needs
 * them to stay useful ("Aulia's role changed from employee to approver").
 */

/**
 * Field names whose value is considered PII / secret and must be replaced with
 * {@link REDACTED} when found as an object key. Matched case-insensitively so
 * a column rename or a casing drift (`passwordHash` vs `password_hash`) does
 * not silently leak.
 */
export const PII_FIELDS = new Set<string>([
  "password",
  "passwordhash",
  "password_hash",
  "totpsecret",
  "totp_secret",
  "token",
  "refreshtoken",
  "refresh_token",
  "sessiontoken",
  "session_token",
  "resettoken",
  "reset_token",
  "invitetoken",
  "invite_token",
  "apikey",
  "api_key",
  "secret",
]);

/** Sentinel value substituted for redacted PII. */
export const REDACTED = "[REDACTED]" as const;
export type RedactedValue = typeof REDACTED;

/** True when `v` is a plain object (not null, not array, not Date). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  if (v instanceof Date) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Walk `value` recursively. When the value is a string reached via a PII
 * object key (case-insensitive), replace with {@link REDACTED}. Arrays and
 * plain objects are recursed; everything else (numbers, booleans, Dates,
 * nulls) is returned as-is.
 *
 * @param value   current node value
 * @param keyHint parent object key when invoked from an object iteration
 *                (undefined at the root or inside arrays)
 */
export function redactPII(value: unknown, keyHint?: string): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (keyHint !== undefined && PII_FIELDS.has(keyHint.toLowerCase())) {
      return REDACTED;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((el) => redactPII(el, keyHint));
  }

  if (value instanceof Date) {
    return value;
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactPII(v, k);
    }
    return out;
  }

  return value;
}

/**
 * Top-level redaction helper for audit snapshots: runs {@link redactPII} and
 * additionally normalises `Date` instances to ISO strings so the subsequent
 * `JSON.stringify` in `writeAudit` is fully serialisable (legacy callers that
 * pass a Date-bearing object still round-trip cleanly).
 */
export function redactSnapshot(snapshot: unknown): unknown {
  const redacted = redactPII(snapshot);
  return normaliseDates(redacted);
}

/** Recursively convert Date instances to ISO strings for JSON safety. */
function normaliseDates(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normaliseDates);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normaliseDates(v);
    return out;
  }
  return value;
}

/* ============================================================================
 * SpendFlow — RFC-4180 CSV helpers (ticket #72).
 *
 * Small, reusable primitives so the audit-log CSV export (#72) and future
 * exports (#74, #75) share one escaping + join implementation. The reporting
 * export (#16) keeps its own `escapeCsvField` in `services/reporting.ts` for
 * backward compatibility with its existing tests; new code should use this
 * module.
 * ========================================================================== */

/**
 * Coerce a single value to its CSV cell representation, then apply RFC-4180
 * escaping:
 *
 *  - string / number / boolean → string
 *  - null / undefined → empty string
 *  - array → comma-joined string of its stringified items
 *  - object → `JSON.stringify` (defensive — guards against accidentally
 *    feeding a structured value through; callers should `JSON.stringify`
 *    intentionally when they want a stable JSON cell, e.g. audit `before`)
 *
 * A field containing a comma, double-quote, CR, or LF is wrapped in double
 * quotes; embedded double-quotes are doubled (`"` → `""`).
 */
export function escapeCsvField(value: unknown): string {
  let s: string;
  if (value === null || value === undefined) {
    s = "";
  } else if (typeof value === "string") {
    s = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    s = String(value);
  } else if (Array.isArray(value)) {
    s = value
      .map((v) =>
        v === null || v === undefined
          ? ""
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v),
      )
      .join(",");
  } else if (typeof value === "object") {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a full RFC-4180 CSV body from `headers` + `rows`. The body starts
 * with a UTF-8 BOM (`\uFEFF`) so Excel opens the file as UTF-8 without
 * needing the Text Import Wizard. Rows are joined with CRLF (`\r\n`) per
 * RFC-4180 §2.2. Each row's cells are passed through {@link escapeCsvField}.
 */
export function rowsToCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(escapeCsvField).join(",");
  const dataLines = rows.map((r) => r.map(escapeCsvField).join(","));
  return "\uFEFF" + [headerLine, ...dataLines].join("\r\n");
}

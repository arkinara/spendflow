/* ============================================================================
 * SpendFlow — mobile claim submission service (ticket #88, Phase 2 mobile).
 *
 * Accepts the mobile app's OcrDraft shape (merchant/date/amount/tax as raw
 * OCR strings, Indonesian "." thousands separators, DD/MM/YYYY dates) and
 * maps it onto the canonical createClaim + submitClaim path, so the resulting
 * claim, audit trail, policy flags, and notification fan-out are exactly what
 * the web wizard would have produced for the same data.
 * ========================================================================== */

import { eq } from "drizzle-orm";
import { categoriesTable } from "../db/schema.js";
import type { DB } from "../db/index.js";
import {
  ClaimError,
  createClaim,
  submitClaim,
  type ClaimRow,
} from "./claims.js";

/** Request body shape mirroring the Flutter `OcrDraft` model (mobile/lib/models). */
export interface MobileClaimSubmission {
  merchant: string;
  /** DD/MM/YYYY, exactly as the OCR pass read it. */
  date: string;
  /** Raw Indonesian-format string, e.g. "391.830". */
  amount: string;
  tax: string;
  /** ISO 4217, e.g. "IDR". */
  currency: string;
  /** Human category name, e.g. "Meals" — resolved against the categories table. */
  category: string;
  description: string;
  receiptUrl?: string;
}

export interface MobileClaimResult {
  claim: ClaimRow;
}

const INDONESIAN_AMOUNT_RE = /^\d{1,3}(\.\d{3})*$/;
const DD_MM_YYYY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Parse an Indonesian-format amount string ("391.830") into a minor-units
 * integer (391830). Throws ClaimError(400, invalid_amount) on any shape the
 * zod layer (or a direct service caller) failed to guarantee.
 */
export function parseIndonesianAmount(raw: string): number {
  if (!INDONESIAN_AMOUNT_RE.test(raw)) {
    throw new ClaimError(
      400,
      "invalid_amount",
      `Amount "${raw}" is not a valid Indonesian-format number (e.g. 391.830)`
    );
  }
  return Number.parseInt(raw.replace(/\./g, ""), 10);
}

/** Convert DD/MM/YYYY ("15/07/2026") to ISO ("2026-07-15"). */
function toIsoDate(raw: string): string {
  const m = DD_MM_YYYY_RE.exec(raw);
  if (!m) {
    throw new ClaimError(
      400,
      "invalid_amount",
      `Date "${raw}" must be DD/MM/YYYY`
    );
  }
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/**
 * Resolve a human category name ("Meals") to the active categories-table row
 * (case-insensitive exact match on `name`). Unknown → 400 invalid_category.
 */
function resolveCategoryByName(db: DB, name: string) {
  const wanted = name.trim().toLowerCase();
  const row = db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.active, true))
    .all()
    .find((c) => c.name.toLowerCase() === wanted);
  if (!row) {
    throw new ClaimError(
      400,
      "invalid_category",
      `Category "${name}" does not exist`
    );
  }
  return row;
}

/**
 * Submit an OCR draft as a claim in one step: map the draft onto the canonical
 * createClaim + submitClaim path. Policy evaluation, approval routing, audit,
 * notifications, and SLA stamping all happen inside that path — a mobile
 * submission is indistinguishable from a web wizard submission of the same
 * data. Policy warnings (e.g. over category cap) are stamped as non-blocking
 * `policyFlag`s on the line, never blocking the submit.
 */
export async function submitMobileClaim(
  db: DB,
  actorId: string,
  input: MobileClaimSubmission
): Promise<MobileClaimResult> {
  const category = resolveCategoryByName(db, input.category);
  const amount = parseIndonesianAmount(input.amount);
  // Parsed for validation symmetry with the web wizard's tax field; the
  // canonical line schema has no separate tax column — tax stays embedded in
  // the OCR amount the user confirmed.
  parseIndonesianAmount(input.tax);

  const draft = createClaim(db, actorId, {
    title: input.merchant.trim(),
    purpose: input.description.trim(),
    currency: input.currency,
    lineItems: [
      {
        categoryId: category.id,
        description: input.description.trim(),
        date: toIsoDate(input.date),
        amount,
        currency: input.currency,
        note: input.receiptUrl,
      },
    ],
  });

  const { claim } = submitClaim(db, draft.id, actorId);
  return { claim };
}

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
import { categoriesTable, mobileDraftsTable } from "../db/schema.js";
import type { DB } from "../db/index.js";
import {
  ClaimError,
  createClaim,
  submitClaim,
  type ClaimRow,
  type LineItemInput,
} from "./claims.js";
import type { PolicyWarning } from "./policy.js";

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

/**
 * The mobile OCR draft shape (#100): identical to {@link MobileClaimSubmission}
 * but WITHOUT `receiptUrl` — the mobile app's on-device draft is the confirmed
 * OCR fields only, and receipt metadata rides along on the final submit.
 */
export interface OcrDraft {
  merchant: string;
  date: string;
  amount: string;
  tax: string;
  currency: string;
  category: string;
  description: string;
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
 * Result of mapping one mobile OcrDraft onto the canonical LineItem shape
 * (#101). The `line` is exactly what {@link createClaim} consumes, so the
 * mobile submit path and the web wizard produce byte-identical rows for the
 * same category/amount/date. `flags` is always `[]` — policy warnings are
 * evaluated by {@link submitClaim}'s applySubmission pass (same as the web
 * path), never pre-stamped by a draft mapping.
 */
export interface DraftLineMapping {
  line: LineItemInput;
  flags: PolicyWarning[];
}

/**
 * Map a mobile OcrDraft onto a single canonical LineItemInput (#101). Pure +
 * DB-scoped only for the category name → row resolution:
 *  - merchant  → claim title (composed by {@link submitMobileClaim}, mirroring
 *    the web wizard; NOT folded into the line description — that would break
 *    byte-identity with web lines, which carry the bare description)
 *  - amount    "391.830" → int 391830 (Indonesian thousands separator)
 *  - tax       parsed for symmetry with the web tax field; the canonical line
 *    schema has NO separate tax column, so tax stays embedded in the OCR total
 *    amount the user confirmed (documented — mirrors the web, which also has
 *    no per-line tax)
 *  - date      "15/07/2026" → "2026-07-15" (ISO)
 *  - category  "Meals" label → category row id "meals" (case-insensitive).
 *    VERIFIED #101: the web sends the category ROW id ("meals"), not the
 *    display code ("MEL") — resolving to the id keeps phone ↔ web identical.
 *  - currency  → line.currency (mirrors web line.currency)
 *  - receiptUrl → line.note (real attachment rows are #103, not here)
 *  - description → line.description (mirrors the web wizard)
 */
export function ocrDraftToLineItem(
  db: DB,
  input: MobileClaimSubmission
): DraftLineMapping {
  const category = resolveCategoryByName(db, input.category);
  const amount = parseIndonesianAmount(input.amount);
  // Parsed for validation symmetry with the web wizard's tax field; the
  // canonical line schema has no separate tax column — tax stays embedded in
  // the OCR amount the user confirmed.
  parseIndonesianAmount(input.tax);
  const note = input.receiptUrl?.trim() ? input.receiptUrl.trim() : undefined;
  return {
    line: {
      categoryId: category.id,
      description: input.description.trim(),
      date: toIsoDate(input.date),
      amount,
      currency: input.currency,
      note,
    },
    flags: [],
  };
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
  const { line } = ocrDraftToLineItem(db, input);

  const draft = createClaim(db, actorId, {
    title: input.merchant.trim(),
    purpose: input.description.trim(),
    currency: input.currency,
    lineItems: [line],
  });

  const { claim } = submitClaim(db, draft.id, actorId);
  return { claim };
}

/* ----------------------------------------------- drafts/current + sync (#100) */

/**
 * Persist the authenticated user's current OCR draft (upsert, one row per
 * user — last write wins per #100; no merge/CRDT). The stored row is read
 * back so the returned draft is exactly what round-trips the database.
 */
export function saveMobileDraft(
  db: DB,
  actorId: string,
  input: OcrDraft
): OcrDraft {
  const draftJson = JSON.stringify(input);
  const now = new Date().toISOString();
  db.insert(mobileDraftsTable)
    .values({ userId: actorId, draftJson, updatedAt: now })
    .onConflictDoUpdate({
      target: mobileDraftsTable.userId,
      set: { draftJson, updatedAt: now },
    })
    .run();
  const row = db
    .select()
    .from(mobileDraftsTable)
    .where(eq(mobileDraftsTable.userId, actorId))
    .get();
  return row ? (JSON.parse(row.draftJson) as OcrDraft) : input;
}

/**
 * Push every locally-queued offline submission in one call (#100). Each item
 * is submitted as its OWN claim through {@link submitMobileClaim} — there is
 * no batch-claim concept. Per-item failures (ClaimError: invalid_category,
 * invalid_amount, etc.) are collected into `failed[]` and never fatal; the
 * client reports `synced` vs the failed count. Unexpected (non-ClaimError)
 * failures still propagate as a 500.
 */
export async function syncMobileClaims(
  db: DB,
  actorId: string,
  items: MobileClaimSubmission[]
): Promise<{ synced: number; failed: MobileClaimSubmission[] }> {
  let synced = 0;
  const failed: MobileClaimSubmission[] = [];
  for (const item of items) {
    try {
      await submitMobileClaim(db, actorId, item);
      synced += 1;
    } catch (err) {
      if (err instanceof ClaimError) {
        failed.push(item);
      } else {
        throw err;
      }
    }
  }
  return { synced, failed };
}

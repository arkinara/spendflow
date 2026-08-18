/* ============================================================================
 * SpendFlow — mobile API routes (ticket #88, Phase 2 mobile).
 *
 * POST /api/mobile/claims — accepts the mobile app's OcrDraft shape (raw OCR
 * strings, Indonesian number formatting, DD/MM/YYYY dates) and submits it
 * through the canonical claim path. Employees only: the capture → confirm →
 * draft flow is an employee self-service action.
 * ========================================================================== */

import { Hono } from "hono";
import { z } from "zod";
import type { Auth } from "../auth/index.js";
import { requireRole } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import {
  saveMobileDraft,
  submitMobileClaim,
  syncMobileClaims,
} from "../services/mobile-claims.js";
import {
  ALLOWED_MIME,
  MAX_FILE_BYTES,
  sanitiseFileName,
} from "../services/attachments.js";
import { getReceiptStorage } from "../services/storage.js";
import { decideMobileInboxItem, mobileApproverInbox } from "../services/approvals.js";
import { jsonError } from "./claims.js";

const mobileClaimSchema = z.object({
  merchant: z.string().min(1).max(200),
  date: z.string().regex(/^\d{1,2}\/\d{1,2}\/\d{4}$/, "Expected DD/MM/YYYY"),
  amount: z.string().regex(/^\d{1,3}(\.\d{3})*$/, "Indonesian amount format"),
  tax: z.string().regex(/^\d{1,3}(\.\d{3})*$/, "Indonesian amount format"),
  currency: z.string().length(3), // ISO 4217
  category: z.string().min(1).max(64),
  description: z.string().min(1).max(500),
  receiptUrl: z.string().url().optional(),
});

// #100 — the on-device OCR draft shape: the mobile claim shape WITHOUT
// receiptUrl. Used by PATCH /api/mobile/drafts/current.
const mobileDraftSchema = mobileClaimSchema.omit({ receiptUrl: true });

// #100 — offline sync body: a non-empty array of #88 claim shapes.
const mobileSyncSchema = z.object({
  items: z.array(mobileClaimSchema),
});

// #100 — mobile inbox decision values (maps onto the web decision engine).
const mobileDecideSchema = z.object({
  decision: z.enum(["approve", "reject", "return"]),
});

export function mobileClaimsRoutes(deps: {
  auth: Auth;
  db: DB;
  env: Env;
}): Hono {
  const router = new Hono();
  // #103 — the receipt bytes land in the same storage driver the web
  // attachments use (#76): local disk by default, S3/R2 when configured.
  const storage = getReceiptStorage(deps.env);

  router.post("/api/mobile/receipts", async (c) => {
    // Only employees upload receipts — the capture → confirm flow is
    // employee self-service.
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "employee");
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(c, 400, "invalid_file", "Missing 'file' in multipart body");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = (file.type || "application/octet-stream").toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      return jsonError(
        c,
        415,
        "invalid_file",
        `Unsupported file type ${file.type}. Allowed: image/*, application/pdf.`
      );
    }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return jsonError(
        c,
        413,
        "file_too_large",
        `File is ${bytes.byteLength} bytes; max is ${MAX_FILE_BYTES}.`
      );
    }
    // Namespaced by uploader so one draft's frames never collide with another
    // user's. The returned reference feeds the draft's receiptUrl field (#103).
    const key = `mobile/${ctx.user.id}/${sanitiseFileName(file.name || "receipt")}`;
    const stored = await storage.store(bytes, {
      filename: key,
      contentType: mime,
      sizeBytes: bytes.byteLength,
    });
    return c.json(
      { receiptUrl: stored.publicUrl, key: stored.key, sizeBytes: stored.sizeBytes },
      201
    );
  });

  router.post("/api/mobile/claims", async (c) => {
    // Only employees submit expense claims (approvers/finance review them).
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "employee");
    const body = await c.req.json().catch(() => ({}));
    const parsed = mobileClaimSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    const result = await submitMobileClaim(deps.db, ctx.user.id, parsed.data);
    return c.json({ claim: result.claim }, 201);
  });

  /* ------------------------- #100 drafts/current + sync + inbox decide ----- */

  router.patch("/api/mobile/drafts/current", async (c) => {
    // Only employees persist drafts — the capture/confirm flow is employee
    // self-service (approvers/finance never draft expense claims).
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "employee");
    const body = await c.req.json().catch(() => ({}));
    const parsed = mobileDraftSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    const draft = saveMobileDraft(deps.db, ctx.user.id, parsed.data);
    return c.json({ draft }, 200);
  });

  router.post("/api/mobile/sync", async (c) => {
    const ctx = await requireRole(deps.auth, c.req.raw.headers, "employee");
    const body = await c.req.json().catch(() => ({}));
    const parsed = mobileSyncSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_body", parsed.error.message);
    }
    if (parsed.data.items.length === 0) {
      return jsonError(c, 400, "no_items", "Sync requires at least one item");
    }
    // Partial success is not fatal: each item gets its own claim, and per-item
    // failures ride back in `failed[]` with a 200 status.
    const { synced, failed } = await syncMobileClaims(
      deps.db,
      ctx.user.id,
      parsed.data.items
    );
    return c.json({ synced, failed }, 200);
  });

  router.get("/api/inbox/:approverId", async (c) => {
    // The mobile app's approver inbox (#101). Approvers + finance review;
    // identity is taken from the session (the path id mirrors the client's
    // contract, per the mobile RestClaimRepository.listInbox wire shape).
    const ctx = await requireRole(deps.auth, c.req.raw.headers, [
      "approver",
      "finance",
    ]);
    const inbox = mobileApproverInbox(deps.db, ctx.user.id, ctx.user.roles);
    return c.json({ inbox }, 200);
  });

  router.post("/api/mobile/inbox/:id/decide", async (c) => {
    // Approvers + finance decide (employees do NOT) — same role set as the
    // web approver decision path.
    const ctx = await requireRole(deps.auth, c.req.raw.headers, [
      "approver",
      "finance",
    ]);
    const body = await c.req.json().catch(() => ({}));
    const parsed = mobileDecideSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "invalid_decision", parsed.error.message);
    }
    // The mobile inbox item id IS the claim id.
    const outcome = await decideMobileInboxItem(
      deps.db,
      ctx.user.id,
      ctx.user.roles,
      c.req.param("id"),
      parsed.data.decision
    );
    return c.json({ outcome }, 200);
  });

  return router;
}

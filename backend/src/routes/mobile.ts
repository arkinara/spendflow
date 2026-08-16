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
import { submitMobileClaim } from "../services/mobile-claims.js";
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

export function mobileClaimsRoutes(deps: {
  auth: Auth;
  db: DB;
  env: Env;
}): Hono {
  const router = new Hono();

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

  return router;
}

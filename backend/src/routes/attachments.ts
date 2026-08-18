/* ============================================================================
 * SpendFlow — Attachment HTTP routes (ticket #11).
 *
 * Multipart upload (file + manual metadata fields) + authenticated download.
 * No OCR, no auto-extraction. Bytes land on local disk under backend/uploads/.
 * ========================================================================== */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Auth } from "../auth/index.js";
import { AuthError, requireUser } from "../auth/permissions.js";
import type { DB } from "../db/index.js";
import type { Env } from "../config.js";
import {
  AttachmentError,
  deleteAttachment,
  resolveAttachmentForDownload,
  storeAttachment,
} from "../services/attachments.js";
import { getReceiptStorage } from "../services/storage.js";
import { jsonError } from "./claims.js";

export function attachmentRoutes(deps: { auth: Auth; db: DB; env: Env }): Hono {
  const router = new Hono();
  // #76: active storage driver (local disk by default; S3/R2 when configured).
  const storage = getReceiptStorage(deps.env);

  /**
   * Upload a receipt attachment against a line item. Accepts multipart/form-data
   * with a `file` field (image/PDF) and optional manual metadata fields:
   * merchant, amount, currency, transactionDate.
   */
  router.post(
    "/api/claims/:id/line-items/:lineId/attachments",
    async (c) => {
      const ctx = await requireUser(deps.auth, c.req.raw.headers);
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return jsonError(c, 400, "invalid_file", "Missing 'file' in multipart body");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const metadata = {
        merchant: optString(form.get("merchant")),
        amount: optNumber(form.get("amount")),
        currency: optString(form.get("currency")),
        transactionDate: optString(form.get("transactionDate")),
      };
      const attachment = await storeAttachment(
        deps.db,
        {
          claimId: c.req.param("id"),
          lineItemId: c.req.param("lineId"),
          actorId: ctx.user.id,
          fileName: file.name || "receipt",
          mimeType: file.type || "application/octet-stream",
          bytes,
          metadata,
        },
        { uploadsDirOverride: deps.env.uploadsDir ?? null, storage }
      );
      return c.json({ attachment }, 201);
    }
  );

  /**
   * Download a stored attachment. Auth + scope checked server-side: only the
   * owner, an assigned approver, or finance may access it. Local driver streams
   * the bytes; S3 driver 302-redirects to the public URL (#76).
   */
  router.get("/api/attachments/:id", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    const result = await resolveAttachmentForDownload(
      deps.db,
      c.req.param("id"),
      { id: ctx.user.id, roles: ctx.user.roles },
      {
        uploadsDirOverride: deps.env.uploadsDir ?? null,
        storage,
        driver: deps.env.storageDriver,
      }
    );
    if (result.mode === "s3") {
      return c.redirect(result.redirectUrl, 302);
    }
    return new Response(result.bytes, {
      status: 200,
      headers: {
        "content-type": result.row.mimeType,
        "content-length": String(result.bytes.byteLength),
        "content-disposition": `inline; filename="${encodeURIComponent(result.row.fileName)}"`,
      },
    });
  });

  router.delete("/api/attachments/:id", async (c) => {
    const ctx = await requireUser(deps.auth, c.req.raw.headers);
    await deleteAttachment(deps.db, c.req.param("id"), ctx.user.id, {
      uploadsDirOverride: deps.env.uploadsDir ?? null,
      storage,
    });
    return c.json({ ok: true });
  });

  return router;
}

function optString(v: string | File | null | undefined): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function optNumber(v: string | File | null | undefined): number | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Map attachment service errors to JSON responses. */
export function attachmentErrorHandler(err: unknown, c: Context) {
  if (err instanceof AttachmentError) {
    return jsonError(
      c,
      err.status as ContentfulStatusCode,
      err.code,
      err.message
    );
  }
  if (err instanceof AuthError) {
    return jsonError(
      c,
      err.status as ContentfulStatusCode,
      err.code,
      err.message
    );
  }
  const msg = err instanceof Error ? err.message : "Internal error";
  return jsonError(c, 500, "internal", msg);
}

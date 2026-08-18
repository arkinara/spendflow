/* ============================================================================
 * SpendFlow — mobile receipt upload tests (ticket #103).
 *
 * POST /api/mobile/receipts — the capture-screen image path. Multipart JPEG in,
 * durable storage reference (receiptUrl + key + sizeBytes) out, via the same
 * storage driver seam as web attachments (#76). No claim/line-item context:
 * the draft has not been submitted yet, so the file lands under a per-user
 * namespace instead of a line-item folder.
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { DEMO, authedPostForm, bootstrap, login, type Harness } from "./helpers.js";

let h: Harness;
let employeeCookie: string;

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

beforeEach(async () => {
  h = await bootstrap();
  const res = await login(h.app, DEMO.employee.email);
  expect(res.status).toBe(200);
  employeeCookie = res.cookie!;
});
afterEach(() => h.cleanup());

describe("POST /api/mobile/receipts", () => {
  it("stores a JPEG under the uploader's namespace and returns a durable reference", async () => {
    const res = await authedPostForm(h.app, "/api/mobile/receipts", employeeCookie, {
      file: new Blob([JPEG], { type: "image/jpeg" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.receiptUrl).toBe(body.key); // local driver: public URL == key
    expect(body.key).toMatch(new RegExp(`^mobile/${DEMO.employee.id}/`));
    expect(body.sizeBytes).toBe(JPEG.byteLength);

    // The bytes actually landed on disk under the driver's uploads dir.
    const abs = join(h.env.uploadsDir!, body.key);
    const meta = await stat(abs);
    expect(meta.size).toBe(JPEG.byteLength);
    expect(await readFile(abs)).toEqual(Buffer.from(JPEG));
  });

  it("rejects a non-image/PDF MIME type with 415 invalid_file", async () => {
    const res = await authedPostForm(h.app, "/api/mobile/receipts", employeeCookie, {
      file: new Blob([new TextEncoder().encode("#!/bin/sh")], { type: "text/plain" }),
    });
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_file");
  });

  it("rejects a missing file field with 400 invalid_file", async () => {
    const res = await authedPostForm(h.app, "/api/mobile/receipts", employeeCookie, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_file");
  });

  it("rejects an approver with 403 forbidden (employees only)", async () => {
    const res = await login(h.app, DEMO.approver.email);
    const approverCookie = res.cookie!;
    const upload = await authedPostForm(h.app, "/api/mobile/receipts", approverCookie, {
      file: new Blob([JPEG], { type: "image/jpeg" }),
    });
    expect(upload.status).toBe(403);
    const body = await upload.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await authedPostForm(h.app, "/api/mobile/receipts", null, {
      file: new Blob([JPEG], { type: "image/jpeg" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
  });
});
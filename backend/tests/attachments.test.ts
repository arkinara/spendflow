/* ============================================================================
 * SpendFlow — Attachment upload/retrieval/scope tests (ticket #11, Attachment
 * Storage & Manual Metadata API sub-feature).
 * ========================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO,
  authedDelete,
  authedGet,
  authedPost,
  authedPostForm,
  bootstrap,
  login,
  type Harness,
} from "./helpers.js";

// #76: stub the AWS SDK module so the S3 driver never touches the network in
// tests. storage.ts constructs S3Client / PutObjectCommand against these fakes.
const s3Mock = vi.hoisted(() => {
  class FakePutObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class FakeDeleteObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class FakeS3Client {
    async send(): Promise<unknown> {
      return {};
    }
  }
  return { FakeS3Client, FakePutObjectCommand, FakeDeleteObjectCommand };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: s3Mock.FakeS3Client,
  PutObjectCommand: s3Mock.FakePutObjectCommand,
  DeleteObjectCommand: s3Mock.FakeDeleteObjectCommand,
}));

let h: Harness;
let employeeCookie: string;

async function createDraftClaimWithLine(): Promise<{ claimId: string; lineId: string }> {
  const res = await authedPost(h.app, "/api/claims", employeeCookie, {
    title: "Receipt test claim",
    lineItems: [{ categoryId: "meals", date: "2026-07-10", amount: 200_000 }],
  });
  const body = await res.json();
  return { claimId: body.claim.id, lineId: body.claim.lineItems[0].id };
}

beforeEach(async () => {
  h = await bootstrap();
  const res = await login(h.app, DEMO.employee.email);
  expect(res.status).toBe(200);
  employeeCookie = res.cookie!;
});
afterEach(() => h.cleanup());

describe("attachment upload + manual metadata", () => {
  // AC (#11, Attachment Storage & Manual Metadata API, positive #1): uploading
  // an attachment with manually entered merchant/amount/date/currency persists
  // and is retrievable by users with access to the parent claim.
  it("uploads a receipt with manual metadata and retrieves it by id", async () => {
    const { claimId, lineId } = await createDraftClaimWithLine();

    const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
    const uploadRes = await authedPostForm(
      h.app,
      `/api/claims/${claimId}/line-items/${lineId}/attachments`,
      employeeCookie,
      {
        file: new File([file], "lunch-receipt.jpg", { type: "image/jpeg" }),
        merchant: "Warung Sedap",
        amount: "200000",
        currency: "IDR",
        transactionDate: "2026-07-10",
      }
    );
    expect(uploadRes.status).toBe(201);
    const uploaded = await uploadRes.json();
    expect(uploaded.attachment.merchant).toBe("Warung Sedap");
    expect(uploaded.attachment.amount).toBe(200_000);
    expect(uploaded.attachment.currency).toBe("IDR");
    // Manual entry only — no auto-extraction step should populate anything
    // beyond what was explicitly supplied.
    expect(uploaded.attachment.transactionDate).toBe("2026-07-10");

    const downloadRes = await authedGet(h.app, `/api/attachments/${uploaded.attachment.id}`, employeeCookie);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("content-type")).toBe("image/jpeg");
    const bytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(bytes.length).toBe(4);

    // has_receipt should now be true on the parent line item.
    const claimRes = await authedGet(h.app, `/api/claims/${claimId}`, employeeCookie);
    const claim = await claimRes.json();
    expect(claim.claim.lineItems[0].hasReceipt).toBe(true);
  });

  it("is retrievable by an approver with access to the parent claim (route step access)", async () => {
    const { claimId, lineId } = await createDraftClaimWithLine();
    const file = new File([new Uint8Array([1, 2, 3])], "r.png", { type: "image/png" });
    const uploadRes = await authedPostForm(
      h.app,
      `/api/claims/${claimId}/line-items/${lineId}/attachments`,
      employeeCookie,
      { file, merchant: "Cafe X" }
    );
    const uploaded = await uploadRes.json();

    // Submit so the fallback route (submitter_manager → DEMO.approver) applies.
    await authedPost(h.app, `/api/claims/${claimId}/submit`, employeeCookie, {});

    const approverLogin = await login(h.app, DEMO.approver.email);
    const approverDownload = await authedGet(
      h.app,
      `/api/attachments/${uploaded.attachment.id}`,
      approverLogin.cookie
    );
    expect(approverDownload.status).toBe(200);
  });
});

describe("attachment access control", () => {
  // AC (#11, Attachment Storage & Manual Metadata API, negative #1): uploading
  // a file to a line item on a claim the caller does not own is rejected with
  // an authorization error.
  it("rejects an upload from a caller who does not own the parent claim", async () => {
    const { claimId, lineId } = await createDraftClaimWithLine();
    const approverLogin = await login(h.app, DEMO.approver.email);

    const file = new File([new Uint8Array([1])], "r.png", { type: "image/png" });
    const uploadRes = await authedPostForm(
      h.app,
      `/api/claims/${claimId}/line-items/${lineId}/attachments`,
      approverLogin.cookie,
      { file }
    );
    expect(uploadRes.status).toBe(403);
    const body = await uploadRes.json();
    expect(body.error.code).toBe("forbidden");
  });

  // Scope check: an employee not on the claim (not owner, not approver, not
  // finance) cannot read another employee's attachment.
  it("rejects a viewer with no relationship to the claim from downloading the attachment", async () => {
    const { claimId, lineId } = await createDraftClaimWithLine();
    const file = new File([new Uint8Array([1])], "r.png", { type: "image/png" });
    const uploadRes = await authedPostForm(
      h.app,
      `/api/claims/${claimId}/line-items/${lineId}/attachments`,
      employeeCookie,
      { file }
    );
    const uploaded = await uploadRes.json();

    // A finance user *does* have access by design (scoped to finance role),
    // so to prove the negative case we need a bystander: an approver who is
    // not this employee's manager and the claim hasn't been routed to them.
    // The claim is still Draft (never submitted), so no approver/finance
    // route access has been granted yet — only the owner may fetch it.
    const approverLogin = await login(h.app, DEMO.approver.email);
    const bystanderRes = await authedGet(
      h.app,
      `/api/attachments/${uploaded.attachment.id}`,
      approverLogin.cookie
    );
    expect(bystanderRes.status).toBe(403);
    const body = await bystanderRes.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("rejects an unsupported file type", async () => {
    const { claimId, lineId } = await createDraftClaimWithLine();
    const file = new File([new Uint8Array([1, 2])], "malware.exe", { type: "application/x-msdownload" });
    const uploadRes = await authedPostForm(
      h.app,
      `/api/claims/${claimId}/line-items/${lineId}/attachments`,
      employeeCookie,
      { file }
    );
    expect(uploadRes.status).toBe(415);
    const body = await uploadRes.json();
    expect(body.error.code).toBe("invalid_file");
  });
});

describe("attachment deletion", () => {
  it("deletes an attachment and clears has_receipt when none remain", async () => {
    const { claimId, lineId } = await createDraftClaimWithLine();
    const file = new File([new Uint8Array([1])], "r.png", { type: "image/png" });
    const uploadRes = await authedPostForm(
      h.app,
      `/api/claims/${claimId}/line-items/${lineId}/attachments`,
      employeeCookie,
      { file }
    );
    const uploaded = await uploadRes.json();

    const delRes = await authedDelete(h.app, `/api/attachments/${uploaded.attachment.id}`, employeeCookie);
    expect(delRes.status).toBe(200);

    const claimRes = await authedGet(h.app, `/api/claims/${claimId}`, employeeCookie);
    const claim = await claimRes.json();
    expect(claim.claim.lineItems[0].hasReceipt).toBe(false);
  });
});

describe("storage driver wiring (#76)", () => {
  // AC (#76): when SPENDFLOW_STORAGE_DRIVER=local (the default), uploads behave
  // exactly as before — the response fileUrl stays a relative storage key and
  // downloads stream the bytes.
  it("POST /api/attachments with SPENDFLOW_STORAGE_DRIVER=local works exactly as today", async () => {
    const { claimId, lineId } = await createDraftClaimWithLine();
    const file = new File([new Uint8Array([1, 2, 3])], "r.png", { type: "image/png" });
    const uploadRes = await authedPostForm(
      h.app,
      `/api/claims/${claimId}/line-items/${lineId}/attachments`,
      employeeCookie,
      { file, merchant: "Cafe X" }
    );
    expect(uploadRes.status).toBe(201);
    const body = await uploadRes.json();
    expect(body.attachment.fileUrl.startsWith("http")).toBe(false);
    expect(body.attachment.fileUrl.startsWith(`${lineId}/`)).toBe(true);

    const downloadRes = await authedGet(
      h.app,
      `/api/attachments/${body.attachment.id}`,
      employeeCookie
    );
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await downloadRes.arrayBuffer());
    expect(bytes.length).toBe(3);
  });

  // AC (#76): when SPENDFLOW_STORAGE_DRIVER=s3, the response fileUrl is the
  // configured public URL prefix + key (CDN-friendly receiptUrl for clients).
  it("POST /api/attachments with SPENDFLOW_STORAGE_DRIVER=s3 returns the S3 public URL", async () => {
    const prev = { ...process.env };
    process.env.SPENDFLOW_STORAGE_DRIVER = "s3";
    process.env.SPENDFLOW_STORAGE_BUCKET = "spendflow-receipts";
    process.env.SPENDFLOW_STORAGE_REGION = "us-east-1";
    process.env.SPENDFLOW_STORAGE_ACCESS_KEY_ID = "test-key";
    process.env.SPENDFLOW_STORAGE_SECRET_ACCESS_KEY = "test-secret";
    process.env.SPENDFLOW_STORAGE_PUBLIC_URL = "https://cdn.example.com";
    try {
      h = await bootstrap();
      const s3Login = await login(h.app, DEMO.employee.email);
      expect(s3Login.status).toBe(200);
      employeeCookie = s3Login.cookie;
      const { claimId, lineId } = await createDraftClaimWithLine();
      const file = new File([new Uint8Array([1, 2, 3])], "r.png", { type: "image/png" });
      const uploadRes = await authedPostForm(
        h.app,
        `/api/claims/${claimId}/line-items/${lineId}/attachments`,
        employeeCookie,
        { file }
      );
      expect(uploadRes.status).toBe(201);
      const body = await uploadRes.json();
      expect(body.attachment.fileUrl).toMatch(
        /^https:\/\/cdn\.example\.com\/receipts\//
      );
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in prev)) delete process.env[k];
      }
      Object.assign(process.env, prev);
    }
  });
});

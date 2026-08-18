/* ============================================================================
 * SpendFlow — Receipt storage driver tests (ticket #76).
 *
 * Both drivers are exercised through the same `ReceiptStorage` interface; the
 * S3 client is faked at the `send()` boundary so no network is ever touched.
 * ========================================================================== */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  getReceiptStorage,
  LocalReceiptStorage,
  S3ReceiptStorage,
  type StorageEnv,
} from "../src/services/storage.js";

function makeEnv(over: Partial<StorageEnv>): StorageEnv {
  return {
    storageDriver: "local",
    uploadsDir: tmpdir(),
    storageBucket: null,
    storageRegion: null,
    storageEndpoint: null,
    storageAccessKeyId: null,
    storageSecretAccessKey: null,
    storagePublicUrl: null,
    storagePathPrefix: "receipts/",
    ...over,
  };
}

/** Fake S3 client that records PutObject/DeleteObject inputs instead of networking. */
function makeFakeS3Client() {
  const putCalls: unknown[] = [];
  const deleteCalls: unknown[] = [];
  const client = {
    send: async (cmd: { input?: unknown }) => {
      if (cmd.input) {
        if ("Body" in (cmd.input as Record<string, unknown>)) putCalls.push(cmd.input);
        else deleteCalls.push(cmd.input);
      }
      return {};
    },
  } as unknown as S3Client;
  return { client, putCalls, deleteCalls };
}

describe("LocalReceiptStorage", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "spendflow-storage-"));

  it("round-trips a small file (store then read back)", async () => {
    const dirPath = dir();
    try {
      const storage = new LocalReceiptStorage(dirPath);
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const stored = await storage.store(bytes, {
        filename: "li-1/a.png",
        contentType: "image/png",
        sizeBytes: 4,
      });
      expect(stored.key).toBe("li-1/a.png");
      expect(stored.publicUrl).toBe("li-1/a.png");
      expect(stored.sizeBytes).toBe(4);
      expect(stored.contentType).toBe("image/png");

      const onDisk = readFileSync(join(dirPath, "li-1", "a.png"));
      expect([...onDisk]).toEqual([...bytes]);
    } finally {
      rmSync(dirPath, { recursive: true, force: true });
    }
  });

  it("deletes the stored file", async () => {
    const dirPath = dir();
    try {
      const storage = new LocalReceiptStorage(dirPath);
      await storage.store(new Uint8Array([9]), {
        filename: "li-2/b.jpg",
        contentType: "image/jpeg",
        sizeBytes: 1,
      });
      expect(existsSync(join(dirPath, "li-2", "b.jpg"))).toBe(true);

      await storage.delete("li-2/b.jpg");
      expect(existsSync(join(dirPath, "li-2", "b.jpg"))).toBe(false);
    } finally {
      rmSync(dirPath, { recursive: true, force: true });
    }
  });
});

describe("S3ReceiptStorage", () => {
  it("calls putObject with the right bucket/key/body (via mock S3Client)", async () => {
    const { client, putCalls } = makeFakeS3Client();
    const storage = new S3ReceiptStorage(client, {
      bucket: "spendflow-receipts",
      publicUrl: "https://cdn.example.com",
      pathPrefix: "receipts/",
    });

    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const stored = await storage.store(bytes, {
      filename: "li-1/lunch.png",
      contentType: "image/png",
      sizeBytes: 4,
    });

    expect(putCalls).toHaveLength(1);
    const input = putCalls[0] as {
      Bucket: string;
      Key: string;
      Body: Uint8Array;
      ContentType: string;
    };
    expect(input.Bucket).toBe("spendflow-receipts");
    expect(input.Key).toBe("receipts/li-1/lunch.png");
    expect(input.Body).toEqual(bytes);
    expect(input.ContentType).toBe("image/png");
    expect(stored.key).toBe("li-1/lunch.png");
    expect(stored.publicUrl).toBe("https://cdn.example.com/receipts/li-1/lunch.png");
  });

  it("getPublicUrl returns the configured public URL prefix + key", async () => {
    const { client } = makeFakeS3Client();
    const storage = new S3ReceiptStorage(client, {
      bucket: "spendflow-receipts",
      publicUrl: "https://cdn.example.com",
      pathPrefix: "receipts/",
    });
    expect(await storage.getPublicUrl("li-1/lunch.png")).toBe(
      "https://cdn.example.com/receipts/li-1/lunch.png"
    );
  });
});

describe("getReceiptStorage factory", () => {
  it("returns LocalReceiptStorage when SPENDFLOW_STORAGE_DRIVER=local", () => {
    const storage = getReceiptStorage(makeEnv({ storageDriver: "local" }));
    expect(storage).toBeInstanceOf(LocalReceiptStorage);
  });

  it("returns S3ReceiptStorage when SPENDFLOW_STORAGE_DRIVER=s3", () => {
    const storage = getReceiptStorage(
      makeEnv({
        storageDriver: "s3",
        storageBucket: "spendflow-receipts",
        storageRegion: "us-east-1",
        storageAccessKeyId: "key",
        storageSecretAccessKey: "secret",
        storagePublicUrl: "https://spendflow-receipts.s3.amazonaws.com",
      })
    );
    expect(storage).toBeInstanceOf(S3ReceiptStorage);
  });

  it("throws when driver=s3 but bucket/access key are missing", () => {
    expect(() =>
      getReceiptStorage(
        makeEnv({
          storageDriver: "s3",
          storageBucket: null,
          storageAccessKeyId: null,
          storageSecretAccessKey: "secret",
          storagePublicUrl: "https://cdn.example.com",
        })
      )
    ).toThrow(/SPENDFLOW_STORAGE_BUCKET/);
  });
});

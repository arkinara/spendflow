/* ============================================================================
 * SpendFlow — Receipt storage driver seam (ticket #76).
 *
 * One abstraction over local disk (dev, default) and S3-compatible cloud
 * storage (AWS S3 / Cloudflare R2 / MinIO). The attachment service only talks
 * to `ReceiptStorage`; the factory picks the implementation from the
 * SPENDFLOW_STORAGE_DRIVER env var. Keys are the relative paths previously
 * stored in `attachments.file_url` (e.g. `<lineId>/<file>`), so existing rows
 * keep working under both drivers.
 * ========================================================================== */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/** Result of a successful store: the key to persist + a client-facing URL. */
export interface StoredReceipt {
  key: string;
  publicUrl: string;
  sizeBytes: number;
  contentType: string;
}

/** Storage backend abstraction. The attachment service depends on this only. */
export interface ReceiptStorage {
  store(
    file: Uint8Array,
    args: { filename: string; contentType: string; sizeBytes: number }
  ): Promise<StoredReceipt>;
  delete(key: string): Promise<void>;
  /** Public URL for a stored key (CDN-friendly; drives `receiptUrl` responses). */
  getPublicUrl(key: string): Promise<string>;
}

/** Subset of `Env` the storage factory reads. */
export interface StorageEnv {
  storageDriver: "local" | "s3";
  uploadsDir: string | null;
  storageBucket: string | null;
  storageRegion: string | null;
  storageEndpoint: string | null;
  storageAccessKeyId: string | null;
  storageSecretAccessKey: string | null;
  storagePublicUrl: string | null;
  storagePathPrefix: string;
}

/**
 * Local-filesystem driver — the historical behavior (files under
 * `backend/uploads/`), preserved as the default when SPENDFLOW_STORAGE_DRIVER
 * is unset. `publicUrl` equals the key (a relative path), so responses are
 * byte-identical to pre-#76 behavior.
 */
export class LocalReceiptStorage implements ReceiptStorage {
  constructor(private dir: string) {}

  async store(
    file: Uint8Array,
    args: { filename: string; contentType: string; sizeBytes: number }
  ): Promise<StoredReceipt> {
    const absPath = join(this.dir, args.filename);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, file);
    return {
      key: args.filename,
      publicUrl: args.filename,
      sizeBytes: args.sizeBytes,
      contentType: args.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    await rm(join(this.dir, key), { force: true });
  }

  async getPublicUrl(key: string): Promise<string> {
    return key;
  }
}

/** S3 options baked into the client at construction time. */
export interface S3ReceiptStorageOptions {
  bucket: string;
  publicUrl: string;
  pathPrefix: string;
}

/**
 * S3-compatible driver (AWS S3 + Cloudflare R2 via the endpoint override).
 * Keys are namespaced under `pathPrefix` (default "receipts/") so a bucket can
 * host receipts alongside other objects. Public URLs are built from the
 * configured base URL + prefix + key.
 */
export class S3ReceiptStorage implements ReceiptStorage {
  constructor(
    private client: S3Client,
    private opts: S3ReceiptStorageOptions
  ) {}

  async store(
    file: Uint8Array,
    args: { filename: string; contentType: string; sizeBytes: number }
  ): Promise<StoredReceipt> {
    const key = args.filename;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: `${this.opts.pathPrefix}${key}`,
        Body: file,
        ContentType: args.contentType,
      })
    );
    return {
      key,
      publicUrl: await this.getPublicUrl(key),
      sizeBytes: args.sizeBytes,
      contentType: args.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.opts.bucket,
        Key: `${this.opts.pathPrefix}${key}`,
      })
    );
  }

  async getPublicUrl(key: string): Promise<string> {
    return `${this.opts.publicUrl.replace(/\/+$/, "")}/${this.opts.pathPrefix}${key}`;
  }
}

/**
 * Factory: pick the storage driver from `SPENDFLOW_STORAGE_DRIVER`. Local is
 * the default. `s3` requires the bucket + credentials (+ public URL) — the app
 * fails fast at startup if they are missing rather than uploading nowhere.
 */
export function getReceiptStorage(env: StorageEnv): ReceiptStorage {
  if (env.storageDriver === "s3") {
    const missing = [
      env.storageBucket ? null : "SPENDFLOW_STORAGE_BUCKET",
      env.storageAccessKeyId ? null : "SPENDFLOW_STORAGE_ACCESS_KEY_ID",
      env.storageSecretAccessKey ? null : "SPENDFLOW_STORAGE_SECRET_ACCESS_KEY",
      env.storagePublicUrl ? null : "SPENDFLOW_STORAGE_PUBLIC_URL",
    ].filter((v): v is string => v !== null);
    if (missing.length > 0) {
      throw new Error(
        `SPENDFLOW_STORAGE_DRIVER=s3 requires ${missing.join(", ")}`
      );
    }
    const client = new S3Client({
      region: env.storageRegion ?? "us-east-1",
      endpoint: env.storageEndpoint ?? undefined,
      credentials: {
        accessKeyId: env.storageAccessKeyId as string,
        secretAccessKey: env.storageSecretAccessKey as string,
      },
    });
    return new S3ReceiptStorage(client, {
      bucket: env.storageBucket as string,
      publicUrl: env.storagePublicUrl as string,
      pathPrefix: env.storagePathPrefix,
    });
  }
  return new LocalReceiptStorage(env.uploadsDir ?? "uploads");
}

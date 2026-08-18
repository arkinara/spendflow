import "dotenv/config";

/**
 * Centralised environment access for the backend. Reads process.env with typed
 * defaults so the rest of the codebase never touches process.env directly and
 * tests can override these fields before constructing a db/auth instance.
 */
export interface Env {
  databaseUrl: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  frontendOrigin: string | null;
  /** Base URL used to build invite links in emails (FE_URL; distinct from FRONTEND_ORIGIN). */
  feUrl: string;
  sessionExpiresIn: number;
  port: number;
  /** Override for the local attachment storage directory (tests / prod). */
  uploadsDir: string | null;
  /** #76 — receipt storage driver: "local" (default, dev) or "s3" (AWS S3 / Cloudflare R2). */
  storageDriver: "local" | "s3";
  storageBucket: string | null;
  storageRegion: string | null;
  /** S3-compatible endpoint override (Cloudflare R2). Empty for AWS S3. */
  storageEndpoint: string | null;
  storageAccessKeyId: string | null;
  storageSecretAccessKey: string | null;
  /** Base public URL used to build receipt URLs for clients (CDN-friendly). */
  storagePublicUrl: string | null;
  /** Key namespace prefix applied to every stored object key. */
  storagePathPrefix: string;
  /** #75 — Slack incoming-webhook URL for claim lifecycle events. Optional. */
  slackWebhookUrl: string | null;
  /** #75 — Microsoft Teams incoming-webhook URL for claim lifecycle events. Optional. */
  teamsWebhookUrl: string | null;
  /** #75 — override for the webhook-history log path (tests / prod). */
  webhookLogPath: string | null;
}

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number`);
  return Math.floor(n);
}

export function loadEnv(overrides: Partial<Env> = {}): Env {
  return {
    databaseUrl:
      overrides.databaseUrl ??
      str("DATABASE_URL", "file:./dev.db"),
    betterAuthSecret:
      overrides.betterAuthSecret ??
      str("BETTER_AUTH_SECRET", "dev-secret-change-me-in-production-please"),
    betterAuthUrl:
      overrides.betterAuthUrl ?? str("BETTER_AUTH_URL", "http://localhost:8787"),
    frontendOrigin:
      overrides.frontendOrigin ?? process.env.FRONTEND_ORIGIN ?? null,
    feUrl: overrides.feUrl ?? str("FE_URL", "http://localhost:3000"),
    sessionExpiresIn: overrides.sessionExpiresIn ?? int("SESSION_EXPIRES_IN", 604800),
    port: overrides.port ?? int("PORT", 8787),
    uploadsDir: overrides.uploadsDir ?? process.env.UPLOADS_DIR ?? null,
    storageDriver:
      overrides.storageDriver ??
      (process.env.SPENDFLOW_STORAGE_DRIVER === "s3" ? "s3" : "local"),
    storageBucket:
      overrides.storageBucket ??
      process.env.SPENDFLOW_STORAGE_BUCKET ??
      null,
    storageRegion:
      overrides.storageRegion ?? process.env.SPENDFLOW_STORAGE_REGION ?? null,
    storageEndpoint:
      overrides.storageEndpoint ?? process.env.SPENDFLOW_STORAGE_ENDPOINT ?? null,
    storageAccessKeyId:
      overrides.storageAccessKeyId ??
      process.env.SPENDFLOW_STORAGE_ACCESS_KEY_ID ??
      null,
    storageSecretAccessKey:
      overrides.storageSecretAccessKey ??
      process.env.SPENDFLOW_STORAGE_SECRET_ACCESS_KEY ??
      null,
    storagePublicUrl:
      overrides.storagePublicUrl ??
      process.env.SPENDFLOW_STORAGE_PUBLIC_URL ??
      null,
    storagePathPrefix:
      overrides.storagePathPrefix ??
      process.env.SPENDFLOW_STORAGE_PATH_PREFIX ??
      "receipts/",
    slackWebhookUrl:
      overrides.slackWebhookUrl ??
      process.env.SPENDFLOW_SLACK_WEBHOOK_URL ??
      null,
    teamsWebhookUrl:
      overrides.teamsWebhookUrl ??
      process.env.SPENDFLOW_TEAMS_WEBHOOK_URL ??
      null,
    webhookLogPath:
      overrides.webhookLogPath ?? process.env.SPENDFLOW_WEBHOOK_LOG ?? null,
  };
}

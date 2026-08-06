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
  };
}

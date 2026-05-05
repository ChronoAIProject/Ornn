/**
 * Environment variable configuration for ornn-api.
 *
 * Validation is schema-driven via Zod. Library code throws `ConfigError`
 * on invalid env; the entry point (`src/index.ts`) decides what to do
 * with the failure (typically: log and exit 1).
 *
 * @module infra/config
 */

import { z } from "zod";

export interface SkillConfig {
  // Service
  readonly port: number;
  readonly logLevel: string;
  readonly logPretty: boolean;

  // NyxID
  readonly nyxidTokenUrl: string;
  readonly nyxidClientId: string;
  readonly nyxidClientSecret: string;
  /**
   * NyxID API base URL (no trailing slash, no `/oauth/token` suffix).
   * Derived from `NYXID_SA_TOKEN_URL` when `NYXID_BASE_URL` is not set
   * explicitly so local dev works with just the token URL.
   */
  readonly nyxidBaseUrl: string;

  // Nyx Provider (LLM Gateway)
  readonly nyxLlmGatewayUrl: string;

  // MongoDB
  readonly mongodbUri: string;
  readonly mongodbDb: string;

  // chrono-storage
  readonly storageServiceUrl: string;
  readonly storageBucket: string;

  // chrono-sandbox
  readonly sandboxServiceUrl: string;

  // LLM defaults
  readonly defaultLlmModel: string;
  readonly llmMaxOutputTokens: number;
  readonly llmTemperature: number;
  readonly sseKeepAliveIntervalMs: number;

  // Skill package
  readonly maxPackageSizeBytes: number;

  // CORS
  /**
   * Allow-listed origins for cross-origin requests with credentials.
   * Parsed from the comma-separated `ALLOWED_ORIGINS` env var. An empty
   * list denies all cross-origin requests (same-origin still works).
   */
  readonly allowedOrigins: readonly string[];

  /**
   * Synthetic / out-of-catalogue NyxID service names that get appended
   * to the bottom of every `GET /api/v1/me/nyxid-services` response so
   * skill owners can tie a skill to a platform-side service that isn't
   * (yet) in the catalogue. Parsed from the comma-separated
   * `EXTRA_NYXID_SERVICES` env var.
   *
   * Each entry surfaces as a synthetic service with `tier: "admin"`,
   * `id: "synthetic:<slug>"`, the trimmed name as the label. Default is
   * a single-item array `["NyxID"]`.
   */
  readonly extraNyxidServices: readonly string[];

  // ---- Universal API audit (issue #245) ----
  /**
   * How long audit records live in MongoDB before the TTL index expires
   * them. Mirrored by the MinIO bucket lifecycle policy (configured
   * out-of-band) so the offloaded bodies expire on the same cadence.
   */
  readonly auditRetentionDays: number;
  /**
   * MinIO bucket where redacted request / response bodies are
   * gzip-uploaded for write ops and 4xx/5xx responses.
   */
  readonly auditMinioBucket: string;
  /**
   * Cutoff for inline-vs-MinIO. Bodies with redacted-JSON byte length
   * above this go to MinIO; smaller bodies live in the Mongo doc.
   */
  readonly auditBodyInlineMaxBytes: number;
  /**
   * Extra field-name regex patterns OR-d into the global redaction
   * blacklist. The defaults (`password|token|apiKey|secret|key|
   * credential`) always apply; this list extends them.
   */
  readonly auditGlobalRedactPatterns: readonly string[];
}

/** Parses "true"/"false"/"1"/"0" into a real boolean. */
const booleanFromEnv = z
  .string()
  .default("false")
  .transform((v) => {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3802),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  LOG_PRETTY: booleanFromEnv,

  NYXID_SA_TOKEN_URL: z.string().url(),
  NYXID_BASE_URL: z.string().url().optional(),
  NYXID_SA_CLIENT_ID: z.string().min(1),
  NYXID_SA_CLIENT_SECRET: z.string().min(1),

  NYX_LLM_GATEWAY_URL: z.string().url(),

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("ornn"),

  STORAGE_SERVICE_URL: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1).default("ornn"),

  SANDBOX_SERVICE_URL: z.string().min(1),

  DEFAULT_LLM_MODEL: z.string().min(1).default("gpt-4o"),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  SSE_KEEP_ALIVE_INTERVAL_MS: z.coerce.number().int().positive().default(15000),

  MAX_PACKAGE_SIZE_BYTES: z.coerce.number().int().positive().default(52428800),

  /**
   * Comma-separated list of origins permitted for cross-origin requests
   * with credentials. Empty = deny all (same-origin only). Example:
   *   ALLOWED_ORIGINS=https://app.ornn.xyz,http://localhost:5173
   */
  ALLOWED_ORIGINS: z.string().default(""),

  /**
   * Comma-separated synthetic NyxID services to append to the bottom of
   * the picker. See `SkillConfig.extraNyxidServices`. Default is the
   * single entry "NyxID"; future operators can extend it without code
   * changes by setting e.g. `EXTRA_NYXID_SERVICES=NyxID,SomeOtherSvc`.
   */
  EXTRA_NYXID_SERVICES: z.string().default("NyxID"),

  // ---- Universal API audit (issue #245) ----
  /** Days to retain audit records before TTL expiry. */
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  /** MinIO bucket for offloaded audit bodies. */
  MINIO_AUDIT_BUCKET: z.string().min(1).default("ornn-audit"),
  /** Max KB to keep inline in the Mongo doc; bigger spills to MinIO. */
  AUDIT_BODY_INLINE_MAX_KB: z.coerce.number().int().positive().default(16),
  /**
   * Comma-separated extra blacklist patterns. Combined with the built-in
   * defaults (`password|token|apiKey|secret|key|credential`).
   */
  AUDIT_GLOBAL_REDACT_PATTERNS: z.string().default(""),
});

/**
 * Thrown when env parsing fails. Caller decides how to surface the
 * failure (log + exit, throw upward, etc.). The message enumerates
 * every missing or invalid var so operators don't have to retry.
 */
export class ConfigError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    const summary = issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    super(`Invalid configuration: ${summary}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function loadConfig(): SkillConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new ConfigError(result.error.issues);
  }
  const env = result.data;

  const tokenUrl = env.NYXID_SA_TOKEN_URL;
  const baseUrl = (env.NYXID_BASE_URL ?? tokenUrl.replace(/\/oauth\/token\/?$/, "")).replace(/\/+$/, "");

  return {
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,

    nyxidTokenUrl: tokenUrl,
    nyxidClientId: env.NYXID_SA_CLIENT_ID,
    nyxidClientSecret: env.NYXID_SA_CLIENT_SECRET,
    nyxidBaseUrl: baseUrl,

    nyxLlmGatewayUrl: env.NYX_LLM_GATEWAY_URL,

    mongodbUri: env.MONGODB_URI,
    mongodbDb: env.MONGODB_DB,

    storageServiceUrl: env.STORAGE_SERVICE_URL,
    storageBucket: env.STORAGE_BUCKET,

    sandboxServiceUrl: env.SANDBOX_SERVICE_URL,

    defaultLlmModel: env.DEFAULT_LLM_MODEL,
    llmMaxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    llmTemperature: env.LLM_TEMPERATURE,
    sseKeepAliveIntervalMs: env.SSE_KEEP_ALIVE_INTERVAL_MS,

    maxPackageSizeBytes: env.MAX_PACKAGE_SIZE_BYTES,

    allowedOrigins: env.ALLOWED_ORIGINS
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),

    extraNyxidServices: env.EXTRA_NYXID_SERVICES
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),

    auditRetentionDays: env.AUDIT_RETENTION_DAYS,
    auditMinioBucket: env.MINIO_AUDIT_BUCKET,
    auditBodyInlineMaxBytes: env.AUDIT_BODY_INLINE_MAX_KB * 1024,
    auditGlobalRedactPatterns: env.AUDIT_GLOBAL_REDACT_PATTERNS
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

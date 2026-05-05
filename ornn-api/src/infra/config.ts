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

  /**
   * GitHub mirror config — when enabled, every public / system skill
   * gets one-way mirrored to a GitHub monorepo so the
   * `npx skills add <owner>/<repo>/<name>` install path works for
   * Ornn skills. See `domains/skills/mirror/`.
   *
   * `mirrorEnabled` gates the whole feature — when false (default), no
   * mirror calls are made even if the other fields are set. Lets
   * operators stage credentials in advance of flipping the switch.
   */
  readonly mirror: {
    readonly enabled: boolean;
    /** GitHub App numeric id (visible on the App settings page). */
    readonly appId: string;
    /** PEM-formatted RSA private key for the App. */
    readonly privateKey: string;
    /** Installation id for `<owner>/<repo>` (org-wide installation). */
    readonly installationId: string;
    /** Mirror repo owner — typically `ChronoAIProject`. */
    readonly repoOwner: string;
    /** Mirror repo name — typically `ornn-skills`. */
    readonly repoName: string;
    /** Default branch on the mirror — typically `main`. */
    readonly defaultBranch: string;
  };

  /**
   * Origin used in mirror READMEs to link back to the canonical Ornn
   * page (`<origin>/skills/<name>`). E.g. `https://ornn.chrono-ai.fun`.
   * No-trailing-slash, validated.
   */
  readonly ornnPublicOrigin: string;
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

  // ───────────── GitHub mirror (public / system skills) ───────────────
  // Disabled by default; flipping GITHUB_MIRROR_ENABLED=true requires
  // all four credential vars below to be present (validated at boot).
  GITHUB_MIRROR_ENABLED: booleanFromEnv,
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  GITHUB_MIRROR_REPO_OWNER: z.string().default("ChronoAIProject"),
  GITHUB_MIRROR_REPO_NAME: z.string().default("ornn-skills"),
  GITHUB_MIRROR_DEFAULT_BRANCH: z.string().default("main"),

  /**
   * Public origin agents and humans use to reach Ornn (no trailing
   * slash). Only used by the mirror service today, but generally
   * useful for any link generation. Default works for local dev.
   *
   * Coerce empty string → undefined so a `.env` line that's commented
   * out (envsubst injects literal "") still falls through to the
   * default instead of failing `.url()` validation at boot.
   */
  ORNN_PUBLIC_ORIGIN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().default("https://ornn.chrono-ai.fun"),
  ),
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

    mirror: {
      enabled: env.GITHUB_MIRROR_ENABLED,
      appId: env.GITHUB_APP_ID ?? "",
      // GitHub Apps emit PEM with literal `\n`s sometimes when the key is
      // pasted into a single-line env var; expand them so RS256 signing
      // sees the real linebreaks. No-op when the value already has real
      // newlines (e.g. when sourced from a multi-line k8s secret).
      privateKey: (env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
      installationId: env.GITHUB_APP_INSTALLATION_ID ?? "",
      repoOwner: env.GITHUB_MIRROR_REPO_OWNER,
      repoName: env.GITHUB_MIRROR_REPO_NAME,
      defaultBranch: env.GITHUB_MIRROR_DEFAULT_BRANCH,
    },
    ornnPublicOrigin: env.ORNN_PUBLIC_ORIGIN.replace(/\/+$/, ""),
  };
}

/**
 * Throws if `mirror.enabled === true` but credentials are missing.
 * Called from bootstrap so failure is loud at startup, not at first
 * publish-hook fire-and-forget (which would silently swallow it).
 */
export function assertMirrorConfigComplete(config: SkillConfig): void {
  if (!config.mirror.enabled) return;
  const missing: string[] = [];
  if (!config.mirror.appId) missing.push("GITHUB_APP_ID");
  if (!config.mirror.privateKey) missing.push("GITHUB_APP_PRIVATE_KEY");
  if (!config.mirror.installationId) missing.push("GITHUB_APP_INSTALLATION_ID");
  if (missing.length > 0) {
    throw new Error(
      `GITHUB_MIRROR_ENABLED=true but the following are unset: ${missing.join(", ")}`,
    );
  }
}

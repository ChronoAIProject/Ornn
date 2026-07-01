/**
 * Environment variable configuration for ornn-api (bootstrap-only).
 *
 * Per the Architecture §7 inventory, runtime-flippable knobs (LLM gateway,
 * default model, storage/sandbox URLs, NyxID base URL/paths + SA
 * credentials, AgentSeal toggle/timeout, SSE keep-alive, extra NyxID
 * services, **PostHog telemetry**) live in admin settings
 * (`platform_settings` collection) and are read on demand via
 * `SettingsService`. `loadConfig` only resolves what's needed to bring
 * the process up: DB URI, log level, the encryption key for at-rest
 * secrets, CORS origins, and the public origin used for canonical-link
 * generation.
 *
 * PostHog values stay in env as a *bootstrap fallback* for the very first
 * boot (when the DB telemetry section is empty / defaults). Once the
 * admin saves a value through Settings → Telemetry, that DB value wins
 * on the next restart.
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

  // MongoDB
  readonly mongodbUri: string;
  readonly mongodbDb: string;

  // Skill package upload limit (image-baked operational constant).
  readonly maxPackageSizeBytes: number;

  // Zip-bomb defense caps (#632/#633). Bound what an uploaded/pulled ZIP
  // is allowed to uncompress to BEFORE extraction, so a tiny compressed
  // payload can't be coerced into exhausting memory/disk in an extraction
  // loop or AgentSeal subprocess. Env-overridable operational constants.
  /** Cumulative uncompressed size cap across all entries (default 50 MiB). */
  readonly maxPackageUncompressedBytes: number;
  /** Per-entry uncompressed size cap (default 25 MiB). */
  readonly maxEntryUncompressedBytes: number;
  /** Maximum number of files an uploaded ZIP may contain (default 1000). */
  readonly maxPackageFileCount: number;
  /** Compression-ratio sanity cap — classic zip-bomb signature (default 100×). */
  readonly maxCompressionRatio: number;

  // CORS
  /**
   * Allow-listed origins for cross-origin requests with credentials.
   * Parsed from the comma-separated `ALLOWED_ORIGINS` env var. An empty
   * list denies all cross-origin requests (same-origin still works).
   */
  readonly allowedOrigins: readonly string[];

  // PostHog (server-side product analytics) — bootstrap fallback only.
  // Live values are read from the `telemetry` settings section at boot
  // (issue #271). When the section is empty, we fall back to these.
  readonly posthogEnabled: boolean;
  readonly posthogApiKey: string | null;
  readonly posthogProjectId: string | null;
  readonly posthogHost: string;
  readonly posthogErrorSampleRate: number;

  // AgentSeal — scanner binary paths (image-baked); enabled-flag and
  // timeout move to settings (skillAudit section).
  readonly agentsealPython: string;
  readonly agentsealScript: string;
  /**
   * Boot-time master switch (#442). When false the scanner skips path
   * validation entirely and `scan()` short-circuits to null. Lets
   * integration tests and any env without agentseal installed boot
   * without satisfying the absolute-path-must-exist guard.
   */
  readonly agentsealEnabled: boolean;

  /**
   * Origin used in mirror READMEs to link back to the canonical Ornn
   * page (`<origin>/skills/<name>`). E.g. `https://ornn.chrono-ai.fun`.
   * No-trailing-slash, validated.
   */
  readonly ornnPublicOrigin: string;

  /**
   * Service-account GitHub token for authenticated source-repo reads
   * (#1175). Env fallback used when the `sourceSync` settings section has no
   * token. Public-read only — it lifts the 60/hr anonymous rate ceiling, it
   * grants no access beyond public content. Empty ⇒ reads run anonymously
   * (rate-limited). Never logged.
   */
  readonly sourceSyncGithubToken: string;

  /** Master passphrase for AES-256-GCM at-rest secret encryption. Required, ≥32 chars; boot fails with ConfigError if missing/short. See ENCRYPTION_KEY in envSchema for full rationale. */
  readonly encryptionKey: string;
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

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("ornn"),

  MAX_PACKAGE_SIZE_BYTES: z.coerce.number().int().positive().default(52428800),

  // ---- Zip-bomb defense caps (#632/#633) — env-overridable. ----
  // Defaults mirror the constants baked into `shared/utils/zipLimits.ts`
  // (50 MiB cumulative / 25 MiB per-entry / 1000 files / 100× ratio).
  MAX_PACKAGE_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().default(52428800),
  MAX_ENTRY_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().default(26214400),
  MAX_PACKAGE_FILE_COUNT: z.coerce.number().int().positive().default(1000),
  MAX_COMPRESSION_RATIO: z.coerce.number().positive().default(100),

  /**
   * Comma-separated list of origins permitted for cross-origin requests
   * with credentials. Empty = deny all (same-origin only). Example:
   *   ALLOWED_ORIGINS=https://app.ornn.xyz,http://localhost:5173
   */
  ALLOWED_ORIGINS: z.string().default(""),

  /**
   * Master passphrase for the at-rest secret cipher (AES-256-GCM via
   * scrypt-derived key). MUST be ≥ 32 chars — schema rejects shorter
   * values at boot. There is NO dev fallback: a missing or weak key
   * fails-fast with a structured `ConfigError` rather than silently
   * encrypting every operator-pasted secret with a publicly-known
   * passphrase. Tests that boot the harness set `ENCRYPTION_KEY`
   * themselves (engineer-2's harness already does this).
   */
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters (set via env in all environments — no dev fallback)"),

  // ---- PostHog (server-side product analytics) — bootstrap fallback. ----
  // Admin Settings → Telemetry overrides these at boot when set.
  POSTHOG_ENABLED: booleanFromEnv,
  POSTHOG_API_KEY: z.string().default(""),
  POSTHOG_PROJECT_ID: z.string().default(""),
  POSTHOG_HOST: z.string().url().default("https://eu.i.posthog.com"),
  POSTHOG_ERROR_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // ---- AgentSeal (skill trust scanner, #253) — binary paths only ----
  AGENTSEAL_PYTHON: z.string().min(1).default("/opt/agentseal/bin/python"),
  AGENTSEAL_SCRIPT: z.string().min(1).default("/opt/agentseal/scan_skill.py"),
  // String-typed so `AGENTSEAL_ENABLED=false` in a `.env` file works
  // without booleanish-string parsing gymnastics. `"false"` disables;
  // any other value (default `"true"`) enables. Per #442.
  AGENTSEAL_ENABLED: z.string().default("true"),

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

  // Source-sync GitHub token (#1175). Optional — empty means anonymous,
  // rate-limited source reads. The `sourceSync` settings section overrides
  // this at runtime when an admin sets a value there.
  ORNN_SOURCE_SYNC_GITHUB_TOKEN: z.string().default(""),
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

  return {
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,

    mongodbUri: env.MONGODB_URI,
    mongodbDb: env.MONGODB_DB,

    maxPackageSizeBytes: env.MAX_PACKAGE_SIZE_BYTES,

    maxPackageUncompressedBytes: env.MAX_PACKAGE_UNCOMPRESSED_BYTES,
    maxEntryUncompressedBytes: env.MAX_ENTRY_UNCOMPRESSED_BYTES,
    maxPackageFileCount: env.MAX_PACKAGE_FILE_COUNT,
    maxCompressionRatio: env.MAX_COMPRESSION_RATIO,

    allowedOrigins: env.ALLOWED_ORIGINS
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),

    // Schema enforces ≥32 chars; trim is just defensive against trailing
    // whitespace from `.env` files. A short/missing key already failed
    // safeParse above, so we never reach here without a real value.
    encryptionKey: env.ENCRYPTION_KEY.trim(),

    posthogEnabled: env.POSTHOG_ENABLED,
    posthogApiKey: env.POSTHOG_API_KEY.trim() ? env.POSTHOG_API_KEY.trim() : null,
    posthogProjectId: env.POSTHOG_PROJECT_ID.trim() ? env.POSTHOG_PROJECT_ID.trim() : null,
    posthogHost: env.POSTHOG_HOST,
    posthogErrorSampleRate: env.POSTHOG_ERROR_SAMPLE_RATE,

    agentsealPython: env.AGENTSEAL_PYTHON,
    agentsealScript: env.AGENTSEAL_SCRIPT,
    agentsealEnabled: env.AGENTSEAL_ENABLED !== "false",

    ornnPublicOrigin: env.ORNN_PUBLIC_ORIGIN.replace(/\/+$/, ""),

    sourceSyncGithubToken: env.ORNN_SOURCE_SYNC_GITHUB_TOKEN.trim(),
  };
}
